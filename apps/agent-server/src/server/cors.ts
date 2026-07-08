import type { IncomingMessage, ServerResponse } from "node:http";

export const allowedCorsOrigins = new Set(["http://127.0.0.1:5173", "pkos-desktop://app"]);

const allowedMethods = "GET,POST,OPTIONS";
const allowedHeaders = "Content-Type";
const exposedHeaders = "X-PKOS-Received-Origin";

export function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (typeof origin !== "string" || !allowedCorsOrigins.has(origin)) {
    return false;
  }
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Expose-Headers", exposedHeaders);
  res.setHeader("Vary", "Origin");
  res.setHeader("X-PKOS-Received-Origin", origin);
  return true;
}

export function handleCorsPreflight(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "OPTIONS") {
    return false;
  }

  const allowed = applyCors(req, res);
  if (!allowed) {
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: { code: "CORS_ORIGIN_REJECTED", message: "origin is not allowed" } }));
    return true;
  }

  res.setHeader("Access-Control-Allow-Methods", allowedMethods);
  res.setHeader("Access-Control-Allow-Headers", allowedHeaders);
  res.setHeader("Access-Control-Max-Age", "600");
  res.writeHead(204);
  res.end();
  return true;
}
