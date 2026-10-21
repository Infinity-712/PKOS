import { translateUiMessage } from "../i18n/copy.js";
import { useLocale } from "../i18n/Locale.js";
import { formatObjectActionError } from "../features/objects/objectModel.js";
import { RefreshCw, Filter, Plus, Save, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatDateTime, type CaptureActionName, type JsonObject, type ObjectDeletePreflight, type ObjectDetailResponse, type ObjectKind, type ObjectListItem, type ObjectTypeContract } from "@pkos/agent-client";

import { EMPTY_ATTEMPT, applySubmitError, applySubmitResponse, isSuccessfulAttempt, resetAttempt, type RequestAttemptState } from "../features/actions/requestAttempt.js";
import {
  buildObjectListQuery,
  canCreateObject,
  canDeleteObject,
  canSaveObjectUpdate,
  createObjectCreateDraft,
  createObjectDeleteDraft,
  createObjectUpdateDraft,
  editableFieldNames,
  fieldIsEditable,
  linesToList,
  listToLines,
  objectActionErrorDetails,
  objectActionErrorFromCaught,
  objectActionErrorFromResponse,
  validateObjectIdInput,
  type ObjectActionUiError,
  type ObjectCreateForm,
} from "../features/objects/objectModel.js";
import { ApiClientError, getJson, postJson, putJson } from "../lib/apiClient.js";
import {
  isActionSubmitResponse,
  isObjectDeletePreflight,
  isObjectDetailResponse,
  isObjectListResponse,
  isObjectRenderView,
  isObjectTypeContractResponse,
} from "../lib/guards.js";

const OBJECT_TYPES: ObjectKind[] = ["fact", "claim", "skill", "creative"];

const EMPTY_FORM: ObjectCreateForm = {
  id: "",
  type: "fact",
  status: "parsed",
  title: "",
  summary: "",
  content: "",
  source: [],
  anchors: [],
  tags: [],
};

export function ObjectsPage() {
  const { label: uiLabel, locale, t } = useLocale();
  const uiMessage = (value: string) => translateUiMessage(value, locale);
  const [contracts, setContracts] = useState<ObjectTypeContract[]>([]);
  const [items, setItems] = useState<ObjectListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ObjectDetailResponse | null>(null);
  const [renderBody, setRenderBody] = useState<string>("");
  const [renderSections, setRenderSections] = useState<Array<{ id: string; title: string; items: unknown[] }>>([]);
  const [typeFilter, setTypeFilter] = useState<ObjectKind | "">("");
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<ObjectCreateForm>(EMPTY_FORM);
  const [editPatch, setEditPatch] = useState<JsonObject>({});
  const [attempt, setAttempt] = useState<RequestAttemptState>(EMPTY_ATTEMPT);
  const [deletePreflight, setDeletePreflight] = useState<ObjectDeletePreflight | null>(null);
  const [typedDeleteId, setTypedDeleteId] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ObjectActionUiError | null>(null);
  const [loading, setLoading] = useState(false);
  const selection = useRef<{ id: string | null; epoch: number }>({ id: null, epoch: 0 });
  const refreshSequence = useRef(0);
  const detailIsSelected = selectedId !== null && detail?.object.id === selectedId;
  const preflightMatches = detailIsSelected && deletePreflight?.objectId === selectedId &&
    deletePreflight?.fileRevisionSha256 === detail?.fileRevisionSha256;

  const contractByType = useMemo(() => new Map(contracts.map((contract) => [contract.type, contract])), [contracts]);
  const activeContract = contractByType.get(form.type);
  const selectedContract = detail ? contractByType.get(String(detail.object.type) as ObjectKind) : undefined;
  const editable = editableFieldNames(detail?.editableFields ?? []);
  const additionalFields = detail?.additionalFields ?? [];
  const idValidation = useMemo(
    () => validateObjectIdInput({ objectId: form.id, objectType: form.type, contract: activeContract?.objectId }),
    [activeContract, form.id, form.type],
  );
  const showIdError = form.id.length > 0 && !idValidation.ok;
  const createEnabled = canCreateObject({
    idValidation,
    submitting: attempt.status === "submitting",
    status: form.status,
    title: form.title,
    content: form.content,
  });

  function selectObject(objectId: string | null): number {
    const epoch = selection.current.epoch + 1;
    selection.current = { id: objectId, epoch };
    setSelectedId(objectId);
    setDetail(null);
    setEditPatch({});
    setRenderBody("");
    setRenderSections([]);
    setMessage(null);
    setDeletePreflight(null);
    setTypedDeleteId("");
    setDeleteReason("");
    setAttempt(resetAttempt());
    setActionError(null);
    return epoch;
  }

  async function refresh(): Promise<void> {
    const epoch = selection.current.epoch;
    const sequence = ++refreshSequence.current;
    const isCurrent = () => selection.current.epoch === epoch && refreshSequence.current === sequence;
    setLoading(true);
    setMessage(null);
    setActionError(null);
    try {
      const contractPayload = await getJson("/api/pkos/object-types", isObjectTypeContractResponse);
      if (!isCurrent()) return;
      setContracts(contractPayload.types);
      const queryText = buildObjectListQuery({ type: typeFilter || undefined, status: statusFilter, q: query, limit: "100" });
      const list = await getJson(`/api/pkos/objects${queryText ? `?${queryText}` : ""}`, isObjectListResponse);
      if (!isCurrent()) return;
      setItems(list.items);
      if (selection.current.id && !list.items.some((item) => item.id === selection.current.id)) {
        selectObject(null);
      }
    } catch (caught) {
      if (!isCurrent()) return;
      setMessage(errorText(caught, "Object list load failed"));
    } finally {
      if (refreshSequence.current === sequence) setLoading(false);
    }
  }

  async function loadDetail(objectId: string): Promise<void> {
    const epoch = selectObject(objectId);
    try {
      const next = await getJson(`/api/pkos/objects/${encodeURIComponent(objectId)}`, isObjectDetailResponse);
      if (selection.current.epoch !== epoch) return;
      if (next.object.id !== objectId) {
        throw new ApiClientError(200, "invalid_response", "Detail did not match the selected object");
      }
      setDetail(next);
      const rendered = await getJson(`/api/pkos/objects/${encodeURIComponent(objectId)}/render`, isObjectRenderView);
      if (selection.current.epoch !== epoch) return;
      if (rendered.objectId !== objectId) {
        throw new ApiClientError(200, "invalid_response", "Render did not match the selected object");
      }
      setRenderBody(rendered.body);
      setRenderSections(rendered.sections);
    } catch (caught) {
      if (selection.current.epoch !== epoch) return;
      setMessage(errorText(caught, "Object detail load failed"));
    }
  }

  useEffect(() => {
    void refresh();
    return () => {
      selection.current = { id: null, epoch: selection.current.epoch + 1 };
      refreshSequence.current += 1;
    };
  }, []);

  async function submitCreate(): Promise<void> {
    if (!createEnabled) {
      setActionError({
        code: idValidation.code ?? "invalid_input",
        message: idValidation.message ?? "Create form is incomplete / 创建表单尚未填写完整",
      });
      return;
    }
    const draft = createObjectCreateDraft(form, activeContract);
    const epoch = selection.current.epoch;
    const requestId = createRequestId("object-create");
    const frozen = attemptFor(draft.actionName, draft.endpoint, requestId, draft.body);
    setAttempt(frozen);
    setActionError(null);
    try {
      const response = await postJson(draft.endpoint, { ...draft.body, requestId }, isActionSubmitResponse);
      if (selection.current.epoch !== epoch) return;
      setAttempt(applySubmitResponse(frozen, response));
      const responseError = objectActionErrorFromResponse(response);
      if (responseError) {
        setActionError(responseError);
        return;
      }
      if (response.ok) {
        const object = draft.body.object as JsonObject;
        await refresh();
        if (selection.current.epoch !== epoch) return;
        if (typeof object.id === "string") {
          await loadDetail(object.id);
        }
      }
    } catch (caught) {
      if (selection.current.epoch !== epoch) return;
      const error = objectActionErrorFromCaught(caught);
      setAttempt(applySubmitError(attemptFor(draft.actionName, draft.endpoint, requestId, draft.body), { code: error.code, message: error.message }));
      setActionError(error);
    }
  }

  async function submitUpdate(): Promise<void> {
    if (!detail || !detailIsSelected || selection.current.id !== selectedId || !canSaveObjectUpdate({ baseRevision: detail.fileRevisionSha256, submitting: attempt.status === "submitting" })) {
      return;
    }
    const epoch = selection.current.epoch;
    const objectId = String(detail.object.id);
    const draft = createObjectUpdateDraft(objectId, detail.fileRevisionSha256, editPatch);
    const requestId = createRequestId("object-update");
    const frozen = attemptFor(draft.actionName, draft.endpoint, requestId, draft.body);
    setAttempt({ ...frozen, status: "submitting" });
    setActionError(null);
    try {
      const response = await putJson(draft.endpoint, { ...draft.body, requestId }, isActionSubmitResponse);
      if (selection.current.epoch !== epoch) return;
      setAttempt(applySubmitResponse(frozen, response));
      const responseError = objectActionErrorFromResponse(response);
      if (responseError) {
        setActionError(responseError);
        return;
      }
      if (response.ok) {
        await refresh();
        if (selection.current.epoch !== epoch) return;
        await loadDetail(objectId);
      }
    } catch (caught) {
      if (selection.current.epoch !== epoch) return;
      const action = objectActionErrorFromCaught(caught);
      const error = { code: action.code, message: action.message };
      setAttempt(applySubmitError(frozen, error));
      setActionError(action);
      if (error.code === "object_revision_conflict") {
        setMessage("Object changed outside this editor / 对象已在编辑器外变更. Reload the latest version before saving.");
      }
    }
  }

  async function runDeletePreflight(): Promise<void> {
    if (!detail || !detailIsSelected || selection.current.id !== selectedId) {
      return;
    }
    const epoch = selection.current.epoch;
    setDeletePreflight(null);
    try {
      const objectId = String(detail.object.id);
      const response = await postJson(`/api/pkos/objects/${encodeURIComponent(objectId)}/delete-preflight`, { baseRevision: detail.fileRevisionSha256 }, isObjectDeletePreflight);
      if (selection.current.epoch !== epoch) return;
      if (response.objectId !== objectId || response.fileRevisionSha256 !== detail.fileRevisionSha256) {
        throw new ApiClientError(200, "invalid_response", "Delete preflight did not match the selected object revision");
      }
      setDeletePreflight(response);
      setActionError(null);
    } catch (caught) {
      if (selection.current.epoch !== epoch) return;
      const error = objectActionErrorFromCaught(caught);
      setActionError(error);
      setMessage(errorText(caught, "Delete preflight failed"));
    }
  }

  async function submitDelete(): Promise<void> {
    if (!detail || !deletePreflight || !detailIsSelected || !preflightMatches || selection.current.id !== selectedId || attempt.status === "submitting") {
      return;
    }
    const epoch = selection.current.epoch;
    const objectId = String(detail.object.id);
    if (!canDeleteObject({ typedObjectId: typedDeleteId, expectedObjectId: objectId, reason: deleteReason, canDelete: deletePreflight.canDelete })) {
      return;
    }
    const draft = createObjectDeleteDraft(objectId, detail.fileRevisionSha256, deleteReason);
    const requestId = createRequestId("object-delete");
    const frozen = attemptFor(draft.actionName, draft.endpoint, requestId, { ...draft.body, typedObjectId: typedDeleteId });
    setAttempt({ ...frozen, status: "submitting" });
    setActionError(null);
    try {
      const response = await postJson(draft.endpoint, { ...draft.body, requestId, typedObjectId: typedDeleteId }, isActionSubmitResponse);
      if (selection.current.epoch !== epoch) return;
      setAttempt(applySubmitResponse(frozen, response));
      const responseError = objectActionErrorFromResponse(response);
      if (responseError) {
        setActionError(responseError);
        return;
      }
      if (response.ok) {
        selectObject(null);
        await refresh();
      }
    } catch (caught) {
      if (selection.current.epoch !== epoch) return;
      const error = objectActionErrorFromCaught(caught);
      setAttempt(applySubmitError(frozen, { code: error.code, message: error.message }));
      setActionError(error);
    }
  }

  return (
    <section className="objects-page">
      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>{uiLabel("Objects / 知识对象")}</h2>
            <p className="subtle">{uiLabel("Human editing only. Files remain Git authority in the configured Data Root.")}</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={16} aria-hidden="true" />{uiLabel("Refresh")}
          </button>
        </div>
        <div className="filter-row">
          <label>
            {uiLabel("Search")}
            <input value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <label>
            {uiLabel("Type")}
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as ObjectKind | "")}>
              <option value="">{uiLabel("All")}</option>
              {OBJECT_TYPES.map((item) => (
                <option key={item} value={item}>
                  {uiLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {uiLabel("Status")}
            <input value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} />
          </label>
          <button type="button" onClick={() => void refresh()}>
            <Filter size={16} aria-hidden="true" />{uiLabel("Apply")}
          </button>
        </div>
        {message ? <p className="notice">{uiMessage(message)}</p> : null}
        {actionError ? (
          <div className="notice object-action-error" role="alert">
            <strong>{formatObjectActionError(actionError, uiMessage)}</strong>
            <details>
              <summary>{uiLabel("Request details / 请求详情")}</summary>
              <pre>{objectActionErrorDetails(actionError)}</pre>
            </details>
          </div>
        ) : null}
        <div className="object-list">
          {items.map((item) => (
            <button key={item.id} className={selectedId === item.id ? "object-list-item active" : "object-list-item"} type="button" onClick={() => void loadDetail(item.id)}>
              <span>{item.title || item.id}</span>
              <span className="subtle">
                {uiLabel(item.type)} / {uiLabel(item.status)} / {formatDateTime(item.updatedAt)}
              </span>
              <span className={item.contentChangedSinceLastReview ? "badge warn" : "badge"}>{item.srsEligible ? uiLabel("SRS") : uiLabel("internal")}</span>
            </button>
          ))}
          {items.length === 0 ? <p className="muted">{uiLabel("No objects found.")}</p> : null}
        </div>
      </div>

      <details className="panel object-create">
        <summary><Plus size={16} aria-hidden="true" />{t("新建对象", "New object")}</summary>
        <div className="form-panel">
          <label>
            {uiLabel("Type")}
            <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as ObjectKind, status: contractByType.get(event.target.value as ObjectKind)?.statusEnum[0] ?? "" })}>
              {OBJECT_TYPES.map((item) => (
                <option key={item} value={item}>
                  {uiLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {uiLabel("Object ID / 对象 ID")}
            <input value={form.id} aria-invalid={showIdError} aria-describedby={showIdError ? "object-id-help object-id-validation" : "object-id-help"} onChange={(event) => setForm({ ...form, id: event.target.value })} placeholder={`${form.type}.example`} />
          </label>
          <div>
            <p className={showIdError ? "subtle id-length-counter warn" : "subtle id-length-counter"}>
              {idValidation.currentLength}/{idValidation.maxLength ?? "?"}
            </p>
            <p className="subtle">{activeContract?.objectId ? t(`长度 ${activeContract.objectId.minLength}-${activeContract.objectId.maxLength}；示例：${activeContract.objectId.example}`, `Length ${activeContract.objectId.minLength}-${activeContract.objectId.maxLength}; example: ${activeContract.objectId.example}`) : t("正在加载对象 ID 规则", "Loading object ID rules")}</p>
            <p id="object-id-help" className="subtle">{t("格式：", "Pattern: ")}{activeContract?.objectId.pattern ?? t("正在加载", "Loading")}</p>
            {showIdError ? <p id="object-id-validation" className="notice id-inline-error" role="status">{uiMessage(idValidation.message ?? "")}</p> : null}
          </div>
          <label>
            {uiLabel("Status")}
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              {(activeContract?.statusEnum ?? ["parsed"]).map((status) => (
                <option key={status} value={status}>
                  {uiLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {uiLabel("Title")}
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label>
            {uiLabel("Summary")}
            <textarea rows={2} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} />
          </label>
          <label>
            {uiLabel("Content")}
            <textarea rows={6} value={form.content} onChange={(event) => setForm({ ...form, content: event.target.value })} />
          </label>
          {fieldIsEditable(activeContract, "source") ? (
            <label>
              {uiLabel("Source")}
              <textarea rows={2} value={form.source.join("\n")} onChange={(event) => setForm({ ...form, source: linesToList(event.target.value) })} />
            </label>
          ) : null}
          {fieldIsEditable(activeContract, "anchors") ? (
            <label>
              {uiLabel("Anchors")}
              <textarea rows={2} value={form.anchors.join("\n")} onChange={(event) => setForm({ ...form, anchors: linesToList(event.target.value) })} />
            </label>
          ) : null}
          {fieldIsEditable(activeContract, "tags") ? (
            <label>
              {uiLabel("Tags")}
              <input value={form.tags.join(", ")} onChange={(event) => setForm({ ...form, tags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} />
            </label>
          ) : null}
          <button type="button" onClick={() => void submitCreate()} disabled={!createEnabled}>
            <Plus size={16} aria-hidden="true" />{uiLabel("Create object")}
          </button>
        </div>
      </details>

      <div className="panel object-detail">
        <h3>{uiLabel("Detail")}</h3>
        {detail && detailIsSelected ? (
          <>
            <dl className="kv-list compact">
              <dt>{uiLabel("ID")}</dt>
              <dd>{String(detail.object.id)}</dd>
              <dt>{uiLabel("Type")}</dt>
              <dd>{uiLabel(String(detail.object.type))}</dd>
              <dt>{uiLabel("Created")}</dt>
              <dd>{formatDateTime(String(detail.object.created_at ?? ""))}</dd>
              <dt>{uiLabel("Updated")}</dt>
              <dd>{formatDateTime(String(detail.object.updated_at ?? ""))}</dd>
              <dt>{uiLabel("SRS")}</dt>
              <dd>{detail.srsEligible ? uiLabel("eligible") : uiLabel("not eligible")}</dd>
            </dl>
            <div className="form-panel">
              <label>
                {uiLabel("Status")}
                <select value={String(editPatch.status ?? detail.object.status ?? "")} onChange={(event) => setEditPatch({ ...editPatch, status: event.target.value })}>
                  {(selectedContract?.statusEnum ?? []).map((status) => (
                    <option key={status} value={status}>
                      {uiLabel(status)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {uiLabel("Title")}
                <input value={String(editPatch.title ?? detail.object.title ?? "")} onChange={(event) => setEditPatch({ ...editPatch, title: event.target.value })} />
              </label>
              <label>
                {uiLabel("Summary")}
                <textarea rows={2} value={String(editPatch.summary ?? detail.object.summary ?? "")} onChange={(event) => setEditPatch({ ...editPatch, summary: event.target.value })} />
              </label>
              <label>
                {uiLabel("Content")}
                <textarea rows={8} value={String(editPatch.content ?? detail.object.content ?? "")} onChange={(event) => setEditPatch({ ...editPatch, content: event.target.value })} />
              </label>
              {fieldIsEditable(selectedContract, "source") ? (
                <label>
                  {uiLabel("Source")}
                  <textarea rows={2} value={listToLines(editPatch.source ?? detail.object.source)} onChange={(event) => setEditPatch({ ...editPatch, source: linesToList(event.target.value) })} />
                </label>
              ) : null}
              {fieldIsEditable(selectedContract, "anchors") ? (
                <label>
                  {uiLabel("Anchors")}
                  <textarea rows={2} value={listToLines(editPatch.anchors ?? detail.object.anchors)} onChange={(event) => setEditPatch({ ...editPatch, anchors: linesToList(event.target.value) })} />
                </label>
              ) : null}
              {fieldIsEditable(selectedContract, "tags") ? (
                <label>
                  {uiLabel("Tags")}
                  <input value={listToLines(editPatch.tags ?? detail.object.tags).replace(/\n/g, ", ")} onChange={(event) => setEditPatch({ ...editPatch, tags: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} />
                </label>
              ) : null}
              <div className="attempt-row">
                <button type="button" onClick={() => void submitUpdate()} disabled={!canSaveObjectUpdate({ baseRevision: detail.fileRevisionSha256, submitting: attempt.status === "submitting" })}>
                  <Save size={16} aria-hidden="true" />{uiLabel("Save changes")}
                </button>
                <button type="button" onClick={() => void loadDetail(String(detail.object.id))}>
                  <RefreshCw size={16} aria-hidden="true" />{uiLabel("Reload latest")}
                </button>
                <span className={`badge ${isSuccessfulAttempt(attempt.status) ? "good" : attempt.status === "draft" ? "" : "warn"}`}>{uiLabel(attempt.status)}</span>
              </div>
            </div>

            <h3>{uiLabel("Rendered")}</h3>
            <div className="answer-panel">
              <p className="review-content">{renderBody}</p>
              {renderSections.map((section) => (
                <div key={section.id}>
                  <strong>{section.title}</strong>
                  <pre>{JSON.stringify(section.items, null, 2)}</pre>
                </div>
              ))}
            </div>

            <details className="object-technical">
              <summary>{t("技术信息与附加字段", "Technical details & additional fields")}</summary>
              <dl className="kv-list compact">
                <dt>{uiLabel("Revision")}</dt>
                <dd>{detail.fileRevisionSha256}</dd>
                <dt>{uiLabel("Content Hash")}</dt>
                <dd>{detail.objectContentSha256}</dd>
              </dl>
              <h3>{uiLabel("Additional Fields")}</h3>
              <pre className="readonly-json">{JSON.stringify(Object.fromEntries(additionalFields.map((field) => [field, detail.object[field]])), null, 2)}</pre>
              <p className="subtle">{uiLabel("Editable fields:")} {editable.map(uiLabel).join(", ") || uiLabel("none")}</p>
            </details>

            <h3>{uiLabel("Delete")}</h3>
            <p className="subtle">{uiLabel("Hard delete writes a tombstone, keeps review history, and performs no cascade.")}</p>
            <button type="button" onClick={() => void runDeletePreflight()}>
              <ShieldCheck size={16} aria-hidden="true" />{uiLabel("Run delete preflight")}
            </button>
            {deletePreflight && preflightMatches ? (
              <div className="delete-box">
                <p className={deletePreflight.canDelete ? "notice good" : "notice"}>{deletePreflight.canDelete ? uiLabel("No blocking references found.") : uiLabel("Delete is blocked.")}</p>
                <p className="subtle">{uiLabel("review history:")} {deletePreflight.reviewEventCount}</p>
                <pre>{JSON.stringify({ blockers: deletePreflight.blockers, warnings: deletePreflight.warnings, referenceCoverage: deletePreflight.referenceCoverage }, null, 2)}</pre>
                <label>
                  {uiLabel("Type full object ID")}
                  <input value={typedDeleteId} onChange={(event) => setTypedDeleteId(event.target.value)} />
                </label>
                <label>
                  {uiLabel("Reason")}
                  <textarea rows={2} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} />
                </label>
                <button
                  type="button"
                  onClick={() => void submitDelete()}
                  disabled={attempt.status === "submitting" || !canDeleteObject({ typedObjectId: typedDeleteId, expectedObjectId: String(detail.object.id), reason: deleteReason, canDelete: deletePreflight.canDelete })}
                >
                  <Trash2 size={16} aria-hidden="true" />{uiLabel("Permanent delete")}
                </button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">{uiLabel("Select an object to inspect or edit.")}</p>
        )}
      </div>
    </section>
  );
}

function attemptFor(actionName: CaptureActionName, endpoint: string, requestId: string, body: JsonObject): RequestAttemptState {
  return {
    requestId,
    frozenPayload: { actionName, endpoint, requestId, body: { ...body, requestId } },
    status: "submitting",
    lastResponse: null,
    lastError: null,
  };
}

function createRequestId(prefix: string): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function apiError(caught: unknown): { code: string; message: string } {
  if (caught instanceof ApiClientError) {
    return { code: caught.code, message: caught.message };
  }
  return { code: "network_unknown", message: "Network result was unknown" };
}

function errorText(caught: unknown, fallback: string): string {
  if (caught instanceof ApiClientError) {
    return `${caught.code}: ${caught.message}`;
  }
  return fallback;
}
