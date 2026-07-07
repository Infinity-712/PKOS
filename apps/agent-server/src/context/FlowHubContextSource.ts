import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveAgentPaths, type AgentPaths } from "../config/paths.js";
import type { ContextSourceResult } from "./ContextTypes.js";
import { withEstimatedChars } from "./ContextTypes.js";

type FlowHubContextSourceOptions = {
  paths?: AgentPaths;
  now?: Date;
};

type FlowHubAgentContext = {
  profile?: unknown;
  schema_version?: unknown;
  generated_at?: unknown;
  current_state?: unknown;
  weekly_review_gate?: unknown;
  task_flow_stub?: unknown;
  write_policy?: unknown;
  token_budget?: unknown;
};

const REVIEW_GATE_KEYS = new Set([
  "cadence",
  "unprocessed_inbox_count",
  "archived_this_week",
  "converted_this_week",
  "review_required_before_weekly_summary",
  "due_at",
  "status",
]);

export class FlowHubContextSource {
  private readonly paths: AgentPaths;
  private readonly now: Date;

  constructor(options: FlowHubContextSourceOptions = {}) {
    this.paths = options.paths ?? resolveAgentPaths();
    this.now = options.now ?? new Date();
  }

  load(): ContextSourceResult {
    const path = join(this.paths.dataRoot, "runtime", "agent_context.json");
    if (!existsSync(path)) {
      return { items: [], warnings: ["flow_hub_context_missing"] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      return { items: [], warnings: ["flow_hub_context_invalid"] };
    }

    if (!isRecord(parsed)) {
      return { items: [], warnings: ["flow_hub_context_invalid"] };
    }

    const context = parsed as FlowHubAgentContext;
    const warnings: string[] = [];
    const items = [];
    const generatedAt = typeof context.generated_at === "string" ? context.generated_at : undefined;
    const generatedStale = generatedAt ? isOlderThanHours(generatedAt, this.now, 24) : false;
    if (context.generated_at !== undefined && !generatedAt) {
      warnings.push("flow_hub_generated_at_invalid");
    }

    if (context.current_state !== undefined) {
      if (isRecord(context.current_state)) {
        const currentState = sanitizeCurrentState(context.current_state);
        const capturedAt = typeof currentState.updated_at === "string" ? currentState.updated_at : undefined;
        items.push(
          withEstimatedChars({
            id: "flow_hub.current_state",
            kind: "current_state",
            authority: "derived",
            source: { type: "flow_hub", path },
            capturedAt,
            generatedAt,
            stale: generatedStale || Boolean(capturedAt && isOlderThanHours(capturedAt, this.now, 24)),
            priority: 90,
            content: currentState,
          }),
        );
      } else {
        warnings.push("flow_hub_current_state_invalid");
      }
    }

    if (context.weekly_review_gate !== undefined) {
      if (isRecord(context.weekly_review_gate)) {
        items.push(
          withEstimatedChars({
            id: "flow_hub.review_gate",
            kind: "review_gate",
            authority: "derived",
            source: { type: "flow_hub", path },
            generatedAt,
            stale: generatedStale,
            priority: 80,
            content: sanitizeReviewGate(context.weekly_review_gate),
          }),
        );
      } else {
        warnings.push("flow_hub_weekly_review_gate_invalid");
      }
    }

    if (context.write_policy !== undefined) {
      if (isRecord(context.write_policy)) {
        items.push(
          withEstimatedChars({
            id: "flow_hub.write_policy",
            kind: "write_policy",
            authority: "policy",
            source: { type: "flow_hub", path },
            generatedAt,
            stale: generatedStale,
            priority: 80,
            content: sanitizeWritePolicy(context.write_policy),
          }),
        );
      } else {
        warnings.push("flow_hub_write_policy_invalid");
      }
    }

    return { items, warnings };
  }
}

function sanitizeCurrentState(value: Record<string, unknown>): Record<string, unknown> {
  const allowed = ["energy", "mood", "body", "context", "mode", "updated_at", "tone_hint"];
  return pickAllowed(value, allowed);
}

function sanitizeReviewGate(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!REVIEW_GATE_KEYS.has(key)) {
      continue;
    }
    if (["string", "number", "boolean"].includes(typeof raw) || raw === null) {
      result[key] = raw;
    }
  }
  if (Array.isArray(value.sample_items)) {
    result.sample_items_count = value.sample_items.length;
  }
  return result;
}

function sanitizeWritePolicy(value: Record<string, unknown>): Record<string, unknown> {
  const allowedWrites = Array.isArray(value.allowed_writes) ? value.allowed_writes.filter((item) => typeof item === "string") : [];
  const forbiddenWrites = Array.isArray(value.forbidden_writes) ? value.forbidden_writes.filter((item) => typeof item === "string") : [];
  const authority = typeof value.authority === "string" ? value.authority : undefined;
  return {
    allowed_writes: allowedWrites,
    forbidden_writes: forbiddenWrites,
    authority,
  };
}

function pickAllowed(value: Record<string, unknown>, allowed: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    const raw = value[key];
    if (["string", "number", "boolean"].includes(typeof raw) || raw === null) {
      result[key] = raw;
    }
  }
  return result;
}

function isOlderThanHours(value: string, now: Date, hours: number): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return true;
  }
  return now.getTime() - date.getTime() > hours * 60 * 60 * 1000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
