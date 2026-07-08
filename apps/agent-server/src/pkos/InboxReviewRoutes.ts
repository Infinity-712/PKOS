import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import { sendJson } from "../server/chatRoutes.js";
import { PkosCliClient, type InboxReviewCliItem } from "../writeback/PkosCliClient.js";

type InboxReviewRouteDeps = {
  cli?: PkosCliClient;
};

const ALLOWED_QUERY_KEYS = new Set(["status", "source", "tag", "limit"]);
const ALLOWED_STATUSES = new Set(["unprocessed", "archived", "converted"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_FILTER_CHARS = 128;

export async function handleInboxReviewRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  deps: InboxReviewRouteDeps = {},
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/api/pkos/inbox-review") {
    return false;
  }

  if (req.method !== "GET") {
    return false;
  }

  try {
    const filters = parseListQuery(url);
    const cli = deps.cli ?? new PkosCliClient();
    const result = await cli.inboxReviewList(filters);
    if (!result.ok) {
      sendJson(res, 500, { ok: false, error: { code: result.errorCode, message: result.message } });
      return true;
    }
    sendJson(res, 200, {
      items: result.items.map(normalizeItem),
      count: result.count,
      generatedAt: result.generatedAt,
      filters,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: { code: "INVALID_QUERY", message } });
  }
  return true;
}

function parseListQuery(url: URL): {
  status?: string;
  source?: string;
  tag?: string;
  limit: number;
} {
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      throw new Error(`unknown query parameter: ${key}`);
    }
    if (url.searchParams.getAll(key).length > 1) {
      throw new Error(`query parameter may appear once: ${key}`);
    }
  }
  const status = parseStatus(url.searchParams.get("status"));
  return {
    status,
    source: parseFilter(url.searchParams.get("source"), "source"),
    tag: parseFilter(url.searchParams.get("tag"), "tag"),
    limit: parseLimit(url.searchParams.get("limit")),
  };
}

function parseStatus(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  if (!ALLOWED_STATUSES.has(value)) {
    throw new Error("status must be one of: archived, converted, unprocessed");
  }
  return value;
}

function parseFilter(value: string | null, name: string): string | undefined {
  if (value === null || value === "") {
    return undefined;
  }
  if (value.length > MAX_FILTER_CHARS) {
    throw new Error(`${name} is too long`);
  }
  return value;
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

function normalizeItem(item: InboxReviewCliItem): Record<string, unknown> {
  return {
    id: item.id,
    captureType: item.capture_type,
    content: item.content,
    source: item.source,
    tags: item.tags,
    createdAt: item.created_at,
    effectiveStatus: item.effective_status,
    latestAction: item.review_action_id
      ? {
          status: item.effective_status,
          reason: item.review_reason,
          createdAt: item.reviewed_at,
        }
      : null,
  };
}
