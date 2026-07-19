import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import { sendJson } from "../server/chatRoutes.js";
import { PkosCliClient, type ReminderCliItem } from "../writeback/PkosCliClient.js";

const STATUSES = new Set(["scheduled", "acknowledged", "cancelled"]);

export async function handleReminderRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const listMatch = url.pathname === "/api/pkos/reminders";
  const detailMatch = /^\/api\/pkos\/reminders\/([^/]+)$/.exec(url.pathname);
  const dueMatch = url.pathname === "/api/pkos/reminders/due";

  if (!listMatch && !detailMatch && !dueMatch) {
    return false;
  }
  if (req.method !== "GET") {
    return false;
  }

  const allowed = dueMatch ? new Set(["now", "limit"]) : new Set(["status", "taskId", "source", "limit"]);
  const unknown = unknownQueryKeys(url, allowed);
  if (unknown) {
    sendJson(res, 400, { ok: false, error: { code: "invalid_query", message: `query field is not allowed: ${unknown}` } });
    return true;
  }

  try {
    const cli = new PkosCliClient();
    if (dueMatch) {
      const limit = parseLimit(url.searchParams.get("limit"));
      const now = optionalString(url.searchParams.get("now"));
      const due = await cli.reminderDue({ now, limit });
      if (!due.ok) {
        sendJson(res, 500, { ok: false, error: { code: due.errorCode, message: due.message } });
        return true;
      }
      sendJson(res, 200, {
        ok: true,
        generatedAt: due.generatedAt,
        evaluatedAt: due.evaluatedAt,
        count: due.count,
        due: due.due.map((item) => ({
          id: item.id,
          title: item.title,
          remindAt: item.remindAt,
          taskId: item.taskId,
          status: item.status,
          createdAt: item.createdAt,
          dueState: item.dueState,
        })),
        source: due.source,
      });
      return true;
    }

    const filters = filtersFromQuery(url);
    if (detailMatch) {
      const reminderId = decodeURIComponent(detailMatch[1]);
      const listed = await cli.reminderList({});
      if (!listed.ok) {
        sendJson(res, 500, { ok: false, error: { code: listed.errorCode, message: listed.message } });
        return true;
      }
      const reminder = listed.items.find((item) => item.id === reminderId);
      if (!reminder) {
        sendJson(res, 404, { ok: false, error: { code: "reminder_not_found", message: "reminder not found" } });
        return true;
      }
      sendJson(res, 200, { ok: true, reminder: toApiReminder(reminder), generatedAt: listed.generatedAt, source: listed.source });
      return true;
    }

    const listed = await cli.reminderList(filters);
    if (!listed.ok) {
      sendJson(res, 500, { ok: false, error: { code: listed.errorCode, message: listed.message } });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      generatedAt: listed.generatedAt,
      count: listed.count,
      filters,
      items: listed.items.map(toApiReminder),
      source: listed.source,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.endsWith(" is invalid")) {
      sendJson(res, 400, { ok: false, error: { code: "invalid_query", message } });
      return true;
    }
    sendJson(res, 500, { ok: false, error: { code: "reminder_query_failed", message } });
    return true;
  }
}

function filtersFromQuery(url: URL): { status?: string; taskId?: string; source?: string; limit?: number } {
  const status = optionalEnum(url.searchParams.get("status"), STATUSES, "status");
  const taskId = optionalString(url.searchParams.get("taskId"));
  const source = optionalString(url.searchParams.get("source"));
  const limit = parseLimit(url.searchParams.get("limit"));
  return { status, taskId, source, limit };
}

function optionalEnum(value: string | null, allowed: Set<string>, field: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (!allowed.has(value)) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function optionalString(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  return value;
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

function unknownQueryKeys(url: URL, allowed: Set<string>): string | null {
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) {
      return key;
    }
  }
  return null;
}

function toApiReminder(item: ReminderCliItem): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    remindAt: item.remindAt,
    taskId: item.taskId,
    source: item.source,
    status: item.status,
    createdAt: item.createdAt,
    createdBy: item.createdBy,
    latestActionId: item.latestActionId,
    latestActionAt: item.latestActionAt,
    latestReason: item.latestReason,
  };
}
