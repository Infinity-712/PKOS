import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";

import { sendJson } from "../server/chatRoutes.js";
import { PkosCliClient, type ObjectCliResult } from "../writeback/PkosCliClient.js";

const ALLOWED_LIST_KEYS = new Set(["type", "status", "q", "limit"]);
const OBJECT_TYPES = new Set(["fact", "claim", "skill", "creative"]);
const MAX_LIMIT = 500;
const MAX_BODY_BYTES = 4096;

export async function handleObjectRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/pkos/object") && !url.pathname.startsWith("/api/pkos/objects")) {
    return false;
  }

  const cli = new PkosCliClient();
  try {
    if (req.method === "GET" && url.pathname === "/api/pkos/object-types") {
      assertAllowedQuery(url, new Set());
      return sendCliPayload(res, await cli.objectTypes());
    }
    if (req.method === "GET" && url.pathname === "/api/pkos/objects") {
      assertAllowedQuery(url, ALLOWED_LIST_KEYS);
      return sendCliPayload(
        res,
        await cli.objectList({
          type: optionalEnum(url.searchParams.get("type"), OBJECT_TYPES, "type"),
          status: optionalQuery(url, "status"),
          q: optionalQuery(url, "q"),
          limit: parseLimit(url.searchParams.get("limit")),
        }),
      );
    }
    const preflightMatch = /^\/api\/pkos\/objects\/([^/]+)\/delete-preflight$/.exec(url.pathname);
    if (preflightMatch && req.method === "POST") {
      assertAllowedQuery(url, new Set());
      const body = await readJsonObject(req);
      assertOnlyFields(body, new Set(["baseRevision"]));
      const baseRevision = optionalString(body.baseRevision, "baseRevision");
      return sendCliPayload(res, await cli.objectDeletePreflight({ objectId: decodeURIComponent(preflightMatch[1]), baseRevision }));
    }
    const renderMatch = /^\/api\/pkos\/objects\/([^/]+)\/render$/.exec(url.pathname);
    if (renderMatch && req.method === "GET") {
      assertAllowedQuery(url, new Set());
      return sendCliPayload(res, await cli.objectRender(decodeURIComponent(renderMatch[1])));
    }
    const detailMatch = /^\/api\/pkos\/objects\/([^/]+)$/.exec(url.pathname);
    if (detailMatch && req.method === "GET") {
      assertAllowedQuery(url, new Set());
      return sendCliPayload(res, await cli.objectGet(decodeURIComponent(detailMatch[1])));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 400, { ok: false, error: { code: "invalid_query", message } });
    return true;
  }

  return false;
}

function sendCliPayload(res: ServerResponse, result: ObjectCliResult): true {
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

function assertOnlyFields(value: Record<string, unknown>, allowed: Set<string>): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`field is not allowed: ${key}`);
    }
  }
}

function optionalQuery(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key);
  return value === null || value === "" ? undefined : value;
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
  if (!/^[0-9]+$/.test(value)) {
    throw new Error("limit must be an integer");
  }
  return Math.max(1, Math.min(Number.parseInt(value, 10), MAX_LIMIT));
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

async function readJsonObject(req: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = req.headers["content-type"];
  if (typeof contentType !== "string" || !contentType.toLowerCase().includes("application/json")) {
    throw new Error("request body must be application/json");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY_BYTES) {
      throw new Error("request body is too large");
    }
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function statusForCliError(code: string): number {
  if (code === "object_not_found") {
    return 404;
  }
  if (code === "object_revision_conflict" || code === "data_root_dirty") {
    return 409;
  }
  if (
    code === "invalid_object_id" ||
    code === "invalid_object_type" ||
    code === "invalid_revision" ||
    code === "object_load_failed" ||
    code === "schema_validation_failed"
  ) {
    return 400;
  }
  return 500;
}
