import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ObjectIdContract, ObjectTypeContract } from "@pkos/agent-client";

import {
  canCreateObject,
  buildObjectListQuery,
  canDeleteObject,
  canSaveObjectUpdate,
  createObjectCreateDraft,
  createObjectDeleteDraft,
  createObjectUpdateDraft,
  editableFieldNames,
  fieldIsEditable,
  formatObjectActionError,
  objectActionErrorFromCaught,
  objectActionErrorFromResponse,
  objectIdHelpText,
  validateObjectIdInput,
} from "../features/objects/objectModel.js";
import { ApiClientError } from "../lib/apiClient.js";
import { isObjectDetailResponse, isObjectListResponse, isObjectRenderView, isObjectTypeContractResponse } from "../lib/guards.js";

const query = buildObjectListQuery({ type: "fact", status: "parsed", q: "中文", limit: "20" });
assert(query === "type=fact&status=parsed&q=%E4%B8%AD%E6%96%87&limit=20", "object list query builder failed");

const createDraft = createObjectCreateDraft({
  id: "fact.web.one",
  type: "fact",
  status: "parsed",
  title: "Web fact",
  summary: "summary",
  content: "content",
  source: ["manual"],
  anchors: ["web"],
  tags: ["ui"],
});
assert(createDraft.endpoint === "/api/pkos/objects", "object create endpoint is not fixed");
assert(createDraft.body.confirmed === true, "object create did not use explicit button confirmation");
assert(!JSON.stringify(createDraft.body).includes("\"srs\""), "object create submitted srs");

const updateDraft = createObjectUpdateDraft("fact.web.one", "a".repeat(64), { title: "Updated" });
assert(updateDraft.endpoint === "/api/pkos/objects/fact.web.one", "object update endpoint is not fixed");
assert(updateDraft.method === "PUT", "object update must use PUT");
assert(updateDraft.body.baseRevision === "a".repeat(64), "object update did not send baseRevision");
assert(updateDraft.body.confirmed === true, "object update did not use explicit button confirmation");

const deleteDraft = createObjectDeleteDraft("fact.web.one", "a".repeat(64), "manual cleanup");
assert(deleteDraft.endpoint === "/api/pkos/objects/fact.web.one/delete", "object delete endpoint is not fixed");
assert(deleteDraft.body.typedObjectId === "fact.web.one", "object delete did not send typed ID confirmation");
assert(deleteDraft.body.reason === "manual cleanup", "object delete did not send reason");
assert(canDeleteObject({ typedObjectId: "fact.web.one", expectedObjectId: "fact.web.one", reason: "because", canDelete: true }), "valid delete was not enabled");
assert(!canDeleteObject({ typedObjectId: "fact.web.one", expectedObjectId: "fact.web.other", reason: "because", canDelete: true }), "mismatched typed id delete was enabled");
assert(!canDeleteObject({ typedObjectId: "fact.web.one", expectedObjectId: "fact.web.one", reason: "", canDelete: true }), "blank reason delete was enabled");
assert(!canDeleteObject({ typedObjectId: "fact.web.one", expectedObjectId: "fact.web.one", reason: "because", canDelete: false }), "blocked preflight delete was enabled");
assert(canSaveObjectUpdate({ baseRevision: "a".repeat(64), submitting: false }), "valid update was not enabled");
assert(!canSaveObjectUpdate({ baseRevision: "bad", submitting: false }), "bad baseRevision update was enabled");
assert(editableFieldNames(["id", "type", "title", "srs", "content"]).join(",") === "title,content", "immutable fields were editable");

const objectIdContract: ObjectIdContract = {
  minLength: 3,
  maxLength: 64,
  pattern: "^[a-z][a-z0-9_-]*(?:\\.[a-z0-9_-]+)+$",
  humanReadablePattern: "lowercase ASCII letters and numbers, separated by dots, hyphens, or underscores",
  example: "fact.example",
  prefixRequirement: "must_start_with_type_dot",
};
const factContract: ObjectTypeContract = {
  type: "fact",
  editableFields: ["status", "title", "summary", "content", "source", "anchors"],
  requiredFields: ["id", "type", "status", "source", "anchors", "created_at", "updated_at"],
  statusEnum: ["raw", "parsed"],
  fieldTypes: { status: "string", title: "string", summary: "multiline_string", content: "multiline_string", source: "string_list", anchors: "string_list" },
  srsEligible: true,
  immutableFields: ["id", "type", "created_at", "srs"],
  supportedSupplementarySections: [],
  objectId: objectIdContract,
};
const creativeContract: ObjectTypeContract = {
  ...factContract,
  type: "creative",
  editableFields: ["title", "summary", "content", "tags"],
  requiredFields: ["id", "type", "title", "summary", "created_at", "updated_at", "tags"],
  statusEnum: ["draft", "revised", "archived"],
  fieldTypes: { title: "string", summary: "multiline_string", content: "multiline_string", tags: "string_list" },
  srsEligible: false,
};
assert(!fieldIsEditable(factContract, "tags"), "fact contract treated tags as editable");
assert(fieldIsEditable(creativeContract, "tags"), "creative contract did not treat tags as editable");
const factContractDraft = createObjectCreateDraft(
  {
    id: "fact.web.contract",
    type: "fact",
    status: "raw",
    title: "Fact contract",
    summary: "summary",
    content: "line one\nline two",
    source: ["gpt"],
    anchors: ["gpt"],
    tags: ["must-not-submit"],
  },
  factContract,
);
assert(!JSON.stringify(factContractDraft.body).includes("\"tags\""), "fact create submitted non-contract tags field");
assert(Array.isArray((factContractDraft.body.object as Record<string, unknown>).source), "source list was not submitted as an array");
assert(Array.isArray((factContractDraft.body.object as Record<string, unknown>).anchors), "anchors list was not submitted as an array");
const creativeContractDraft = createObjectCreateDraft(
  {
    id: "creative.web.contract",
    type: "creative",
    status: "draft",
    title: "Creative contract",
    summary: "summary",
    content: "creative",
    source: [],
    anchors: [],
    tags: ["kept"],
  },
  creativeContract,
);
assert(JSON.stringify(creativeContractDraft.body).includes("\"tags\":[\"kept\"]"), "creative create dropped contract tags field");
const validId = validateObjectIdInput({ objectId: "fact.gui-accept", objectType: "fact", contract: objectIdContract });
assert(validId.ok === true && validId.currentLength === 15 && validId.maxLength === 64, "valid object id failed contract validation");
const tooLongId = validateObjectIdInput({ objectId: `fact.${"x".repeat(60)}`, objectType: "fact", contract: objectIdContract });
assert(tooLongId.ok === false && tooLongId.code === "too_long" && tooLongId.currentLength === 65, "overlong object id was not rejected before POST");
assert(!canCreateObject({ idValidation: tooLongId, submitting: false, status: "parsed", title: "Title", content: "Content" }), "overlong object id allowed create POST");
const badPrefix = validateObjectIdInput({ objectId: "claim.gui-accept", objectType: "fact", contract: objectIdContract });
assert(badPrefix.ok === false && badPrefix.code === "type_prefix", "wrong type prefix was not rejected");
const traversalId = validateObjectIdInput({ objectId: "fact../bad", objectType: "fact", contract: objectIdContract });
assert(traversalId.ok === false && traversalId.code === "unsafe_path", "path traversal object id was not rejected");
const helpText = objectIdHelpText(objectIdContract);
assert(helpText.includes("3-64") && helpText.includes("Allowed") && helpText.includes("示例"), "object id help text is not bilingual");

const backendError = objectActionErrorFromResponse({
  ok: false,
  requestId: "object-create-backend-error",
  replayed: false,
  result: {
    status: "error",
    operation: "pkos.object.create",
    errorCode: "invalid_object_id",
    message: "object id length is invalid",
  },
});
assert(backendError?.code === "invalid_object_id" && backendError.requestId === "object-create-backend-error", "action envelope error was not extracted");
const backendErrorText = formatObjectActionError(backendError);
assert(backendErrorText.includes("Object ID") && backendErrorText.includes("对象 ID") && backendErrorText.includes("invalid_object_id"), "mapped backend error was not bilingual or code-visible");
const translatedErrorText = formatObjectActionError(backendError, (value) => value === "Object ID is invalid / 对象 ID 不符合规则" ? "对象 ID 不符合规则" : value);
assert(translatedErrorText.startsWith("对象 ID 不符合规则 (invalid_object_id)"), "object error lead was not localized");
assert(translatedErrorText.includes("object-create-backend-error") && translatedErrorText.includes("object id length is invalid"), "localizing the lead changed the request ID or unknown backend text");
const httpError = objectActionErrorFromCaught(
  new ApiClientError(400, "data_root_dirty", "Data Root Git worktree must be clean", "object-create-http-error", { raw: "details" }),
);
const httpErrorText = formatObjectActionError(httpError);
assert(httpErrorText.includes("Data Root") && httpErrorText.includes("未提交") && httpErrorText.includes("object-create-http-error"), "HTTP 400 error was not visible with requestId");
const unknownResponseError = objectActionErrorFromResponse({
  ok: false,
  requestId: "object-create-unknown-error",
  replayed: false,
  result: { status: "error", operation: "pkos.object.create", errorCode: "new_error", message: "backend says no" },
});
assert(formatObjectActionError(unknownResponseError).includes("backend says no"), "unknown backend error message was dropped");

assert(
  isObjectTypeContractResponse({
    ok: true,
    schemaVersion: "0.8-beta",
    types: [
      {
        type: "fact",
        editableFields: ["title"],
        requiredFields: ["id"],
        statusEnum: ["raw"],
        fieldTypes: { source: "string_list", anchors: "string_list" },
        srsEligible: true,
        immutableFields: ["id", "type", "srs"],
        supportedSupplementarySections: [],
        objectId: objectIdContract,
      },
    ],
  }),
  "object type contract guard rejected valid payload",
);

assert(
  isObjectListResponse({
    ok: true,
    schemaVersion: "0.8-beta",
    generatedAt: "2026-07-20T00:00:00Z",
    count: 1,
    totalCount: 1,
    filters: {},
    items: [
      {
        id: "fact.web.one",
        type: "fact",
        status: "parsed",
        title: "Title",
        summary: "Summary",
        updatedAt: "2026-07-20T00:00:00Z",
        fileRevisionSha256: "a".repeat(64),
        objectContentSha256: "b".repeat(64),
        srsEligible: true,
        contentChangedSinceLastReview: false,
        location: "fact/fact_web_one.yaml",
      },
    ],
    source: {},
    dataRootFingerprint: "abc",
  }),
  "object list guard rejected valid payload",
);

assert(
  isObjectDetailResponse({
    ok: true,
    schemaVersion: "0.8-beta",
    object: { id: "fact.web.one", type: "fact", title: "Title" },
    location: "fact/fact_web_one.yaml",
    fileRevisionSha256: "a".repeat(64),
    objectContentSha256: "b".repeat(64),
    srsEligible: true,
    contentChangedSinceLastReview: false,
    reviewSummary: null,
    editableFields: ["title"],
    immutableFields: ["id", "type", "srs"],
    additionalFields: ["custom"],
    dataRootFingerprint: "abc",
  }),
  "object detail guard rejected valid payload",
);

assert(
  isObjectRenderView({
    ok: true,
    schemaVersion: "0.8-beta",
    objectId: "fact.web.one",
    objectType: "fact",
    fileRevisionSha256: "a".repeat(64),
    dataRootFingerprint: "abc",
    body: "answer",
    sections: [{ id: "source", title: "Source", kind: "list", items: ["manual"] }],
    metadata: {},
    objectContentSha256: "b".repeat(64),
  }),
  "object render guard rejected valid payload",
);

const appSource = source("App.tsx");
const objectPageSource = source("pages/ObjectsPage.tsx");
const reviewPageSource = source("pages/ReviewPage.tsx");
const combined = `${appSource}\n${objectPageSource}\n${reviewPageSource}`;
assert(appSource.includes("ObjectsPage") && appSource.includes("Objects"), "Objects navigation missing");
assert(objectPageSource.includes("object-delete-preflight") || objectPageSource.includes("delete-preflight"), "delete preflight UI missing");
assert(objectPageSource.includes("Object ID / 对象 ID"), "object id bilingual label missing");
assert(objectPageSource.includes("fieldIsEditable(activeContract, \"tags\")"), "Object page does not hide tags by contract");
assert(objectPageSource.includes("fieldIsEditable(activeContract, \"source\")"), "Object page does not drive source by contract");
assert(objectPageSource.includes("fieldIsEditable(activeContract, \"anchors\")"), "Object page does not drive anchors by contract");
assert(objectPageSource.includes("id-length-counter"), "object id length counter missing");
assert(objectPageSource.includes("id-inline-error"), "object id inline error missing");
assert(objectPageSource.includes("object-action-error"), "object action error panel missing");
assert(objectPageSource.includes("<details"), "object action error request details missing");
assert(objectPageSource.includes("formatObjectActionError"), "object action error formatter missing from page");
assert(objectPageSource.includes("Object changed outside this editor"), "revision conflict UI missing");
assert(objectPageSource.includes("Additional Fields"), "read-only additional fields missing");
assert(objectPageSource.includes("Permanent delete"), "hard delete action missing");
assert(objectPageSource.includes("no cascade"), "no cascade copy missing");
assert(!objectPageSource.includes("force delete"), "force delete appeared in object page");
assert(!/maxLength\s*=\s*[{\"']?\d/.test(objectPageSource), "Object page hard-codes an ID maxLength");
assert(!objectPageSource.includes("^[a-z]"), "Object page hard-codes an ID regex");
assert(reviewPageSource.includes("/api/pkos/objects/") && reviewPageSource.includes("/render"), "Review Show Answer does not use object render API");
assert(reviewPageSource.indexOf("/api/pkos/review/items/") !== -1, "Review history/detail route unexpectedly disappeared");
assert(combined.indexOf("8787") === -1, "Web Dashboard references legacy 8787");
const browserStorageName = "local" + "Storage";
assert(combined.indexOf(browserStorageName) === -1, "Web Dashboard uses browser storage for object/review authority");
assert(combined.indexOf("srs:") === -1, "Object page exposes editable srs");

console.log("OBJECT_WEB_SMOKE_OK");

function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), "src", relativePath), "utf8");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
