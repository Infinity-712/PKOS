import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  EMPTY_ATTEMPT,
  applySubmitError,
  applySubmitResponse,
  isSuccessfulAttempt,
  resetAttempt,
  startOrReuseAttempt,
  type ActionDraft,
} from "../features/actions/requestAttempt.js";
import {
  buildInboxReviewQuery,
  canSubmitInboxReviewAction,
  createInboxReviewActionDraft,
  inboxReviewMutationForItem,
  startOrReuseInboxReviewAttempt,
} from "../features/inbox-review/inboxReviewModel.js";
import {
  buildStateTimelineQuery,
  currentStateEmptyText,
  currentStateSourceText,
  hasStateTimelineMutationAction,
  stateStaleText,
} from "../features/state/stateModel.js";
import {
  allowedTaskTransitions,
  buildTaskQuery,
  canSubmitTaskCreate,
  canSubmitTaskTransition,
  createTaskCreateDraft,
  createTaskTransitionDraft,
  startOrReuseTaskAttempt,
} from "../features/tasks/taskModel.js";
import {
  beijingPartsToUtcIso,
  formatTaskDueAtBeijing,
} from "../features/tasks/taskDue.js";
import { isActionRequestListResponse, isAuditEventsResponse, isHealthResponse, isTaskListResponse } from "../lib/guards.js";
import { formatDateTime } from "@pkos/agent-client";

const draft: ActionDraft = {
  actionName: "inbox-append",
  body: {
    captureType: "note",
    content: "WEB_DASHBOARD_SMOKE_CAPTURE",
    source: "smoke",
    status: "unprocessed",
    tags: ["smoke"],
    metadata: { test: true },
  },
};

const first = startOrReuseAttempt(EMPTY_ATTEMPT, draft, () => "request-1");
assert(first.requestId === "request-1", "first submit did not create requestId");
assert(first.frozenPayload?.body.content === "WEB_DASHBOARD_SMOKE_CAPTURE", "first submit did not freeze payload");

const editedDraft: ActionDraft = {
  actionName: "inbox-append",
  body: {
    captureType: "note",
    content: "EDITED_CONTENT_SHOULD_NOT_REPLACE_FROZEN_PAYLOAD",
    source: "smoke",
    status: "unprocessed",
    tags: [],
    metadata: {},
  },
};
const retry = startOrReuseAttempt(first, editedDraft, () => "request-2");
assert(retry.requestId === "request-1", "retry changed requestId");
assert(retry.frozenPayload?.body.content === "WEB_DASHBOARD_SMOKE_CAPTURE", "retry changed frozen payload");

const indeterminate = applySubmitError(retry, {
  code: "request_indeterminate",
  message: "human verification required",
});
assert(indeterminate.status === "request_indeterminate", "request_indeterminate was not represented");
assert(!isSuccessfulAttempt(indeterminate.status), "request_indeterminate was treated as success");

const networkUnknown = applySubmitError(retry, {
  code: "network_unknown",
  message: "lost response",
});
assert(networkUnknown.status === "network_unknown", "network_unknown was not represented");

const written = applySubmitResponse(retry, {
  ok: true,
  requestId: "request-1",
  replayed: false,
  result: { status: "written", operation: "pkos.inbox.append" },
});
assert(written.status === "written", "written response was not represented");

const replayed = applySubmitResponse(retry, {
  ok: true,
  requestId: "request-1",
  replayed: true,
  result: { status: "written", operation: "pkos.inbox.append" },
});
assert(replayed.status === "replayed", "replayed response was not represented");
assert(resetAttempt().status === "draft", "reset did not return draft state");

const reviewQuery = buildInboxReviewQuery({ status: "archived", source: "moonlolo", tag: "alpha", limit: "20" });
assert(reviewQuery === "status=archived&source=moonlolo&tag=alpha&limit=20", "inbox review query builder failed");

const archiveDraft = createInboxReviewActionDraft({
  itemId: "inbox.review.1",
  action: "archive",
  reason: "reviewed",
  confirmed: true,
});
const archiveAttempt = startOrReuseInboxReviewAttempt(EMPTY_ATTEMPT, archiveDraft, () => "review-request-1");
assert(archiveAttempt.requestId === "review-request-1", "inbox review archive did not create requestId");
assert(archiveAttempt.frozenPayload?.endpoint === "/api/pkos/inbox-review/inbox.review.1/archive", "archive endpoint was not fixed");

const retryArchive = startOrReuseInboxReviewAttempt(
  archiveAttempt,
  createInboxReviewActionDraft({
    itemId: "inbox.review.1",
    action: "archive",
    reason: "edited reason must not replace frozen payload",
    confirmed: true,
  }),
  () => "review-request-2",
);
assert(retryArchive.requestId === "review-request-1", "inbox review retry changed requestId");
assert(retryArchive.frozenPayload?.body.reason === "reviewed", "inbox review retry changed frozen reason");

const newArchive = startOrReuseInboxReviewAttempt(resetAttempt(), archiveDraft, () => "review-request-3");
assert(newArchive.requestId === "review-request-3", "new inbox review request did not create a fresh requestId");
assert(!canSubmitInboxReviewAction({ itemId: "inbox.review.1", action: "archive", reason: "reviewed", confirmed: false }), "unconfirmed action was submittable");
assert(inboxReviewMutationForItem({ id: "inbox.review.2", effectiveStatus: "converted" }) === null, "converted item exposed a mutation action");

const stateQuery = buildStateTimelineQuery({ energy: "low", mood: "anxious", mode: "recovery", limit: "20", note: "DO_NOT_PUT_NOTE_IN_URL" });
assert(stateQuery === "energy=low&mood=anxious&mode=recovery&limit=20", "state timeline query builder failed");
assert(stateQuery.indexOf("note") === -1 && stateQuery.indexOf("DO_NOT_PUT_NOTE_IN_URL") === -1, "state note leaked into query");
const stateDraft: ActionDraft = {
  actionName: "state-append",
  body: {
    energy: "low",
    mood: "anxious",
    body: "tired",
    context: "home",
    mode: "recovery",
    risk: { overload: "high" },
    source: "web",
    note: "STATE_NOTE_SHOULD_REMAIN_FROZEN",
  },
};
const firstStateSubmit = startOrReuseAttempt(EMPTY_ATTEMPT, stateDraft, () => "state-request-1");
const stateRetry = startOrReuseAttempt(
  firstStateSubmit,
  {
    ...stateDraft,
    body: { ...stateDraft.body, note: "EDITED_STATE_NOTE_SHOULD_NOT_REPLACE_FROZEN_PAYLOAD" },
  },
  () => "state-request-2",
);
assert(stateRetry.requestId === "state-request-1", "state capture retry changed requestId");
assert(stateRetry.frozenPayload?.body.note === "STATE_NOTE_SHOULD_REMAIN_FROZEN", "state capture retry changed frozen note");
assert(
  isSuccessfulAttempt(
    applySubmitResponse(stateRetry, {
      ok: true,
      requestId: "state-request-1",
      replayed: false,
      result: { status: "written", operation: "pkos.state.append" },
    }).status,
  ),
  "state capture written response was not treated as successful",
);
assert(currentStateEmptyText() === "尚无状态快照。", "empty current state text changed");
assert(currentStateSourceText().includes("最近一次显式状态快照"), "current source boundary text missing");
const staleWarning = stateStaleText(true);
assert(staleWarning !== null && staleWarning.includes("不一定代表现在"), "stale text missing freshness warning");
assert(stateStaleText(false) === null, "fresh state produced stale text");
assert(!hasStateTimelineMutationAction("edit"), "timeline exposed edit action");
assert(!hasStateTimelineMutationAction("delete"), "timeline exposed delete action");
assert(sourceContains('submitLabel="记录新状态快照"'), "state capture submit label is missing");
assert(sourceContains("onWritten={() => void refresh()}"), "state capture success is not wired to timeline refresh");

const taskQuery = buildTaskQuery({ status: "open", priority: "high", tag: "alpha", limit: "20", title: "DO_NOT_PUT_TITLE_IN_URL" });
assert(taskQuery === "status=open&priority=high&tag=alpha&limit=20", "task query builder failed");
assert(taskQuery.indexOf("title") === -1 && taskQuery.indexOf("DO_NOT_PUT_TITLE_IN_URL") === -1, "task title leaked into query");
const taskCreateDraft = createTaskCreateDraft({
  title: "WEB_TASK_TITLE",
  description: "WEB_TASK_DESCRIPTION",
  source: "web",
  tags: ["alpha"],
  priority: "high",
  dueAt: "2026-07-12T03:04:05Z",
});
const taskCreateAttempt = startOrReuseTaskAttempt(EMPTY_ATTEMPT, taskCreateDraft, () => "task-request-1");
assert(taskCreateAttempt.frozenPayload?.endpoint === "/api/pkos/tasks", "task create endpoint was not fixed");
assert(taskCreateAttempt.frozenPayload?.body.title === "WEB_TASK_TITLE", "task create did not freeze title");
assert(taskCreateAttempt.frozenPayload?.body.confirmed === true, "task create button did not auto-confirm explicit mutation");
const taskCreateRetry = startOrReuseTaskAttempt(
  taskCreateAttempt,
  createTaskCreateDraft({
    title: "EDITED_TASK_TITLE_SHOULD_NOT_REPLACE_FROZEN_PAYLOAD",
    description: "edited",
    source: "web",
    tags: [],
    priority: "normal",
    dueAt: "",
  }),
  () => "task-request-2",
);
assert(taskCreateRetry.requestId === "task-request-1", "task create retry changed requestId");
assert(taskCreateRetry.frozenPayload?.body.title === "WEB_TASK_TITLE", "task create retry changed frozen payload");
assert(canSubmitTaskCreate({ title: "x", description: "", source: "web", tags: [], priority: "normal", dueAt: "" }), "valid task create was not submittable");
assert(!canSubmitTaskCreate({ title: "", description: "", source: "web", tags: [], priority: "normal", dueAt: "" }), "empty task title was submittable");
assert(allowedTaskTransitions("open").join(",") === "in_progress,blocked,done,cancelled", "open transition options changed");
assert(allowedTaskTransitions("done").join(",") === "open", "done transition options changed");
const transitionDraft = createTaskTransitionDraft({ taskId: "task.1", targetStatus: "done", reason: "finished" });
const transitionAttempt = startOrReuseTaskAttempt(EMPTY_ATTEMPT, transitionDraft, () => "task-transition-1");
assert(transitionAttempt.frozenPayload?.endpoint === "/api/pkos/tasks/task.1/transition", "task transition endpoint was not fixed");
assert(transitionAttempt.frozenPayload?.body.reason === "finished", "task transition did not freeze reason");
assert(transitionAttempt.frozenPayload?.body.confirmed === true, "task transition button did not auto-confirm explicit mutation");
assert(canSubmitTaskTransition({ taskId: "task.1", targetStatus: "done", reason: "finished" }), "valid transition was not submittable");
assert(!canSubmitTaskTransition({ taskId: "task.1", targetStatus: "done", reason: "" }), "empty transition reason was submittable");
assert(beijingPartsToUtcIso(2026, 7, 15, 18, 0) === "2026-07-15T10:00:00.000Z", "Beijing task due time did not convert to UTC");
assert(formatTaskDueAtBeijing("2026-07-15T10:00:00.000Z") === "2026-07-15 18:00", "UTC task due time was not shown as Beijing time");
assert(formatDateTime("2026-07-12T03:04:05Z") === "2026-07-12 11:04:05", "shared time formatter regressed");

assert(isHealthResponse({ ok: true, service: "pkos-agent-server", mode: "dry-run" }), "health guard failed");
assert(
  isActionRequestListResponse({
    ok: true,
    requests: [
      {
        requestId: "r1",
        actionName: "inbox-append",
        payloadSha256: "hash",
        storedStatus: "completed",
        effectiveStatus: "completed",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:01.000Z",
        stale: false,
      },
    ],
  }),
  "action request guard failed",
);
assert(
  isAuditEventsResponse({
    items: [
      {
        id: "e1",
        ts: "2026-07-01T00:00:00.000Z",
        type: "content_delta",
        severity: "debug",
        payloadSummary: { deltaChars: 3 },
      },
    ],
    nextBefore: null,
  }),
  "audit guard failed",
);
assert(
  isTaskListResponse({
    ok: true,
    count: 1,
    generatedAt: "2026-07-11T00:00:00Z",
    filters: {},
    items: [
      {
        id: "task.1",
        title: "Task",
        description: null,
        status: "open",
        priority: "normal",
        source: "web",
        tags: [],
        dueAt: null,
        createdAt: "2026-07-11T00:00:00Z",
        createdBy: "human",
        latestActionId: null,
        latestActionAt: null,
        latestReason: null,
        notesCount: 0,
        latestNoteAt: null,
      },
    ],
    source: {},
  }),
  "task list guard failed",
);
const unicodeTaskListPayload = {
  ok: true,
  count: 1,
  generatedAt: "2026-07-13T00:00:00Z",
  filters: {},
  items: [
    {
      id: "task.unicode",
      title: "中文读取验证：测试任务二",
      description: "验证 JSONL、Python stdout、Node、HTTP 和 Web 客户端",
      status: "in_progress",
      priority: "normal",
      source: "web",
      tags: ["unicode"],
      dueAt: "2026-07-15T10:00:00Z",
      createdAt: "2026-07-13T00:00:00Z",
      createdBy: "human",
      latestActionId: "task_action.unicode",
      latestActionAt: "2026-07-13T00:01:00Z",
      latestReason: "开始中文读取链路验收",
      notesCount: 0,
      latestNoteAt: null,
    },
  ],
  source: {},
};
assert(isTaskListResponse(unicodeTaskListPayload), "unicode task list guard failed");
const unicodeTaskItem = unicodeTaskListPayload.items[0];
assert(unicodeTaskItem.title === "中文读取验证：测试任务二", "web task list view model changed Chinese title");
assert(unicodeTaskItem.description === "验证 JSONL、Python stdout、Node、HTTP 和 Web 客户端", "web task detail view model changed Chinese description");
assert(unicodeTaskItem.latestReason === "开始中文读取链路验收", "web task detail view model changed Chinese latest reason");
assert(!JSON.stringify(unicodeTaskListPayload).includes("锟") && !JSON.stringify(unicodeTaskListPayload).includes("�"), "web task payload contains mojibake replacement text");

assert(!sourceContains("localStorage"), "dashboard source must not use localStorage");
assert(!sourceContains("系统判断你现在"), "dashboard contains diagnostic system-judgment copy");
assert(!sourceContains("你患有"), "dashboard contains diagnosis copy");
assert(!sourceContains("风险评分"), "dashboard contains risk scoring copy");
assert(!sourceContains("最佳任务是"), "dashboard contains task-reorder copy");
assert(!sourceContains("更新数据库状态"), "dashboard contains database-overwrite copy");
assert(!sourceContains("覆盖当前状态"), "dashboard contains state-overwrite copy");
assert(!sourceContains("AI priority"), "dashboard contains AI task priority copy");
assert(!sourceContains("Reminder Scheduler"), "dashboard contains reminder scheduler UI copy");
assert(!sourceContains("I confirm this is a human-created formal task."), "task create confirm checkbox copy still exists");
assert(!sourceContains("I confirm this explicit transition."), "task transition confirm checkbox copy still exists");
assert(!sourceContains("task-note"), "task note UI/model path still exists");
assert(sourceContains("Tasks"), "Tasks tab/page source is missing");
assert(sourceContains("Agent cannot automatically create, complete, or reorder formal tasks."), "task authority boundary copy is missing");
console.log("WEB_DASHBOARD_SMOKE_OK");

function sourceContains(pattern: string): boolean {
  return readFiles(join(process.cwd(), "src")).some((content) => content.includes(pattern));
}

function readFiles(root: string): string[] {
  const entries = readdirSync(root);
  const contents: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      contents.push(...readFiles(path));
  } else if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && !path.endsWith(join("scripts", "smoke.ts"))) {
      contents.push(readFileSync(path, "utf8"));
    }
  }
  return contents;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
