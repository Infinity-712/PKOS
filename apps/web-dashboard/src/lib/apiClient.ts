import type { JsonObject } from "../types.js";
import { isRecord } from "./guards.js";

type Guard<T> = (value: unknown) => value is T;

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function getJson<T>(path: string, guard: Guard<T>, signal?: AbortSignal): Promise<T> {
  return requestJson(path, { method: "GET", signal }, guard);
}

export async function postJson<T>(path: string, body: JsonObject, guard: Guard<T>, signal?: AbortSignal): Promise<T> {
  return requestJson(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    },
    guard,
  );
}

async function requestJson<T>(path: string, init: RequestInit, guard: Guard<T>): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : "network request failed";
    throw new ApiClientError(0, "network_unknown", message);
  }

  const payload = await parseResponseJson(response);
  if (!response.ok) {
    const error = errorPayload(payload);
    throw new ApiClientError(response.status, error.code, error.message);
  }
  if (!guard(payload)) {
    throw new ApiClientError(response.status, "invalid_response", "server response shape was not recognized");
  }
  return payload;
}

async function parseResponseJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { error: { code: "non_json_response", message: "server returned a non-JSON response" } };
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    return { error: { code: "invalid_json_response", message: "server returned invalid JSON" } };
  }
}

function errorPayload(payload: unknown): { code: string; message: string } {
  if (isRecord(payload) && isRecord(payload.error)) {
    const code = typeof payload.error.code === "string" ? payload.error.code : "request_failed";
    const message = typeof payload.error.message === "string" ? payload.error.message : "request failed";
    return { code, message };
  }
  return { code: "request_failed", message: "request failed" };
}
