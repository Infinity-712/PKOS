import { useEffect, useState, type FormEvent } from "react";
import {
  EMPTY_ATTEMPT,
  applySubmitError,
  applySubmitResponse,
  isSuccessfulAttempt,
  resetAttempt,
  type RequestAttemptState,
} from "../features/actions/requestAttempt.js";
import {
  buildReminderQuery,
  canSubmitReminderAction,
  canSubmitReminderCreate,
  canSubmitReminderReschedule,
  createReminderActionDraft,
  createReminderCreateDraft,
  createReminderRescheduleDraft,
  startOrReuseReminderAttempt,
} from "../features/reminders/reminderModel.js";
import { TaskDuePicker } from "../features/tasks/TaskDuePicker.js";
import { formatTaskDueAtBeijing } from "../features/tasks/taskDue.js";
import { ApiClientError, getJson, postJson } from "../lib/apiClient.js";
import { isActionSubmitResponse, isReminderListResponse } from "../lib/guards.js";
import type { ReminderItem } from "../types.js";

type ReminderFilters = {
  status: string;
  taskId: string;
  source: string;
  limit: string;
};

type ReminderCreateDraft = {
  title: string;
  description: string;
  source: string;
  taskId: string;
  remindAt: string | null;
};

const DEFAULT_FILTERS: ReminderFilters = {
  status: "",
  taskId: "",
  source: "",
  limit: "50",
};

const DEFAULT_CREATE: ReminderCreateDraft = {
  title: "",
  description: "",
  source: "web",
  taskId: "",
  remindAt: null,
};

export function RemindersPage() {
  const [filters, setFilters] = useState<ReminderFilters>(DEFAULT_FILTERS);
  const [items, setItems] = useState<ReminderItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    setMessage(null);
    try {
      const query = buildReminderQuery(filters);
      const response = await getJson(`/api/pkos/reminders${query ? `?${query}` : ""}`, isReminderListResponse);
      setItems(response.items);
      if (selectedId && !response.items.some((item) => item.id === selectedId)) {
        setSelectedId(null);
      }
    } catch (caught) {
      setMessage(caught instanceof ApiClientError ? `${caught.code}: ${caught.message}` : "Reminder list failed");
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
            <h2>Reminders</h2>
            <p className="subtle">One-shot reminders are human-managed authority records.</p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </button>
        </div>
        <p className="notice">
          Reminders live in `reminders/items.jsonl` and `reminders/actions.jsonl`. Runtime notifications are rebuildable and are not authority.
        </p>
        <ReminderFilters filters={filters} onChange={setFilters} onApply={() => void refresh()} />
        {message ? <p className="notice">{message}</p> : null}
        <ReminderList items={items} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
      </section>
      <ReminderCreatePanel onWritten={() => void refresh()} />
      <ReminderDetailPanel reminder={selected} onChanged={() => void refresh()} />
    </section>
  );
}

function ReminderFilters(props: { filters: ReminderFilters; onChange: (next: ReminderFilters) => void; onApply: () => void }) {
  return (
    <div className="filter-row state-filter-row">
      <label>
        status
        <select value={props.filters.status} onChange={(event) => props.onChange({ ...props.filters, status: event.target.value })}>
          <option value="">all</option>
          <option value="scheduled">scheduled</option>
          <option value="acknowledged">acknowledged</option>
          <option value="cancelled">cancelled</option>
        </select>
      </label>
      <label>
        taskId
        <input value={props.filters.taskId} onChange={(event) => props.onChange({ ...props.filters, taskId: event.target.value })} />
      </label>
      <label>
        source
        <input value={props.filters.source} onChange={(event) => props.onChange({ ...props.filters, source: event.target.value })} />
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

function ReminderList(props: { items: ReminderItem[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (props.items.length === 0) {
    return <p className="muted">No reminders for the current filters.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>title</th>
            <th>status</th>
            <th>remind</th>
            <th>task</th>
            <th>source</th>
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
              <td>{formatTaskDueAtBeijing(item.remindAt) || item.remindAt}</td>
              <td>{item.taskId || "standalone"}</td>
              <td>{item.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReminderCreatePanel(props: { onWritten: () => void }) {
  const [draft, setDraft] = useState<ReminderCreateDraft>(DEFAULT_CREATE);
  const [attempt, setAttempt] = useState<RequestAttemptState>(EMPTY_ATTEMPT);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setMessage(null);
    if (!canSubmitReminderCreate(draft)) {
      setMessage("Title and remind time are required.");
      return;
    }
    const started = startOrReuseReminderAttempt(attempt, createReminderCreateDraft(draft), createRequestId);
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
      <h2>Create Reminder</h2>
      <label>
        title
        <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      </label>
      <label>
        description
        <textarea rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
      </label>
      <label>
        remindAt
        <TaskDuePicker value={draft.remindAt} onChange={(remindAt) => setDraft({ ...draft, remindAt })} />
      </label>
      <div className="compact-grid">
        <label>
          source
          <input value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })} />
        </label>
        <label>
          taskId
          <input value={draft.taskId} onChange={(event) => setDraft({ ...draft, taskId: event.target.value })} />
        </label>
      </div>
      <AttemptBox attempt={attempt} onNew={() => setAttempt(resetAttempt())} submitLabel="Create Reminder" />
      {message ? <p className="notice">{message}</p> : null}
    </form>
  );
}

function ReminderDetailPanel(props: { reminder: ReminderItem | null; onChanged: () => void }) {
  if (!props.reminder) {
    return (
      <section className="panel">
        <h2>Reminder Detail</h2>
        <p className="muted">Select a reminder to inspect and act on.</p>
      </section>
    );
  }
  return (
    <section className="panel form-panel">
      <h2>Reminder Detail</h2>
      <dl className="kv-list">
        <dt>id</dt>
        <dd>{props.reminder.id}</dd>
        <dt>title</dt>
        <dd>{props.reminder.title}</dd>
        <dt>description</dt>
        <dd>{props.reminder.description || "none"}</dd>
        <dt>status</dt>
        <dd>{props.reminder.status}</dd>
        <dt>remind</dt>
        <dd>{formatTaskDueAtBeijing(props.reminder.remindAt) || props.reminder.remindAt}</dd>
        <dt>task</dt>
        <dd>{props.reminder.taskId || "standalone"}</dd>
        <dt>latest reason</dt>
        <dd>{props.reminder.latestReason || "none"}</dd>
      </dl>
      <ReminderActionForm reminder={props.reminder} onChanged={props.onChanged} />
      <ReminderRescheduleForm reminder={props.reminder} onChanged={props.onChanged} />
    </section>
  );
}

function ReminderActionForm(props: { reminder: ReminderItem; onChanged: () => void }) {
  const [action, setAction] = useState<"acknowledge" | "cancel">("acknowledge");
  const [reason, setReason] = useState("");
  const [attempt, setAttempt] = useState<RequestAttemptState>(EMPTY_ATTEMPT);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setReason("");
    setAttempt(resetAttempt());
    setMessage(null);
  }, [props.reminder.id]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setMessage(null);
    const input = { reminderId: props.reminder.id, reason };
    if (!canSubmitReminderAction(input)) {
      setMessage("Reason is required.");
      return;
    }
    const started = startOrReuseReminderAttempt(attempt, createReminderActionDraft(action, input), createRequestId);
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
      <h3>Explicit Reminder Action</h3>
      <label>
        action
        <select value={action} onChange={(event) => setAction(event.target.value === "cancel" ? "cancel" : "acknowledge")}>
          <option value="acknowledge">acknowledge</option>
          <option value="cancel">cancel</option>
        </select>
      </label>
      <label>
        reason
        <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <AttemptBox attempt={attempt} onNew={() => setAttempt(resetAttempt())} submitLabel="Apply Reminder Action" />
      {message ? <p className="notice">{message}</p> : null}
    </form>
  );
}

function ReminderRescheduleForm(props: { reminder: ReminderItem; onChanged: () => void }) {
  const [remindAt, setRemindAt] = useState<string | null>(props.reminder.remindAt);
  const [reason, setReason] = useState("");
  const [attempt, setAttempt] = useState<RequestAttemptState>(EMPTY_ATTEMPT);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setRemindAt(props.reminder.remindAt);
    setReason("");
    setAttempt(resetAttempt());
    setMessage(null);
  }, [props.reminder.id, props.reminder.remindAt]);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setMessage(null);
    const input = { reminderId: props.reminder.id, remindAt, reason };
    if (!canSubmitReminderReschedule(input)) {
      setMessage("New remind time and reason are required.");
      return;
    }
    const started = startOrReuseReminderAttempt(attempt, createReminderRescheduleDraft(input), createRequestId);
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
      <h3>Reschedule</h3>
      <label>
        new remindAt
        <TaskDuePicker value={remindAt} onChange={setRemindAt} />
      </label>
      <label>
        reason
        <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <AttemptBox attempt={attempt} onNew={() => setAttempt(resetAttempt())} submitLabel="Reschedule Reminder" />
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

function errorAttempt(current: RequestAttemptState, caught: unknown): RequestAttemptState {
  if (caught instanceof ApiClientError) {
    return applySubmitError(current, { code: caught.code, message: caught.message });
  }
  return applySubmitError(current, { code: "network_unknown", message: "Network returned an unknown reminder write result." });
}

function createRequestId(): string {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `reminder-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
