export type ContextAuthority = "policy" | "derived" | "runtime";

export type ContextItemKind =
  | "system_boundary"
  | "current_state"
  | "review_gate"
  | "write_policy"
  | "recent_message";

export type ContextSource = {
  type: "flow_hub" | "sqlite" | "static";
  path?: string;
  table?: string;
  recordId?: string;
};

export type ContextItem = {
  id: string;
  kind: ContextItemKind;
  content: unknown;
  source: ContextSource;
  authority: ContextAuthority;
  capturedAt?: string;
  generatedAt?: string;
  stale: boolean;
  priority: number;
  estimatedChars: number;
};

export type ContextBudget = {
  maxItems: number;
  maxChars: number;
  usedItems: number;
  usedChars: number;
  truncated: boolean;
};

export type BuiltContext = {
  schemaVersion: "0.6";
  builtAt: string;
  sessionId: string;
  items: ContextItem[];
  budget: ContextBudget;
  warnings: string[];
};

export type ContextBuildOptions = {
  maxItems?: number;
  maxChars?: number;
};

export type ContextSourceResult = {
  items: ContextItem[];
  warnings: string[];
};

export const DEFAULT_CONTEXT_BUDGET = {
  maxItems: 20,
  maxChars: 12000,
} as const;

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function estimateChars(value: unknown): number {
  return stableStringify(value).length;
}

export function withEstimatedChars<T extends Omit<ContextItem, "estimatedChars">>(item: T): ContextItem {
  return {
    ...item,
    estimatedChars: estimateChars(item.content),
  };
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      result[key] = sortValue(input[key]);
    }
    return result;
  }
  return value;
}
