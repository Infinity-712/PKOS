import { useEffect, useMemo, useState } from "react";
import { formatDateTime } from "@pkos/agent-client";

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
import { isActionSubmitResponse, isReviewHistoryResponse, isReviewItemResponse, isReviewQueueResponse } from "../lib/guards.js";
import type { ReviewHistoryEvent, ReviewQueueItem, ReviewQueueResponse } from "../types.js";

export function ReviewPage() {
  const [queue, setQueue] = useState<ReviewQueueResponse | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [answerVisible, setAnswerVisible] = useState(false);
  const [attempt, setAttempt] = useState<RequestAttemptState>(EMPTY_ATTEMPT);
  const [correctionAttempt, setCorrectionAttempt] = useState<RequestAttemptState>(EMPTY_ATTEMPT);
  const [history, setHistory] = useState<ReviewHistoryEvent[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const dueItems = queue?.due ?? [];
  const activeItem = dueItems[activeIndex] ?? null;
  const latestRatingEventId = useMemo(() => {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const event = history[i];
      if (event.type === "review_rating" && typeof event.id === "string") {
        return event.id;
      }
    }
    return null;
  }, [history]);

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
    if (!item) {
      setHistory([]);
      return;
    }
    try {
      const response = await getJson(`/api/pkos/review/items/${encodeURIComponent(item.objectId)}/history`, isReviewHistoryResponse);
      setHistory(response.events);
    } catch {
      setHistory([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    setSelectedRating(null);
    setAnswerVisible(false);
    setAttempt(resetAttempt());
    setCorrectionAttempt(resetAttempt());
    setLastResult(null);
    void loadHistory(activeItem);
  }, [activeItem?.objectId]);

  async function revealAnswer(): Promise<void> {
    if (!activeItem) {
      return;
    }
    setAnswerVisible(true);
    try {
      await getJson(`/api/pkos/review/items/${encodeURIComponent(activeItem.objectId)}`, isReviewItemResponse);
    } catch {
      // The queue remains usable even if the detail read fails.
    }
  }

  async function submitRating(): Promise<void> {
    const rating = selectedRating;
    if (!activeItem || !canSubmitReviewRating({ objectId: activeItem.objectId, rating, submitting: attempt.status === "submitting" }) || rating === null) {
      return;
    }
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
      const next = applySubmitResponse(started, response);
      setAttempt(next);
      if (isSuccessfulAttempt(next.status)) {
        const itemResponse = await getJson(`/api/pkos/review/items/${encodeURIComponent(activeItem.objectId)}`, isReviewItemResponse);
        setLastResult(
          nextReviewResultText({
            rating,
            dueAt: itemResponse.item.dueAt,
            intervalDays: itemResponse.item.intervalDays,
            easeFactor: itemResponse.item.easeFactor,
          }),
        );
        await loadHistory(activeItem);
        await refresh();
      }
    } catch (caught) {
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
      const next = applySubmitResponse(started, response);
      setCorrectionAttempt(next);
      if (isSuccessfulAttempt(next.status)) {
        setLastResult("Undo appended as a correction event.");
        await loadHistory(activeItem);
        await refresh();
      }
    } catch (caught) {
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
            <h2>Review</h2>
            <p className="subtle">Human recall only. Review events are append-only authority; object.srs is a compatibility projection.</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </button>
        </div>
        {queue ? (
          <div className="review-summary">
            <span className="badge warn">due {queue.counts.due}</span>
            <span className="badge">overdue {queue.counts.overdue}</span>
            <span className="badge">upcoming {queue.counts.upcoming}</span>
            <span className="badge">legacy {queue.counts.legacyWarning}</span>
            <span className="badge">changed {queue.counts.contentChanged}</span>
          </div>
        ) : null}
        {message ? <p className="notice">{message}</p> : null}
        {activeItem ? (
          <ReviewCard
            item={activeItem}
            answerVisible={answerVisible}
            selectedRating={selectedRating}
            attempt={attempt}
            correctionAttempt={correctionAttempt}
            lastResult={lastResult}
            history={history}
            canUndo={Boolean(latestRatingEventId)}
            onReveal={() => void revealAnswer()}
            onRating={setSelectedRating}
            onSubmit={() => void submitRating()}
            onResetAttempt={() => setAttempt(resetAttempt())}
            onUndo={() => void undoLastRating()}
            onNext={() => setActiveIndex(Math.min(activeIndex + 1, Math.max(0, dueItems.length - 1)))}
          />
        ) : (
          <p className="muted">No due review items.</p>
        )}
      </div>

      <div className="panel">
        <h3>Queue</h3>
        <div className="review-queue-list">
          {dueItems.map((item, index) => (
            <button key={item.objectId} className={index === activeIndex ? "active queue-button" : "queue-button"} type="button" onClick={() => setActiveIndex(index)}>
              <span>{item.title || item.objectId}</span>
              <span className="subtle">{item.objectType} · due {formatDateTime(item.dueAt)}</span>
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
  const changedText = reviewContentChangedText(props.item.contentChangedSinceLastReview);
  const submitting = props.attempt.status === "submitting";
  return (
    <article className="review-card">
      <div className="review-meta">
        <span className="badge">{props.item.objectType}</span>
        <span>{props.item.status}</span>
        <span>due {formatDateTime(props.item.dueAt)}</span>
      </div>
      <h3>{props.item.title || props.item.objectId}</h3>
      <p className="subtle">Recall first. Keep the answer hidden until you have tried from memory.</p>
      {changedText ? <p className="notice">{changedText}</p> : null}
      {props.item.legacyWarning ? <p className="notice">Legacy SRS state needs human confirmation before it becomes fully replayable.</p> : null}

      {!props.answerVisible ? (
        <button type="button" onClick={props.onReveal}>
          Show answer
        </button>
      ) : (
        <div className="answer-panel">
          <p className="subtle">Answer revealed. Queue data stays bounded; full object text is read only after this explicit action.</p>
        </div>
      )}

      <div className="rating-row" aria-label="Review rating">
        {REVIEW_RATING_LABELS.map((label) => (
          <button
            key={label.value}
            className={props.selectedRating === label.value ? "active" : ""}
            type="button"
            onClick={() => props.onRating(label.value)}
            disabled={submitting}
          >
            {label.text}
          </button>
        ))}
      </div>

      <div className="attempt-row">
        <button
          type="button"
          onClick={props.onSubmit}
          disabled={!canSubmitReviewRating({ objectId: props.item.objectId, rating: props.selectedRating, submitting })}
        >
          Submit rating
        </button>
        <button type="button" onClick={props.onResetAttempt}>
          New request
        </button>
        <button type="button" onClick={props.onUndo} disabled={!props.canUndo || props.correctionAttempt.status === "submitting"}>
          Undo last rating
        </button>
        <button type="button" onClick={props.onNext}>
          Next
        </button>
        <span className={`badge ${isSuccessfulAttempt(props.attempt.status) ? "good" : props.attempt.status === "draft" ? "" : "warn"}`}>{props.attempt.status}</span>
      </div>

      {props.attempt.requestId ? <p className="subtle">requestId: {props.attempt.requestId}</p> : null}
      {props.lastResult ? <p className="notice">{props.lastResult}</p> : null}
      {props.correctionAttempt.status !== "draft" ? <p className="subtle">correction: {props.correctionAttempt.status}</p> : null}

      <h3>History</h3>
      <div className="history-list">
        {props.history.slice(-5).map((event) => (
          <div key={String(event.id)} className="history-item">
            <span>{event.type}</span>
            <span>{event.rating ?? event.correctedRating ?? ""}</span>
            <span>{formatDateTime(typeof event.reviewedAt === "string" ? event.reviewedAt : event.createdAt)}</span>
            <span>algorithm {event.algorithmVersion ?? ""}</span>
          </div>
        ))}
        {props.history.length === 0 ? <p className="muted">No review history yet.</p> : null}
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
