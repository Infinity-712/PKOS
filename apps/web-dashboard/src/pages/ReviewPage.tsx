import { translateUiMessage } from "../i18n/copy.js";
import { useLocale } from "../i18n/Locale.js";
import { RefreshCw, Eye, Plus, Undo2, ArrowRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatDateTime, type ObjectRenderView } from "@pkos/agent-client";

import {
  EMPTY_ATTEMPT,
  applySubmitError,
  applySubmitResponse,
  isSuccessfulAttempt,
  resetAttempt,
  type RequestAttemptState,
} from "../features/actions/requestAttempt.js";
import {
  REVIEW_RATING_LABELS,
  canSubmitReviewCorrection,
  canSubmitReviewRating,
  createReviewCorrectionDraft,
  createReviewRatingDraft,
  nextReviewResultText,
  reviewContentChangedText,
  startOrReuseReviewAttempt,
} from "../features/review/reviewModel.js";
import { ApiClientError, getJson, postJson } from "../lib/apiClient.js";
import { isActionSubmitResponse, isObjectRenderView, isReviewHistoryResponse, isReviewItemResponse, isReviewQueueResponse } from "../lib/guards.js";
import type { ReviewHistoryEvent, ReviewQueueItem, ReviewQueueResponse } from "../types.js";

export function ReviewPage() {
  const { label: uiLabel, locale } = useLocale();
  const uiMessage = (value: string) => translateUiMessage(value, locale);
  const [queue, setQueue] = useState<ReviewQueueResponse | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [answerVisible, setAnswerVisible] = useState(false);
  const [answerRender, setAnswerRender] = useState<ObjectRenderView | null>(null);
  const [answerLoading, setAnswerLoading] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<RequestAttemptState>(EMPTY_ATTEMPT);
  const [correctionAttempt, setCorrectionAttempt] = useState<RequestAttemptState>(EMPTY_ATTEMPT);
  const [history, setHistory] = useState<ReviewHistoryEvent[]>([]);
  const [historyObjectId, setHistoryObjectId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const dueItems = queue?.due ?? [];
  const activeItem = dueItems[activeIndex] ?? null;
  const selectionEpoch = useRef(0);
  useLayoutEffect(() => {
    selectionEpoch.current += 1;
    return () => { selectionEpoch.current += 1; };
  }, [activeItem?.objectId]);
  const activeHistory = historyObjectId === activeItem?.objectId ? history : [];
  const activeAnswer = answerRender?.objectId === activeItem?.objectId ? answerRender : null;
  const latestRatingEventId = useMemo(() => {
    if (historyObjectId !== activeItem?.objectId) return null;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const event = history[i];
      if (event.type === "review_rating" && event.objectId === activeItem?.objectId && typeof event.id === "string") {
        return event.id;
      }
    }
    return null;
  }, [history, historyObjectId, activeItem?.objectId]);

  async function refresh(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const response = await getJson("/api/pkos/review/queue?limit=50", isReviewQueueResponse);
      setQueue(response);
      if (activeIndex >= response.due.length) {
        setActiveIndex(0);
      }
    } catch (caught) {
      setMessage(caught instanceof ApiClientError ? `${caught.code}: ${caught.message}` : "Review queue load failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory(item: ReviewQueueItem | null): Promise<void> {
    const epoch = selectionEpoch.current;
    setHistoryObjectId(null);
    setHistory([]);
    if (!item) {
      return;
    }
    try {
      const response = await getJson(`/api/pkos/review/items/${encodeURIComponent(item.objectId)}/history`, isReviewHistoryResponse);
      if (selectionEpoch.current !== epoch || response.objectId !== item.objectId) return;
      setHistory(response.events);
      setHistoryObjectId(item.objectId);
    } catch {
      if (selectionEpoch.current !== epoch) return;
      setHistory([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    setSelectedRating(null);
    setAnswerVisible(false);
    setAnswerRender(null);
    setAnswerLoading(false);
    setAnswerError(null);
    setAttempt(resetAttempt());
    setCorrectionAttempt(resetAttempt());
    setLastResult(null);
    void loadHistory(activeItem);
  }, [activeItem?.objectId]);

  async function revealAnswer(): Promise<void> {
    if (!activeItem) {
      return;
    }
    const epoch = selectionEpoch.current;
    setAnswerVisible(true);
    setAnswerLoading(true);
    setAnswerError(null);
    try {
      const response = await getJson(`/api/pkos/objects/${encodeURIComponent(activeItem.objectId)}/render`, isObjectRenderView);
      if (selectionEpoch.current !== epoch) return;
      if (response.objectId !== activeItem.objectId) {
        throw new ApiClientError(200, "invalid_response", "Answer did not match the selected object");
      }
      setAnswerRender(response);
    } catch (caught) {
      if (selectionEpoch.current !== epoch) return;
      setAnswerRender(null);
      setAnswerError(caught instanceof ApiClientError ? `${caught.code}: ${caught.message}` : "Answer render failed");
    } finally {
      if (selectionEpoch.current === epoch) setAnswerLoading(false);
    }
  }

  async function submitRating(): Promise<void> {
    const rating = selectedRating;
    if (!activeItem || !activeAnswer || !canSubmitReviewRating({ objectId: activeItem.objectId, rating, submitting: attempt.status === "submitting" }) || rating === null) {
      return;
    }
    const epoch = selectionEpoch.current;
    const draft = createReviewRatingDraft({
      objectId: activeItem.objectId,
      rating,
      reviewedAt: new Date().toISOString(),
      actor: "human",
    });
    const started = startOrReuseReviewAttempt(attempt, draft, createRequestId);
    setAttempt(started);
    if (!started.frozenPayload) {
      return;
    }
    try {
      const response = await postJson(started.frozenPayload.endpoint, started.frozenPayload.body, isActionSubmitResponse);
      if (selectionEpoch.current !== epoch) return;
      const next = applySubmitResponse(started, response);
      setAttempt(next);
      if (isSuccessfulAttempt(next.status)) {
        const itemResponse = await getJson(`/api/pkos/review/items/${encodeURIComponent(activeItem.objectId)}`, isReviewItemResponse);
        if (selectionEpoch.current !== epoch) return;
        setLastResult(
          nextReviewResultText({
            rating,
            dueAt: itemResponse.item.dueAt,
            intervalDays: itemResponse.item.intervalDays,
            easeFactor: itemResponse.item.easeFactor,
          }),
        );
        await loadHistory(activeItem);
        if (selectionEpoch.current !== epoch) return;
        await refresh();
      }
    } catch (caught) {
      if (selectionEpoch.current !== epoch) return;
      if (caught instanceof ApiClientError) {
        setAttempt(applySubmitError(started, { code: caught.code, message: caught.message }));
      } else {
        setAttempt(applySubmitError(started, { code: "network_unknown", message: "Network result was unknown" }));
      }
    }
  }

  async function undoLastRating(): Promise<void> {
    if (!latestRatingEventId || !canSubmitReviewCorrection({ targetEventId: latestRatingEventId, reason: "Undo last rating from Web Review", submitting: correctionAttempt.status === "submitting" })) {
      return;
    }
    const epoch = selectionEpoch.current;
    const draft = createReviewCorrectionDraft({
      targetEventId: latestRatingEventId,
      correctedRating: null,
      reason: "Undo last rating from Web Review",
      actor: "human",
    });
    const started = startOrReuseReviewAttempt(correctionAttempt, draft, createRequestId);
    setCorrectionAttempt(started);
    if (!started.frozenPayload) {
      return;
    }
    try {
      const response = await postJson(started.frozenPayload.endpoint, started.frozenPayload.body, isActionSubmitResponse);
      if (selectionEpoch.current !== epoch) return;
      const next = applySubmitResponse(started, response);
      setCorrectionAttempt(next);
      if (isSuccessfulAttempt(next.status)) {
        setLastResult("Undo appended as a correction event.");
        await loadHistory(activeItem);
        if (selectionEpoch.current !== epoch) return;
        await refresh();
      }
    } catch (caught) {
      if (selectionEpoch.current !== epoch) return;
      if (caught instanceof ApiClientError) {
        setCorrectionAttempt(applySubmitError(started, { code: caught.code, message: caught.message }));
      } else {
        setCorrectionAttempt(applySubmitError(started, { code: "network_unknown", message: "Network result was unknown" }));
      }
    }
  }

  return (
    <section className="split-page review-page">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>{uiLabel("Review")}</h2>
            <p className="subtle">{uiLabel("Human recall only. Review events are append-only authority; object.srs is a compatibility projection.")}</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={16} aria-hidden="true" />{uiLabel("Refresh")}
          </button>
        </div>
        {queue ? (
          <div className="review-summary">
            <span className="badge warn">{uiLabel("due")} {queue.counts.due}</span>
            <span className="badge">{uiLabel("overdue")} {queue.counts.overdue}</span>
            <span className="badge">{uiLabel("upcoming")} {queue.counts.upcoming}</span>
            <span className="badge">{uiLabel("legacy")} {queue.counts.legacyWarning}</span>
            <span className="badge">{uiLabel("changed")} {queue.counts.contentChanged}</span>
          </div>
        ) : null}
        {message ? <p className="notice">{uiMessage(message)}</p> : null}
        {activeItem ? (
          <ReviewCard
            item={activeItem}
            answerVisible={answerVisible}
            answerRender={activeAnswer}
            answerLoading={answerLoading}
            answerError={answerError}
            selectedRating={selectedRating}
            attempt={attempt}
            correctionAttempt={correctionAttempt}
            lastResult={lastResult}
            history={activeHistory}
            canUndo={Boolean(latestRatingEventId)}
            onReveal={() => void revealAnswer()}
            onRating={setSelectedRating}
            onSubmit={() => void submitRating()}
            onResetAttempt={() => setAttempt(resetAttempt())}
            onUndo={() => void undoLastRating()}
            onNext={() => setActiveIndex(Math.min(activeIndex + 1, Math.max(0, dueItems.length - 1)))}
          />
        ) : (
          <p className="muted">{uiLabel("No due review items.")}</p>
        )}
      </div>

      <div className="panel">
        <h3>{uiLabel("Queue")}</h3>
        <div className="review-queue-list">
          {dueItems.map((item, index) => (
            <button key={item.objectId} className={index === activeIndex ? "active queue-button" : "queue-button"} type="button" onClick={() => setActiveIndex(index)}>
              <span>{item.title || item.objectId}</span>
              <span className="subtle">{uiLabel(item.objectType)} {uiLabel("· due")} {formatDateTime(item.dueAt)}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReviewCard(props: {
  item: ReviewQueueItem;
  answerVisible: boolean;
  answerRender: ObjectRenderView | null;
  answerLoading: boolean;
  answerError: string | null;
  selectedRating: number | null;
  attempt: RequestAttemptState;
  correctionAttempt: RequestAttemptState;
  lastResult: string | null;
  history: ReviewHistoryEvent[];
  canUndo: boolean;
  onReveal: () => void;
  onRating: (rating: number) => void;
  onSubmit: () => void;
  onResetAttempt: () => void;
  onUndo: () => void;
  onNext: () => void;
}) {
  const { label: uiLabel, locale } = useLocale();
  const uiMessage = (value: string) => translateUiMessage(value, locale);
  const changedText = reviewContentChangedText(props.item.contentChangedSinceLastReview);
  const submitting = props.attempt.status === "submitting";
  const answerReady = props.answerRender?.objectId === props.item.objectId;
  return (
    <article className="review-card">
      <div className="review-meta">
        <span className="badge">{uiLabel(props.item.objectType)}</span>
        <span>{uiLabel(props.item.status)}</span>
        <span>{uiLabel("due")} {formatDateTime(props.item.dueAt)}</span>
      </div>
      <h3>{props.item.title || props.item.objectId}</h3>
      <p className="subtle">{uiLabel("Recall first. Keep the answer hidden until you have tried from memory.")}</p>
      {changedText ? <p className="notice">{uiMessage(changedText)}</p> : null}
      {props.item.legacyWarning ? <p className="notice">{uiLabel("Legacy SRS state needs human confirmation before it becomes fully replayable.")}</p> : null}

      {!props.answerVisible ? (
        <button type="button" onClick={props.onReveal}>
          <Eye size={16} aria-hidden="true" />{uiLabel("Show answer")}
        </button>
      ) : (
        <div className="answer-panel">
          {props.answerLoading ? <p className="muted">{uiLabel("Loading rendered object...")}</p> : null}
          {props.answerError ? <p className="notice">{uiMessage(props.answerError)}</p> : null}
          {props.answerRender ? (
            <>
              <p className="review-content">{props.answerRender.body}</p>
              {props.answerRender.sections.map((section) => (
                <div key={section.id} className="render-section">
                  <strong>{section.title}</strong>
                  <pre>{JSON.stringify(section.items, null, 2)}</pre>
                </div>
              ))}
            </>
          ) : null}
        </div>
      )}

      <div className="rating-row" aria-label={uiLabel("Review rating")}>
        {REVIEW_RATING_LABELS.map((label) => (
          <button
            key={label.value}
            className={props.selectedRating === label.value ? "active" : ""}
            type="button"
            onClick={() => props.onRating(label.value)}
            disabled={submitting || !answerReady}
          >
            {uiLabel(label.text)}
          </button>
        ))}
      </div>

      <div className="attempt-row">
        <button
          type="button"
          onClick={props.onSubmit}
          disabled={!answerReady || !canSubmitReviewRating({ objectId: props.item.objectId, rating: props.selectedRating, submitting })}
        >
          {uiLabel("Submit rating")}
        </button>
        <button type="button" onClick={props.onResetAttempt}>
          <Plus size={16} aria-hidden="true" />{uiLabel("New request")}
        </button>
        <button type="button" onClick={props.onUndo} disabled={!props.canUndo || props.correctionAttempt.status === "submitting"}>
          <Undo2 size={16} aria-hidden="true" />{uiLabel("Undo last rating")}
        </button>
        <button type="button" onClick={props.onNext}>
          <ArrowRight size={16} aria-hidden="true" />{uiLabel("Next")}
        </button>
        <span className={`badge ${isSuccessfulAttempt(props.attempt.status) ? "good" : props.attempt.status === "draft" ? "" : "warn"}`}>{uiLabel(props.attempt.status)}</span>
      </div>

      {props.attempt.requestId ? <p className="subtle">{uiLabel("requestId:")} {props.attempt.requestId}</p> : null}
      {props.lastResult ? <p className="notice">{uiMessage(props.lastResult)}</p> : null}
      {props.attempt.lastError ? <p className="notice" role="alert">{uiMessage(props.attempt.lastError)}</p> : null}
      {props.correctionAttempt.lastError ? <p className="notice" role="alert">{uiMessage(props.correctionAttempt.lastError)}</p> : null}
      {props.correctionAttempt.status !== "draft" ? <p className="subtle">{uiLabel("correction:")} {uiLabel(props.correctionAttempt.status)}</p> : null}

      <h3>{uiLabel("History")}</h3>
      <div className="history-list">
        {props.history.slice(-5).map((event) => (
          <div key={String(event.id)} className="history-item">
            <span>{uiLabel(event.type ?? "")}</span>
            <span>{event.rating ?? event.correctedRating ?? ""}</span>
            <span>{formatDateTime(typeof event.reviewedAt === "string" ? event.reviewedAt : event.createdAt)}</span>
            <span>{uiLabel("algorithm")} {event.algorithmVersion ?? ""}</span>
          </div>
        ))}
        {props.history.length === 0 ? <p className="muted">{uiLabel("No review history yet.")}</p> : null}
      </div>
    </article>
  );
}

function createRequestId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `review-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
