import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import { sendJson } from "../server/chatRoutes.js";
import { PkosCliClient, type StateTimelineCliItem } from "../writeback/PkosCliClient.js";

type StateTimelineRouteDeps = {
  cli?: PkosCliClient;
};

const ALLOWED_QUERY_KEYS = new Set(["limit", "energy", "mood", "mode"]);
const ENERGY_VALUES = new Set(["high", "low", "medium", "overloaded", "unknown", "very_low"]);
const MOOD_VALUES = new Set(["anxious", "calm", "excited", "irritated", "low", "numb", "overloaded", "unknown"]);
const MODE_VALUES = new Set(["life", "other", "project", "quiet", "recovery", "social", "study", "unknown", "writing"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const FRESHNESS_MS = 24 * 60 * 60 * 1000;

export async function handleStateTimelineRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  deps: StateTimelineRouteDeps = {},
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/api/pkos/state-timeline") {
    return false;
  }
  if (req.method !== "GET") {
    return false;
  }

  let filters: { energy?: string; mood?: string; mode?: string; limit: number };
  try {
    filters = parseQuery(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: { code: "INVALID_QUERY", message } });
    return true;
  }

  const cli = deps.cli ?? new PkosCliClient();
  const result = await cli.stateTimeline(filters);
  if (!result.ok) {
    sendJson(res, 500, {
      ok: false,
      error: {
        code: "state_timeline_failed",
        message: "State timeline query failed integrity checks",
      },
    });
    return true;
  }

  sendJson(res, 200, {
    current: result.current ? normalizeState(result.current) : null,
    items: result.items.map(normalizeState),
    count: result.count,
    filters: result.filters,
  });
  return true;
}

function parseQuery(url: URL): { energy?: string; mood?: string; mode?: string; limit: number } {
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      throw new Error(`unknown query parameter: ${key}`);
    }
    if (url.searchParams.getAll(key).length > 1) {
      throw new Error(`query parameter may appear once: ${key}`);
    }
  }
  return {
    energy: parseEnum(url.searchParams.get("energy"), "energy", ENERGY_VALUES),
    mood: parseEnum(url.searchParams.get("mood"), "mood", MOOD_VALUES),
    mode: parseEnum(url.searchParams.get("mode"), "mode", MODE_VALUES),
    limit: parseLimit(url.searchParams.get("limit")),
  };
}

function parseEnum(value: string | null, name: string, allowed: ReadonlySet<string>): string | undefined {
  if (value === null || value === "") {
    return undefined;
  }
  if (!allowed.has(value)) {
    throw new Error(`${name} is not allowed`);
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

function normalizeState(item: StateTimelineCliItem): Record<string, unknown> {
  return {
    id: item.id,
    source: item.source,
    energy: item.energy,
    mood: item.mood,
    body: item.body,
    context: item.context,
    mode: item.mode,
    risk: item.risk,
    note: item.note,
    createdAt: item.created_at,
    stale: isStale(item.created_at),
  };
}

function isStale(createdAt: string): boolean {
  const date = Date.parse(createdAt);
  if (Number.isNaN(date)) {
    return true;
  }
  return Date.now() - date > FRESHNESS_MS;
}
