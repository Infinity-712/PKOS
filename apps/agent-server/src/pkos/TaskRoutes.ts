import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import { sendJson } from "../server/chatRoutes.js";
import { PkosCliClient, type TaskCliItem } from "../writeback/PkosCliClient.js";

const STATUSES = new Set(["open", "in_progress", "blocked", "done", "cancelled"]);
const PRIORITIES = new Set(["low", "normal", "high"]);

export async function handleTaskRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const listMatch = url.pathname === "/api/pkos/tasks";
  const detailMatch = /^\/api\/pkos\/tasks\/([^/]+)$/.exec(url.pathname);

  if (!listMatch && !detailMatch) {
    return false;
  }
  if (req.method !== "GET") {
    return false;
  }

  const unknown = unknownQueryKeys(url, new Set(["status", "priority", "tag", "limit"]));
  if (unknown) {
    sendJson(res, 400, { ok: false, error: { code: "invalid_query", message: `query field is not allowed: ${unknown}` } });
    return true;
  }

  try {
    const cli = new PkosCliClient();
    const filters = filtersFromQuery(url);
    if (detailMatch) {
      const taskId = decodeURIComponent(detailMatch[1]);
      const listed = await cli.taskList({});
      if (!listed.ok) {
        sendJson(res, 500, { ok: false, error: { code: listed.errorCode, message: listed.message } });
        return true;
      }
      const task = listed.items.find((item) => item.id === taskId);
      if (!task) {
        sendJson(res, 404, { ok: false, error: { code: "task_not_found", message: "task not found" } });
        return true;
      }
      sendJson(res, 200, { ok: true, task: toApiTask(task), generatedAt: listed.generatedAt, source: listed.source });
      return true;
    }

    const listed = await cli.taskList(filters);
    if (!listed.ok) {
      sendJson(res, 500, { ok: false, error: { code: listed.errorCode, message: listed.message } });
      return true;
    }
    sendJson(res, 200, {
      ok: true,
      generatedAt: listed.generatedAt,
      count: listed.count,
      filters,
      items: listed.items.map(toApiTask),
      source: listed.source,
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.endsWith(" is invalid")) {
      sendJson(res, 400, { ok: false, error: { code: "invalid_query", message } });
      return true;
    }
    sendJson(res, 500, { ok: false, error: { code: "task_query_failed", message } });
    return true;
  }
}

function filtersFromQuery(url: URL): { status?: string; priority?: string; tag?: string; limit?: number } {
  const status = optionalEnum(url.searchParams.get("status"), STATUSES, "status");
  const priority = optionalEnum(url.searchParams.get("priority"), PRIORITIES, "priority");
  const tag = url.searchParams.get("tag") ?? undefined;
  const limit = parseLimit(url.searchParams.get("limit"));
  return { status, priority, tag, limit };
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

function toApiTask(item: TaskCliItem): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    source: item.source,
    tags: item.tags,
    priority: item.priority,
    dueAt: item.dueAt,
    createdAt: item.createdAt,
    createdBy: item.createdBy,
    status: item.status,
    latestActionId: item.latestActionId,
    latestActionAt: item.latestActionAt,
    latestReason: item.latestReason,
    notesCount: item.notesCount,
    latestNoteAt: item.latestNoteAt,
  };
}
