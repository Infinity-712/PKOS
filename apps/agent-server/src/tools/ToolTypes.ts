import { createHash } from "node:crypto";

import type { WritebackResult } from "../writeback/WritebackTypes.js";

export type ToolPermissionLevel = "L0" | "L1" | "L2" | "L3" | "L4";

export type ToolExecutionContext = {
  sessionId?: string;
  generationId?: string;
  sourceMessageId?: string;
  requestedBy: "test" | "user_explicit" | "agent";
  confirmed: boolean;
};

export type ToolDefinition<TInput, TOutput> = {
  name: string;
  description: string;
  permissionLevel: ToolPermissionLevel;
  sideEffect: boolean;
  requiresConfirmation: boolean;
  validateInput(input: unknown): TInput;
  execute(input: TInput, context: ToolExecutionContext): Promise<TOutput>;
  summarizeInput?(input: TInput): Record<string, unknown>;
};

export type RegisteredToolDefinition = {
  name: string;
  description: string;
  permissionLevel: ToolPermissionLevel;
  sideEffect: boolean;
  requiresConfirmation: boolean;
  validateInput(input: unknown): unknown;
  execute(input: unknown, context: ToolExecutionContext): Promise<unknown>;
  summarizeInput?(input: unknown): Record<string, unknown>;
};

export type ToolDescriptor = {
  name: string;
  description: string;
  permissionLevel: ToolPermissionLevel;
  sideEffect: boolean;
  requiresConfirmation: boolean;
};

export class ToolInputError extends Error {
  readonly code = "invalid_input";

  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export type ToolOutput = WritebackResult;

export function textDigest(value: string | undefined | null, fieldName: string): Record<string, unknown> {
  if (typeof value !== "string") {
    return {
      [`${fieldName}Length`]: 0,
      [`${fieldName}Sha256`]: null,
    };
  }
  return {
    [`${fieldName}Length`]: value.length,
    [`${fieldName}Sha256`]: createHash("sha256").update(value, "utf8").digest("hex"),
  };
}

export function requireRecord(input: unknown, toolName: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ToolInputError(`${toolName} input must be an object`);
  }
  return input as Record<string, unknown>;
}

export function requireStringEnum(value: unknown, field: string, allowed: ReadonlySet<string>): string {
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new ToolInputError(`${field} must be one of: ${Array.from(allowed).sort().join(", ")}`);
  }
  return value;
}

export function optionalStringEnum(value: unknown, field: string, allowed: ReadonlySet<string>, fallback: string): string {
  if (value === undefined || value === null) {
    return fallback;
  }
  return requireStringEnum(value, field, allowed);
}

export function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ToolInputError(`${field} must be a string`);
  }
  return value;
}

export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ToolInputError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

export function optionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ToolInputError(`${field} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}

export function optionalPlainObject(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ToolInputError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}
