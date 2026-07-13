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
            <h2>Tasks</h2>
            <p className="subtle">Agent cannot automatically create, complete, or reorder formal tasks.</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </button>
        </div>
        <p className="notice">
          Task state is produced only by explicit user actions. The authority is `tasks/items.jsonl` and `tasks/actions.jsonl`; runtime views are rebuildable.
        </p>
        <TaskFilters filters={filters} onChange={setFilters} onApply={() => void refresh()} />
        {message ? <p className="notice">{message}</p> : null}
        <TaskList items={items} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
      </section>
      <TaskCreatePanel onWritten={() => void refresh()} />
      <TaskDetailPanel task={selected} onChanged={() => void refresh()} />
    </section>
  );
}

function TaskFilters(props: { filters: TaskFilters; onChange: (next: TaskFilters) => void; onApply: () => void }) {
  return (
    <div className="filter-row state-filter-row">
      <label>
        status
        <select value={props.filters.status} onChange={(event) => props.onChange({ ...props.filters, status: event.target.value })}>
          <option value="">all</option>
          <option value="open">open</option>
          <option value="in_progress">in_progress</option>
          <option value="blocked">blocked</option>
          <option value="done">done</option>
          <option value="cancelled">cancelled</option>
        </select>
      </label>
      <label>
        priority
        <select value={props.filters.priority} onChange={(event) => props.onChange({ ...props.filters, priority: event.target.value })}>
          <option value="">all</option>
          <option value="low">low</option>
          <option value="normal">normal</option>
          <option value="high">high</option>
        </select>
      </label>
      <label>
        tag
        <input value={props.filters.tag} onChange={(event) => props.onChange({ ...props.filters, tag: event.target.value })} />
      </label>
      <label>
        limit
        <input value={props.filters.limit} onChange={(event) => props.onChange({ ...props.filters, limit: event.target.value })} />
      </label>
      <button type="button" onClick={props.onApply}>
        Apply
      </button>
    </div>
  );
}

function TaskList(props: { items: TaskItem[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (props.items.length === 0) {
    return <p className="muted">No formal tasks for the current filters.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>title</th>
            <th>status</th>
            <th>priority</th>
            <th>due</th>
            <th>created</th>
          </tr>
        </thead>
        <tbody>
          {props.items.map((item) => (
            <tr key={item.id}>
              <td>
                <button className="link-button" type="button" onClick={() => props.onSelect(item.id)}>
                  {item.title}
                </button>
                {props.selectedId === item.id ? <span className="badge good">selected</span> : null}
              </td>
              <td>
                <span className="badge">{item.status}</span>
              </td>
              <td>{item.priority}</td>
              <td>{formatTaskDueAtBeijing(item.dueAt) || "none"}</td>
              <td>{item.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskCreatePanel(props: { onWritten: () => void }) {
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
      <h2>Create Task</h2>
      <label>
        title
        <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      </label>
      <label>
        description
        <textarea rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
      </label>
      <div className="compact-grid">
        <label>
          priority
          <select value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: event.target.value })}>
            <option value="low">low</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
          </select>
        </label>
        <label>
          dueAt
          <TaskDuePicker value={draft.dueAt} onChange={(dueAt) => setDraft({ ...draft, dueAt })} />
        </label>
      </div>
      <label>
        tags
        <input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="comma,separated" />
      </label>
      <AttemptBox attempt={attempt} onNew={() => setAttempt(resetAttempt())} submitLabel="Create Task" />
      {message ? <p className="notice">{message}</p> : null}
    </form>
  );
}

function TaskDetailPanel(props: { task: TaskItem | null; onChanged: () => void }) {
  if (!props.task) {
    return (
      <section className="panel">
        <h2>Task Detail</h2>
        <p className="muted">Select a task to inspect and transition.</p>
      </section>
    );
  }
  return (
    <section className="panel form-panel">
      <h2>Task Detail</h2>
      <dl className="kv-list">
        <dt>id</dt>
        <dd>{props.task.id}</dd>
        <dt>title</dt>
        <dd>{props.task.title}</dd>
        <dt>description</dt>
        <dd>{props.task.description || "none"}</dd>
        <dt>status</dt>
        <dd>{props.task.status}</dd>
        <dt>priority</dt>
        <dd>{props.task.priority}</dd>
        <dt>due</dt>
        <dd>{formatTaskDueAtBeijing(props.task.dueAt) || "none"}</dd>
        <dt>latest reason</dt>
        <dd>{props.task.latestReason || "none"}</dd>
      </dl>
      <TaskTransitionForm task={props.task} onChanged={props.onChanged} />
    </section>
  );
}

function TaskTransitionForm(props: { task: TaskItem; onChanged: () => void }) {
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
      <h3>Explicit Status Transition</h3>
      {options.length === 0 ? <p className="muted">No transition target is available.</p> : null}
      <label>
        targetStatus
        <select value={draft.targetStatus} onChange={(event) => setDraft({ ...draft, targetStatus: event.target.value })}>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label>
        reason
        <textarea rows={3} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} />
      </label>
      <AttemptBox attempt={attempt} onNew={() => setAttempt(resetAttempt())} submitLabel="Apply Transition" />
      {attempt.status === "request_indeterminate" ? <p className="notice">Open Action Requests to verify this write before retrying.</p> : null}
      {message ? <p className="notice">{message}</p> : null}
    </form>
  );
}

function AttemptBox(props: { attempt: RequestAttemptState; onNew: () => void; submitLabel: string }) {
  const frozen = props.attempt.frozenPayload;
  return (
    <div className="attempt-box">
      <div className="attempt-row">
        <button type="submit" disabled={props.attempt.status === "submitting"}>
          {frozen ? "Retry Same Request" : props.submitLabel}
        </button>
        <button type="button" onClick={props.onNew}>
          New Request
        </button>
        <span className={`badge ${isSuccessfulAttempt(props.attempt.status) ? "good" : props.attempt.status === "draft" ? "" : "warn"}`}>{props.attempt.status}</span>
      </div>
      <dl className="kv-list compact">
        <dt>requestId</dt>
        <dd>{props.attempt.requestId ?? "draft"}</dd>
        <dt>frozen</dt>
        <dd>{frozen ? `${frozen.actionName}, ${JSON.stringify(frozen.body).length} chars` : "none"}</dd>
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
