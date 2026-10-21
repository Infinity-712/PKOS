import { translateUiMessage } from "../i18n/copy.js";
import { useLocale } from "../i18n/Locale.js";
import { RefreshCw, Filter, Plus, Send } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  EMPTY_ATTEMPT,
  applySubmitError,
  applySubmitResponse,
  isSuccessfulAttempt,
  resetAttempt,
  type RequestAttemptState,
} from "../features/actions/requestAttempt.js";
import { TaskDuePicker } from "../features/tasks/TaskDuePicker.js";
import {
  allowedTaskTransitions,
  buildTaskQuery,
  canSubmitTaskCreate,
  canSubmitTaskTransition,
  createTaskCreateDraft,
  createTaskTransitionDraft,
  startOrReuseTaskAttempt,
} from "../features/tasks/taskModel.js";
import { formatTaskDueAtBeijing } from "../features/tasks/taskDue.js";
import { ApiClientError, getJson, postJson } from "../lib/apiClient.js";
import { isActionSubmitResponse, isTaskListResponse } from "../lib/guards.js";
import type { TaskItem } from "../types.js";

type TaskFilters = {
  status: string;
  priority: string;
  tag: string;
  limit: string;
};

type TaskCreateDraft = {
  title: string;
  description: string;
  source: string;
  tags: string;
  priority: string;
  dueAt: string | null;
};

type TaskTransitionDraft = {
  targetStatus: string;
  reason: string;
};

const DEFAULT_FILTERS: TaskFilters = {
  status: "",
  priority: "",
  tag: "",
  limit: "50",
};

const DEFAULT_CREATE: TaskCreateDraft = {
  title: "",
  description: "",
  source: "web",
  tags: "",
  priority: "normal",
  dueAt: null,
};

export function TasksPage() {
  const { label: uiLabel, locale } = useLocale();
  const uiMessage = (value: string) => translateUiMessage(value, locale);
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS);
  const [items, setItems] = useState<TaskItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const query = buildTaskQuery(filters);
      const response = await getJson(`/api/pkos/tasks${query ? `?${query}` : ""}`, isTaskListResponse);
      setItems(response.items);
      if (selectedId && !response.items.some((item) => item.id === selectedId)) {
        setSelectedId(null);
      }
    } catch (caught) {
      setMessage(caught instanceof ApiClientError ? `${caught.code}: ${caught.message}` : "Task list failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;

  return (
    <section className="tasks-page">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{uiLabel("Tasks")}</h2>
            <p className="subtle">{uiLabel("Agent cannot automatically create, complete, or reorder formal tasks.")}</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={16} aria-hidden="true" />{uiLabel("Refresh")}
          </button>
        </div>
        <p className="notice">
          {uiLabel("Task state is produced only by explicit user actions. The authority is `tasks/items.jsonl` and `tasks/actions.jsonl`; runtime views are rebuildable.")}
        </p>
        <TaskFilters filters={filters} onChange={setFilters} onApply={() => void refresh()} />
        {message ? <p className="notice">{uiMessage(message)}</p> : null}
        <TaskList items={items} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
      </section>
      <TaskCreatePanel onWritten={() => void refresh()} />
      <TaskDetailPanel task={selected} onChanged={() => void refresh()} />
    </section>
  );
}

function TaskFilters(props: { filters: TaskFilters; onChange: (next: TaskFilters) => void; onApply: () => void }) {
  const { label: uiLabel } = useLocale();
  return (
    <div className="filter-row state-filter-row">
      <label>
        {uiLabel("status")}
        <select value={props.filters.status} onChange={(event) => props.onChange({ ...props.filters, status: event.target.value })}>
          <option value="">{uiLabel("all")}</option>
          <option value="open">{uiLabel("open")}</option>
          <option value="in_progress">{uiLabel("in_progress")}</option>
          <option value="blocked">{uiLabel("blocked")}</option>
          <option value="done">{uiLabel("done")}</option>
          <option value="cancelled">{uiLabel("cancelled")}</option>
        </select>
      </label>
      <label>
        {uiLabel("priority")}
        <select value={props.filters.priority} onChange={(event) => props.onChange({ ...props.filters, priority: event.target.value })}>
          <option value="">{uiLabel("all")}</option>
          <option value="low">{uiLabel("low")}</option>
          <option value="normal">{uiLabel("normal")}</option>
          <option value="high">{uiLabel("high")}</option>
        </select>
      </label>
      <label>
        {uiLabel("tag")}
        <input value={props.filters.tag} onChange={(event) => props.onChange({ ...props.filters, tag: event.target.value })} />
      </label>
      <label>
        {uiLabel("limit")}
        <input value={props.filters.limit} onChange={(event) => props.onChange({ ...props.filters, limit: event.target.value })} />
      </label>
      <button type="button" onClick={props.onApply}>
        <Filter size={16} aria-hidden="true" />{uiLabel("Apply")}
      </button>
    </div>
  );
}

function TaskList(props: { items: TaskItem[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { label: uiLabel } = useLocale();
  if (props.items.length === 0) {
    return <p className="muted">{uiLabel("No formal tasks for the current filters.")}</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{uiLabel("title")}</th>
            <th>{uiLabel("status")}</th>
            <th>{uiLabel("priority")}</th>
            <th>{uiLabel("due")}</th>
            <th>{uiLabel("created")}</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => (
            <tr key={item.id}>
              <td>
                <button className="link-button" type="button" onClick={() => props.onSelect(item.id)}>
                  {item.title}
                </button>
                {props.selectedId === item.id ? <span className="badge good">{uiLabel("selected")}</span> : null}
              </td>
              <td>
                <span className="badge">{uiLabel(item.status)}</span>
              </td>
              <td>{uiLabel(item.priority)}</td>
              <td>{formatTaskDueAtBeijing(item.dueAt) || uiLabel("none")}</td>
              <td>{item.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskCreatePanel(props: { onWritten: () => void }) {
  const { label: uiLabel, locale } = useLocale();
  const uiMessage = (value: string) => translateUiMessage(value, locale);
  const [draft, setDraft] = useState<TaskCreateDraft>(DEFAULT_CREATE);
  const [attempt, setAttempt] = useState<RequestAttemptState>(EMPTY_ATTEMPT);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setMessage(null);
    const input = {
      ...draft,
      tags: splitTags(draft.tags),
    };
    if (!canSubmitTaskCreate(input)) {
      setMessage("Title is required.");
      return;
    }
    const started = startOrReuseTaskAttempt(attempt, createTaskCreateDraft(input), createRequestId);
    setAttempt(started);
    if (!started.frozenPayload) {
      return;
    }
    try {
      const response = await postJson(started.frozenPayload.endpoint, started.frozenPayload.body, isActionSubmitResponse);
      const next = applySubmitResponse(started, response);
      setAttempt(next);
      if (isSuccessfulAttempt(next.status)) {
        props.onWritten();
      }
    } catch (caught) {
      setAttempt(errorAttempt(started, caught));
    }
  }

  return (
    <form className="panel form-panel" onSubmit={(event) => void submit(event)}>
      <h2>{uiLabel("Create Task")}</h2>
      <label>
        {uiLabel("title")}
        <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      </label>
      <label>
        {uiLabel("description")}
        <textarea rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
      </label>
      <div className="compact-grid">
        <label>
          {uiLabel("priority")}
          <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })}>
            <option value="low">{uiLabel("low")}</option>
            <option value="normal">{uiLabel("normal")}</option>
            <option value="high">{uiLabel("high")}</option>
          </select>
        </label>
        <label>
          {uiLabel("dueAt")}
          <TaskDuePicker value={draft.dueAt} onChange={(dueAt) => setDraft({ ...draft, dueAt })} />
        </label>
      </div>
      <label>
        {uiLabel("tags")}
        <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder={uiLabel("comma,separated")} />
      </label>
      <AttemptBox attempt={attempt} onNew={() => setAttempt(resetAttempt())} submitLabel={uiLabel("Create Task")} />
      {message ? <p className="notice">{uiMessage(message)}</p> : null}
    </form>
  );
}

function TaskDetailPanel(props: { task: TaskItem | null; onChanged: () => void }) {
  const { label: uiLabel } = useLocale();
  if (!props.task) {
    return (
      <section className="panel">
        <h2>{uiLabel("Task Detail")}</h2>
        <p className="muted">{uiLabel("Select a task to inspect and transition.")}</p>
      </section>
    );
  }
  return (
    <section className="panel form-panel">
      <h2>{uiLabel("Task Detail")}</h2>
      <dl className="kv-list">
        <dt>{uiLabel("id")}</dt>
        <dd>{props.task.id}</dd>
        <dt>{uiLabel("title")}</dt>
        <dd>{props.task.title}</dd>
        <dt>{uiLabel("description")}</dt>
        <dd>{props.task.description || uiLabel("none")}</dd>
        <dt>{uiLabel("status")}</dt>
        <dd>{uiLabel(props.task.status)}</dd>
        <dt>{uiLabel("priority")}</dt>
        <dd>{uiLabel(props.task.priority)}</dd>
        <dt>{uiLabel("due")}</dt>
        <dd>{formatTaskDueAtBeijing(props.task.dueAt) || uiLabel("none")}</dd>
        <dt>{uiLabel("latest reason")}</dt>
        <dd>{props.task.latestReason || uiLabel("none")}</dd>
      </dl>
      <TaskTransitionForm task={props.task} onChanged={props.onChanged} />
    </section>
  );
}

function TaskTransitionForm(props: { task: TaskItem; onChanged: () => void }) {
  const { label: uiLabel, locale } = useLocale();
  const uiMessage = (value: string) => translateUiMessage(value, locale);
  const options = allowedTaskTransitions(props.task.status);
  const [draft, setDraft] = useState<TaskTransitionDraft>({
    targetStatus: options[0] ?? "",
    reason: "",
  });
  const [attempt, setAttempt] = useState<RequestAttemptState>(EMPTY_ATTEMPT);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setDraft({
      targetStatus: allowedTaskTransitions(props.task.status)[0] ?? "",
      reason: "",
    });
    setAttempt(resetAttempt());
    setMessage(null);
  }, [props.task.id, props.task.status]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setMessage(null);
    const input = { taskId: props.task.id, ...draft };
    if (!canSubmitTaskTransition(input)) {
      setMessage("Target status and reason are required.");
      return;
    }
    const started = startOrReuseTaskAttempt(attempt, createTaskTransitionDraft(input), createRequestId);
    setAttempt(started);
    if (!started.frozenPayload) {
      return;
    }
    try {
      const response = await postJson(started.frozenPayload.endpoint, started.frozenPayload.body, isActionSubmitResponse);
      const next = applySubmitResponse(started, response);
      setAttempt(next);
      if (isSuccessfulAttempt(next.status)) {
        props.onChanged();
      }
    } catch (caught) {
      setAttempt(errorAttempt(started, caught));
    }
  }

  return (
    <form className="review-action" onSubmit={(event) => void submit(event)}>
      <h3>{uiLabel("Explicit Status Transition")}</h3>
      {options.length === 0 ? <p className="muted">{uiLabel("No transition target is available.")}</p> : null}
      <label>
        {uiLabel("targetStatus")}
        <select value={draft.targetStatus} onChange={(event) => setDraft({ ...draft, targetStatus: event.target.value })}>
          {options.map((option) => (
            <option key={option} value={option}>
              {uiLabel(option)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {uiLabel("reason")}
        <textarea rows={3} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} />
      </label>
      <AttemptBox attempt={attempt} onNew={() => setAttempt(resetAttempt())} submitLabel={uiLabel("Apply Transition")} />
      {attempt.status === "request_indeterminate" ? <p className="notice">{uiLabel("Open Action Requests to verify this write before retrying.")}</p> : null}
      {message ? <p className="notice">{uiMessage(message)}</p> : null}
    </form>
  );
}

function AttemptBox(props: { attempt: RequestAttemptState; onNew: () => void; submitLabel: string }) {
  const { label: uiLabel, locale, t } = useLocale();
  const uiMessage = (value: string) => translateUiMessage(value, locale);
  const frozen = props.attempt.frozenPayload;
  return (
    <div className="attempt-box">
      <div className="attempt-row">
        <button type="submit" disabled={props.attempt.status === "submitting"}>
          <Send size={16} aria-hidden="true" />
          {frozen ? uiLabel("Retry Same Request") : props.submitLabel}
        </button>
        <button type="button" onClick={props.onNew}>
          <Plus size={16} aria-hidden="true" />{uiLabel("New Request")}
        </button>
        <span className={`badge ${isSuccessfulAttempt(props.attempt.status) ? "good" : props.attempt.status === "draft" ? "" : "warn"}`}>{uiLabel(props.attempt.status)}</span>
      </div>
      {props.attempt.lastError ? <p className="notice" role="alert">{uiMessage(props.attempt.lastError)}</p> : null}
      <dl className="kv-list compact">
        <dt>{uiLabel("requestId")}</dt>
        <dd>{props.attempt.requestId ?? uiLabel("draft")}</dd>
        <dt>{uiLabel("frozen")}</dt>
        <dd>{frozen ? `${frozen.actionName}, ${JSON.stringify(frozen.body).length} ${t("字符", "chars")}` : uiLabel("none")}</dd>
      </dl>
    </div>
  );
}

function splitTags(value: string): string[] {
  return value.split(",").map((tag) => tag.trim()).filter(Boolean);
}

function errorAttempt(current: RequestAttemptState, caught: unknown): RequestAttemptState {
  if (caught instanceof ApiClientError) {
    return applySubmitError(current, { code: caught.code, message: caught.message });
  }
  return applySubmitError(current, { code: "network_unknown", message: "Network returned an unknown task write result." });
}

function createRequestId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
