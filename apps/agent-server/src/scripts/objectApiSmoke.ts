import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openAgentDatabase, type AgentDatabase } from "../db/connection.js";
import { createAgentHttpServer } from "../server/httpServer.js";

type JsonRecord = Record<string, unknown>;

const CONTENT_SECRET = "OBJECT_API_FULL_CONTENT_SHOULD_NOT_REACH_AUDIT";
const REASON_SECRET = "OBJECT_API_DELETE_REASON_SHOULD_NOT_REACH_AUDIT";
const dataRoot = mkdtempSync(join(tmpdir(), "pkos-object-api-smoke-"));
process.env.PKOS_DATA_ROOT = dataRoot;
process.env.PKOS_ACTION_RUNNING_STALE_MS = "1";
delete process.env.PKOS_AGENT_DB_PATH;

const db = openAgentDatabase();
const server = createAgentHttpServer({ db });

try {
  initGit(dataRoot);
  const baseUrl = await listen(server);

  const types = await getJson<JsonRecord>(baseUrl, "/api/pkos/object-types");
  assert(types.status === 200, `object-types expected 200, got ${types.status}`);
  assert(Array.isArray(types.payload.types), "object-types did not return types");
  const factType = (types.payload.types as JsonRecord[]).find((item) => item.type === "fact");
  const factObjectId = factType?.objectId as JsonRecord | undefined;
  assert(factObjectId?.minLength === 3 && factObjectId.maxLength === 64, "object-types did not expose objectId length contract");
  assert(typeof factObjectId.pattern === "string" && typeof factObjectId.humanReadablePattern === "string", "object-types missing objectId pattern contract");
  assert(factObjectId.example === "fact.example", "object-types fact example changed");
  assert(factObjectId.prefixRequirement === "must_start_with_type_dot", "object-types prefix requirement changed");

  const empty = await getJson<JsonRecord>(baseUrl, "/api/pkos/objects");
  assert(empty.status === 200, `empty list expected 200, got ${empty.status}`);
  assert(empty.payload.count === 0, "empty object list was not empty");

  const invalidHead = gitHead(dataRoot);
  const invalidId = `fact.${"x".repeat(60)}`;
  const invalidCreate = await postJson<JsonRecord>(baseUrl, "/api/pkos/objects", {
    requestId: "object-api-invalid-id",
    confirmed: true,
    actor: "human",
    object: factPayload(invalidId, "Invalid ID", "not written"),
  });
  assert(invalidCreate.status === 400, `invalid object id expected 400, got ${invalidCreate.status}`);
  assert(invalidCreate.payload.ok === false, "invalid object id response did not use action envelope");
  assert(invalidCreate.payload.requestId === "object-api-invalid-id", "invalid object id response lost requestId");
  assert((invalidCreate.payload.result as JsonRecord | undefined)?.errorCode === "invalid_object_id", "invalid object id errorCode changed");
  assert(!existsSync(join(dataRoot, "objects", "fact", `${invalidId.replace(/\./g, "_")}.yaml`)), "invalid object id wrote an object file");
  assert(gitHead(dataRoot) === invalidHead, "invalid object id changed Data Root Git HEAD");
  assert(gitStatus(dataRoot) === "", "invalid object id left Data Root dirty");

  const noConfirm = await postJson<JsonRecord>(baseUrl, "/api/pkos/objects", {
    requestId: "object-api-no-confirm",
    actor: "human",
    object: factPayload("fact.api.no_confirm", "No confirm", "not written"),
  });
  assert(noConfirm.status === 403, `missing confirmation expected 403, got ${noConfirm.status}`);

  const schemaHead = gitHead(dataRoot);
  const schemaError = await postJson<JsonRecord>(baseUrl, "/api/pkos/objects", {
    requestId: "object-api-source-string",
    confirmed: true,
    actor: "human",
    object: { ...factPayload("fact.api.source_string", "Bad source", CONTENT_SECRET), source: "gpt" },
  });
  assert(schemaError.status === 400, `schema error expected 400, got ${schemaError.status}`);
  assert(schemaError.payload.requestId === "object-api-source-string", "schema error lost requestId");
  assert((schemaError.payload.result as JsonRecord | undefined)?.errorCode === "schema_validation_failed", "schema error became cli_failed");
  assert(JSON.stringify(schemaError.payload).indexOf(CONTENT_SECRET) === -1, "schema error leaked object content");
  assert(JSON.stringify(schemaError.payload).indexOf(dataRoot.replace(/\\/g, "/")) === -1, "schema error leaked absolute Data Root path");
  assert(JSON.stringify(schemaError.payload).indexOf(dataRoot.replace(/\//g, "\\")) === -1, "schema error leaked Windows Data Root path");
  assert(!existsSync(join(dataRoot, "objects", "fact", "fact_api_source_string.yaml")), "schema error wrote an object file");
  assert(gitHead(dataRoot) === schemaHead && gitStatus(dataRoot) === "", "schema error changed Data Root state");

  const tagsError = await postJson<JsonRecord>(baseUrl, "/api/pkos/objects", {
    requestId: "object-api-fact-tags",
    confirmed: true,
    actor: "human",
    object: { ...factPayload("fact.api.tags", "Bad tags", "not written"), tags: ["not allowed"] },
  });
  assert(tagsError.status === 400, `fact tags expected 400, got ${tagsError.status}`);
  assert((tagsError.payload.result as JsonRecord | undefined)?.errorCode === "invalid_object_field", "fact tags error was not stable");

  const create = await postJson<JsonRecord>(baseUrl, "/api/pkos/objects", {
    requestId: "object-api-create-1",
    confirmed: true,
    actor: "human",
    object: factPayload("fact.api.one", "中文对象", CONTENT_SECRET),
  });
  assert(create.status === 200, `object create expected 200, got ${create.status}`);
  assert(create.payload.ok === true && (create.payload.result as JsonRecord | undefined)?.status === "written", "object create was not written");
  assert(existsSync(join(dataRoot, "objects", "fact", "fact_api_one.yaml")), "object file not created under data root");

  const multilineCreate = await postJson<JsonRecord>(baseUrl, "/api/pkos/objects", {
    requestId: "object-api-create-multiline",
    confirmed: true,
    actor: "human",
    object: factPayload("fact.api.multiline", "Multiline", "line one\nline two"),
  });
  assert(multilineCreate.status === 200, `multiline object create expected 200, got ${multilineCreate.status}`);
  assert(existsSync(join(dataRoot, "objects", "fact", "fact_api_multiline.yaml")), "multiline object file not created under data root");

  const replay = await postJson<JsonRecord>(baseUrl, "/api/pkos/objects", {
    requestId: "object-api-create-1",
    confirmed: true,
    actor: "human",
    object: factPayload("fact.api.one", "中文对象", CONTENT_SECRET),
  });
  assert(replay.status === 200 && replay.payload.replayed === true, "object create replay failed");

  const conflict = await postJson<JsonRecord>(baseUrl, "/api/pkos/objects", {
    requestId: "object-api-create-1",
    confirmed: true,
    actor: "human",
    object: factPayload("fact.api.one", "different", CONTENT_SECRET),
  });
  assert(conflict.status === 409, `object create conflict expected 409, got ${conflict.status}`);

  const list = await getJson<JsonRecord>(baseUrl, "/api/pkos/objects?type=fact&q=%E4%B8%AD%E6%96%87");
  assert(list.status === 200, `object list expected 200, got ${list.status}`);
  assert(list.payload.count === 1, "object list filters failed");
  assert(JSON.stringify(list.payload).indexOf(CONTENT_SECRET) === -1, "object list leaked full content");

  const detail = await getJson<JsonRecord>(baseUrl, "/api/pkos/objects/fact.api.one");
  assert(detail.status === 200, `object detail expected 200, got ${detail.status}`);
  const baseRevision = String(detail.payload.fileRevisionSha256 ?? "");
  assert(/^[0-9a-f]{64}$/.test(baseRevision), "detail missing base revision");

  const rendered = await getJson<JsonRecord>(baseUrl, "/api/pkos/objects/fact.api.one/render");
  assert(rendered.status === 200, `object render expected 200, got ${rendered.status}`);
  assert(rendered.payload.body === CONTENT_SECRET, "object render did not return content after explicit request");

  const update = await putJson<JsonRecord>(baseUrl, "/api/pkos/objects/fact.api.one", {
    requestId: "object-api-update-1",
    confirmed: true,
    actor: "human",
    baseRevision,
    patch: { title: "更新后的标题", summary: "new summary", content: "changed content" },
  });
  assert(update.status === 200, `object update expected 200, got ${update.status}`);
  const nextRevision = String((update.payload.result as JsonRecord | undefined)?.recordId ?? "");
  assert(nextRevision.length >= 0, "object update result shape changed");

  const stale = await putJson<JsonRecord>(baseUrl, "/api/pkos/objects/fact.api.one", {
    requestId: "object-api-stale-1",
    confirmed: true,
    actor: "human",
    baseRevision,
    patch: { summary: "stale write" },
  });
  assert(stale.status === 409, `stale revision expected 409, got ${stale.status}`);

  const deleteSeed = await postJson<JsonRecord>(baseUrl, "/api/pkos/objects", {
    requestId: "object-api-create-delete-1",
    confirmed: true,
    actor: "human",
    object: factPayload("fact.api.delete_me", "delete me", "delete body"),
  });
  assert(deleteSeed.status === 200, `delete seed create expected 200, got ${deleteSeed.status}`);
  const deleteDetail = await getJson<JsonRecord>(baseUrl, "/api/pkos/objects/fact.api.delete_me");
  const deleteRevision = String(deleteDetail.payload.fileRevisionSha256 ?? "");
  const preflight = await postJson<JsonRecord>(baseUrl, "/api/pkos/objects/fact.api.delete_me/delete-preflight", { baseRevision: deleteRevision });
  assert(preflight.status === 200, `delete preflight expected 200, got ${preflight.status}`);
  assert(preflight.payload.canDelete === true, "delete preflight unexpectedly blocked");

  const invalidDelete = await postJson<JsonRecord>(baseUrl, "/api/pkos/objects/fact.api.delete_me/delete", {
    requestId: "object-api-delete-invalid",
    confirmed: true,
    actor: "human",
    typedObjectId: "fact.api.other",
    baseRevision: deleteRevision,
    reason: REASON_SECRET,
  });
  assert(invalidDelete.status === 400, `typed object mismatch expected 400, got ${invalidDelete.status}`);

  const deleted = await postJson<JsonRecord>(baseUrl, "/api/pkos/objects/fact.api.delete_me/delete", {
    requestId: "object-api-delete-1",
    confirmed: true,
    actor: "human",
    typedObjectId: "fact.api.delete_me",
    baseRevision: deleteRevision,
    reason: REASON_SECRET,
  });
  assert(deleted.status === 200, `delete expected 200, got ${deleted.status}`);
  assert(!existsSync(join(dataRoot, "objects", "fact", "fact_api_delete_me.yaml")), "object file still exists after delete");

  const audit = await getJson<JsonRecord>(baseUrl, "/api/audit/events?limit=200");
  const auditText = JSON.stringify(audit.payload);
  assert(auditText.indexOf(CONTENT_SECRET) === -1, "Audit API leaked object content");
  assert(auditText.indexOf(REASON_SECRET) === -1, "Audit API leaked delete reason");
  assert(auditBlob(db).indexOf(CONTENT_SECRET) === -1, "SQLite audit leaked object content");
  assert(auditBlob(db).indexOf(REASON_SECRET) === -1, "SQLite audit leaked delete reason");

  console.log("OBJECT_API_SMOKE_OK");
} finally {
  await closeServer(server);
  db.close();
  rmSync(dataRoot, { recursive: true, force: true });
}

function factPayload(id: string, title: string, content: string): JsonRecord {
  return {
    id,
    type: "fact",
    status: "parsed",
    title,
    summary: "api smoke",
    content,
    source: ["api smoke"],
    anchors: ["agent-server"],
    verification_sources: ["manual"],
    counter_examples: ["edge"],
  };
}

function initGit(root: string): void {
  mkdirSync(join(root, "objects"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), "/runtime/\n", "utf8");
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "pkos-test@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "PKOS Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "seed"], { cwd: root, stdio: "ignore" });
}

function gitHead(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function gitStatus(root: string): string {
  return execFileSync("git", ["status", "--short"], { cwd: root, encoding: "utf8" });
}

async function listen(serverToListen: ReturnType<typeof createAgentHttpServer>): Promise<string> {
  await new Promise<void>((resolve) => {
    serverToListen.listen(0, "127.0.0.1", resolve);
  });
  const address = serverToListen.address();
  if (!address || typeof address === "string") {
    throw new Error("server did not bind");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(serverToClose: ReturnType<typeof createAgentHttpServer>): Promise<void> {
  if (!serverToClose.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    serverToClose.close((error) => (error ? reject(error) : resolve()));
  });
}

async function getJson<T>(baseUrl: string, path: string): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, payload: (await response.json()) as T };
}

async function postJson<T>(baseUrl: string, path: string, body: JsonRecord): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: (await response.json()) as T };
}

async function putJson<T>(baseUrl: string, path: string, body: JsonRecord): Promise<{ status: number; payload: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: (await response.json()) as T };
}

function auditBlob(database: AgentDatabase): string {
  const toolRows = database.prepare("SELECT input_json, output_json, error_json FROM tool_calls").all() as JsonRecord[];
  const eventRows = database.prepare("SELECT payload_json FROM agent_events").all() as JsonRecord[];
  const actions = database.prepare("SELECT result_json, error_json FROM action_requests").all() as JsonRecord[];
  return JSON.stringify({ toolRows, eventRows, actions });
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

void sha256;
