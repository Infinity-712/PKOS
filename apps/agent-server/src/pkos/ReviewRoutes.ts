import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import { sendJson } from "../server/chatRoutes.js";
import { PkosCliClient } from "../writeback/PkosCliClient.js";

type ReviewRouteDeps = {
  cli?: PkosCliClient;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const ALLOWED_QUEUE_KEYS = new Set(["now", "limit"]);
const ALLOWED_STATUS_KEYS = new Set(["now"]);

export async function handleReviewRoutes(req: IncomingMessage, res: ServerResponse, deps: ReviewRouteDeps = {}): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/pkos/review")) {
    return false;
  }
  if (req.method !== "GET") {
    return false;
  }

  const cli = deps.cli ?? new PkosCliClient();
  try {
    if (url.pathname === "/api/pkos/review/queue") {
      assertAllowedQuery(url, ALLOWED_QUEUE_KEYS);
      const result = await cli.reviewQueue({ now: optionalQuery(url, "now"), limit: parseLimit(url.searchParams.get("limit")) });
      return sendCliPayload(res, result);
    }
    if (url.pathname === "/api/pkos/review/status") {
      assertAllowedQuery(url, ALLOWED_STATUS_KEYS);
      const result = await cli.reviewStatus({ now: optionalQuery(url, "now") });
      return sendCliPayload(res, result);
    }
    const historyMatch = /^\/api\/pkos\/review\/items\/([^/]+)\/history$/.exec(url.pathname);
    if (historyMatch) {
      assertAllowedQuery(url, new Set());
      const result = await cli.reviewHistory(decodeURIComponent(historyMatch[1]));
      return sendCliPayload(res, result);
    }
    const itemMatch = /^\/api\/pkos\/review\/items\/([^/]+)$/.exec(url.pathname);
    if (itemMatch) {
      assertAllowedQuery(url, new Set());
      const result = await cli.reviewGet(decodeURIComponent(itemMatch[1]));
      return sendCliPayload(res, result);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: { code: "INVALID_QUERY", message } });
    return true;
  }

  return false;
}

function sendCliPayload(res: ServerResponse, result: Awaited<ReturnType<PkosCliClient["reviewQueue"]>>): true {
  if (!result.ok) {
    sendJson(res, statusForCliError(result.errorCode), { ok: false, error: { code: result.errorCode, message: result.message } });
    return true;
  }
  sendJson(res, 200, result.payload);
  return true;
}

function assertAllowedQuery(url: URL, allowed: Set<string>): void {
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) {
      throw new Error(`unknown query parameter: ${key}`);
    }
    if (url.searchParams.getAll(key).length > 1) {
      throw new Error(`query parameter may appear once: ${key}`);
    }
  }
}

function optionalQuery(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value === null || value === "" ? undefined : value;
}

function parseLimit(value: string | null): number {
  if (value === null || value === "") {
    return DEFAULT_LIMIT;
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("limit must be an integer");
  }
  const parsed = Number.parseInt(value, 10);
  if (parsed < 1 || parsed > MAX_LIMIT) {
    throw new Error(`limit must be between 1 and ${MAX_LIMIT}`);
  }
  return parsed;
}

function statusForCliError(code: string): number {
  if (code === "review_item_not_found" || code === "object_not_found") {
    return 404;
  }
  if (code === "malformed_review_log") {
    return 500;
  }
  return 500;
}
