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
import { isActionRequestListResponse, isAuditEventsResponse, isHealthResponse } from "../lib/guards.js";

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

assert(!sourceContains("localStorage"), "dashboard source must not use localStorage");
assert(!sourceContains("系统判断你现在"), "dashboard contains diagnostic system-judgment copy");
assert(!sourceContains("你患有"), "dashboard contains diagnosis copy");
assert(!sourceContains("风险评分"), "dashboard contains risk scoring copy");
assert(!sourceContains("最佳任务是"), "dashboard contains task-reorder copy");
assert(!sourceContains("更新数据库状态"), "dashboard contains database-overwrite copy");
assert(!sourceContains("覆盖当前状态"), "dashboard contains state-overwrite copy");
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
