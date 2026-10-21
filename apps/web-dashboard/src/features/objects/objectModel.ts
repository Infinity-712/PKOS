import { AgentApiClientError, type ActionSubmitResponse, type JsonObject, type ObjectIdContract, type ObjectKind, type ObjectListFilters } from "@pkos/agent-client";

export type ObjectCreateForm = {
  id: string;
  type: ObjectKind;
  status: string;
  title: string;
  summary: string;
  content: string;
  source: string[];
  anchors: string[];
  tags: string[];
};

export type ObjectActionDraft = {
  actionName: "pkos.object.create" | "pkos.object.update" | "pkos.object.delete";
  endpoint: string;
  method: "POST" | "PUT";
  body: JsonObject;
};

export type ObjectIdValidationCode =
  | "missing_contract"
  | "too_short"
  | "too_long"
  | "unsafe_path"
  | "pattern"
  | "type_prefix"
  | "malformed_contract";

export type ObjectIdValidationResult = {
  ok: boolean;
  code: ObjectIdValidationCode | null;
  message: string | null;
  currentLength: number;
  minLength: number | null;
  maxLength: number | null;
};

export type ObjectActionUiError = {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
};

const IMMUTABLE = new Set(["id", "type", "created_at", "createdAt", "srs", "fileRevisionSha256", "objectContentSha256"]);

const ERROR_COPY: Record<string, string> = {
  invalid_object_id: "Object ID is invalid / 对象 ID 不符合规则",
  invalid_object_field: "Object field is not allowed / 对象字段不允许提交",
  object_revision_conflict: "Object changed outside this editor / 对象已在编辑器外变更",
  data_root_dirty: "Data Root has uncommitted changes / Data Root 存在未提交改动",
  object_id_exists: "Object ID already exists / 对象 ID 已存在",
  object_id_tombstoned: "Object ID was previously deleted / 对象 ID 已被删除墓碑占用",
  schema_validation_failed: "Schema validation failed / Schema 校验失败",
  git_commit_failed: "Git commit failed / Git 提交失败",
  deletion_blocked: "Delete is blocked / 删除被阻止",
  delete_blocked: "Delete is blocked / 删除被阻止",
};

export function buildObjectListQuery(filters: Omit<ObjectListFilters, "limit"> & { limit?: string | number }): string {
  const params = new URLSearchParams();
  if (filters.type) {
    params.set("type", filters.type);
  }
  if (filters.status?.trim()) {
    params.set("status", filters.status.trim());
  }
  if (filters.q?.trim()) {
    params.set("q", filters.q.trim());
  }
  const limit = filters.limit === undefined ? "" : String(filters.limit);
  if (limit.trim()) {
    params.set("limit", limit.trim());
  }
  return params.toString();
}

export function createObjectCreateDraft(input: ObjectCreateForm, contract?: { editableFields: string[]; requiredFields: string[] }): ObjectActionDraft {
  const object: Record<string, JsonObject[keyof JsonObject]> = {
    id: input.id.trim(),
    type: input.type,
  };
  setStringField(object, contract, "status", input.status.trim());
  setStringField(object, contract, "title", input.title);
  setStringField(object, contract, "summary", input.summary);
  setStringField(object, contract, "content", input.content);
  setListField(object, contract, "source", input.source);
  setListField(object, contract, "anchors", input.anchors);
  setListField(object, contract, "tags", input.tags);
  return {
    actionName: "pkos.object.create",
    endpoint: "/api/pkos/objects",
    method: "POST",
    body: {
      confirmed: true,
      actor: "human",
      object: object as JsonObject,
    },
  };
}

export function fieldIsEditable(contract: { editableFields: string[]; requiredFields: string[] } | undefined, field: string): boolean {
  return Boolean(contract && (contract.editableFields.includes(field) || contract.requiredFields.includes(field)));
}

export function validateObjectIdInput(input: {
  objectId: string;
  objectType: ObjectKind;
  contract: ObjectIdContract | undefined;
}): ObjectIdValidationResult {
  const text = input.objectId.trim();
  const currentLength = text.length;
  const contract = input.contract;
  if (!contract) {
    return validationError("missing_contract", "Object ID rules are still loading / 对象 ID 规则尚未加载", currentLength, null, null);
  }
  const minLength = contract.minLength;
  const maxLength = contract.maxLength;
  if (!Number.isInteger(minLength) || !Number.isInteger(maxLength) || minLength < 1 || maxLength < minLength) {
    return validationError("malformed_contract", "Object ID rules are malformed / 对象 ID 规则格式异常", currentLength, null, null);
  }
  if (currentLength < minLength) {
    return validationError("too_short", `Object ID is too short / 对象 ID 太短: ${currentLength}/${minLength}`, currentLength, minLength, maxLength);
  }
  if (currentLength > maxLength) {
    return validationError("too_long", `Object ID is too long / 对象 ID 太长: ${currentLength}/${maxLength}`, currentLength, minLength, maxLength);
  }
  if (hasUnsafePathShape(text)) {
    return validationError("unsafe_path", "Object ID must not be a path / 对象 ID 不能包含路径或遍历字符", currentLength, minLength, maxLength);
  }
  let regex: RegExp;
  try {
    regex = new RegExp(contract.pattern);
  } catch {
    return validationError("malformed_contract", "Object ID pattern is malformed / 对象 ID 正则规则异常", currentLength, minLength, maxLength);
  }
  if (!regex.test(text)) {
    return validationError("pattern", `Object ID format is invalid / 对象 ID 格式不合法: ${contract.humanReadablePattern}`, currentLength, minLength, maxLength);
  }
  if (contract.prefixRequirement === "must_start_with_type_dot" && !text.startsWith(`${input.objectType}.`)) {
    return validationError("type_prefix", `Object ID must start with ${input.objectType}. / 对象 ID 必须以 ${input.objectType}. 开头`, currentLength, minLength, maxLength);
  }
  return { ok: true, code: null, message: null, currentLength, minLength, maxLength };
}

export function objectIdHelpText(contract: ObjectIdContract | undefined): string {
  if (!contract) {
    return "Loading Object ID rules / 正在加载对象 ID 规则";
  }
  return `Allowed / 允许: ${contract.minLength}-${contract.maxLength} chars, ${contract.humanReadablePattern}. Example / 示例: ${contract.example}`;
}

export function canCreateObject(input: {
  idValidation: ObjectIdValidationResult;
  submitting: boolean;
  status: string;
  title: string;
  content: string;
}): boolean {
  return input.idValidation.ok && !input.submitting && input.status.trim().length > 0 && input.title.trim().length > 0 && input.content.trim().length > 0;
}

export function objectActionErrorFromResponse(response: ActionSubmitResponse): ObjectActionUiError | null {
  if (response.result?.status === "error") {
    return {
      code: response.result.errorCode ?? "request_failed",
      message: response.result.message ?? "object action failed",
      requestId: response.requestId,
      details: response,
    };
  }
  if (response.ok === false && response.error) {
    return {
      code: response.error.code,
      message: response.error.message,
      requestId: response.requestId,
      details: response,
    };
  }
  if (response.ok === false) {
    return {
      code: "request_failed",
      message: "object action failed",
      requestId: response.requestId,
      details: response,
    };
  }
  return null;
}

export function objectActionErrorFromCaught(caught: unknown): ObjectActionUiError {
  if (caught instanceof AgentApiClientError) {
    return {
      code: caught.code,
      message: caught.message,
      requestId: caught.requestId,
      details: caught.details,
    };
  }
  if (caught instanceof Error) {
    return { code: "network_unknown", message: caught.message };
  }
  return { code: "network_unknown", message: "Network result was unknown" };
}

export function formatObjectActionError(error: ObjectActionUiError | null, translate: (value: string) => string = (value) => value): string {
  if (!error) {
    return "";
  }
  const lead = translate(ERROR_COPY[error.code] ?? "Object action failed / 对象操作失败");
  const backend = error.message ? `: ${translate(error.message)}` : "";
  const request = error.requestId ? ` requestId=${error.requestId}` : "";
  return `${lead} (${error.code})${backend}.${request}`;
}

export function objectActionErrorDetails(error: ObjectActionUiError): string {
  return JSON.stringify(
    {
      code: error.code,
      message: error.message,
      requestId: error.requestId ?? null,
      details: error.details ?? null,
    },
    null,
    2,
  );
}

export function createObjectUpdateDraft(objectId: string, baseRevision: string, patch: JsonObject): ObjectActionDraft {
  return {
    actionName: "pkos.object.update",
    endpoint: `/api/pkos/objects/${encodeURIComponent(objectId)}`,
    method: "PUT",
    body: {
      confirmed: true,
      actor: "human",
      baseRevision,
      patch: stripImmutablePatch(patch),
    },
  };
}

export function createObjectDeleteDraft(objectId: string, baseRevision: string, reason: string): ObjectActionDraft {
  return {
    actionName: "pkos.object.delete",
    endpoint: `/api/pkos/objects/${encodeURIComponent(objectId)}/delete`,
    method: "POST",
    body: {
      confirmed: true,
      actor: "human",
      typedObjectId: objectId,
      baseRevision,
      reason,
    },
  };
}

export function editableFieldNames(fields: string[]): string[] {
  return fields.filter((field) => !IMMUTABLE.has(field));
}

export function canSaveObjectUpdate(input: { baseRevision: string; submitting: boolean }): boolean {
  return /^[0-9a-f]{64}$/i.test(input.baseRevision) && !input.submitting;
}

export function canDeleteObject(input: { typedObjectId: string; expectedObjectId: string; reason: string; canDelete: boolean }): boolean {
  return input.canDelete && input.typedObjectId.trim() === input.expectedObjectId && input.reason.trim().length > 0;
}

export function linesToList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function listToLines(value: unknown): string {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join("\n") : "";
}

export function stripImmutablePatch(patch: JsonObject): JsonObject {
  const result: Record<string, JsonObject[keyof JsonObject]> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!IMMUTABLE.has(key)) {
      result[key] = value as JsonObject[keyof JsonObject];
    }
  }
  return result as JsonObject;
}

function validationError(
  code: ObjectIdValidationCode,
  message: string,
  currentLength: number,
  minLength: number | null,
  maxLength: number | null,
): ObjectIdValidationResult {
  return { ok: false, code, message, currentLength, minLength, maxLength };
}

function hasUnsafePathShape(text: string): boolean {
  return (
    text.startsWith("/") ||
    text.startsWith("\\") ||
    /^[A-Za-z]:/.test(text) ||
    text.includes("/") ||
    text.includes("\\") ||
    text.includes("..") ||
    text.includes(":") ||
    /\s/.test(text)
  );
}

function shouldSubmitField(contract: { editableFields: string[]; requiredFields: string[] } | undefined, field: string): boolean {
  return !contract || fieldIsEditable(contract, field);
}

function setStringField(
  object: Record<string, JsonObject[keyof JsonObject]>,
  contract: { editableFields: string[]; requiredFields: string[] } | undefined,
  field: string,
  value: string,
): void {
  if (shouldSubmitField(contract, field)) {
    object[field] = value;
  }
}

function setListField(
  object: Record<string, JsonObject[keyof JsonObject]>,
  contract: { editableFields: string[]; requiredFields: string[] } | undefined,
  field: string,
  value: string[],
): void {
  if (shouldSubmitField(contract, field)) {
    object[field] = value;
  }
}
