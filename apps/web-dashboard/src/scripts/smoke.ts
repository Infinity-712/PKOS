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
