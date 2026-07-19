import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import { sendJson } from "../server/chatRoutes.js";
import type { ReminderScheduler } from "./ReminderScheduler.js";

export async function handleReminderRuntimeRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  scheduler: ReminderScheduler,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/api/runtime/reminder-notifications") {
    return false;
  }
  if (req.method !== "GET") {
    sendJson(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "route not found" } });
    return true;
  }
  const unknown = unknownQueryKeys(url, new Set(["now", "limit"]));
  if (unknown) {
    sendJson(res, 400, { ok: false, error: { code: "invalid_query", message: `query field is not allowed: ${unknown}` } });
    return true;
  }

  try {
    const result = await scheduler.scan({
      now: optionalString(url.searchParams.get("now")),
      limit: parseLimit(url.searchParams.get("limit")),
    });
    sendJson(res, 200, {
      ok: true,
      generatedAt: result.generatedAt,
      evaluatedAt: result.evaluatedAt,
      count: result.count,
      notifications: result.notifications,
    });
    return true;
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: { code: "reminder_scheduler_failed", message: error instanceof Error ? error.message : String(error) },
    });
    return true;
  }
}

function parseLimit(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return Math.max(1, Math.min(parsed, 200));
}

function optionalString(value: string | null): string | undefined {
  return value && value.trim() ? value : undefined;
}

function unknownQueryKeys(url: URL, allowed: Set<string>): string | null {
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) {
      return key;
    }
  }
  return null;
}
