import type { AgentDatabase } from "../db/connection.js";
import {
  DEFAULT_CONTEXT_BUDGET,
  estimateChars,
  type BuiltContext,
  type ContextBuildOptions,
  type ContextBudget,
  type ContextItem,
} from "./ContextTypes.js";
import { FlowHubContextSource } from "./FlowHubContextSource.js";
import { RecentMessagesContextSource } from "./RecentMessagesContextSource.js";
import { StaticPolicyContextSource } from "./StaticPolicyContextSource.js";

type ContextBuilderOptions = {
  now?: () => Date;
};

type Candidate = {
  item: ContextItem;
  order: number;
};

export class ContextBuilder {
  private readonly now: () => Date;

  constructor(
    private readonly db: AgentDatabase,
    options: ContextBuilderOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  build(sessionId: string, options: ContextBuildOptions = {}): BuiltContext {
    const budget = {
      maxItems: options.maxItems ?? DEFAULT_CONTEXT_BUDGET.maxItems,
      maxChars: options.maxChars ?? DEFAULT_CONTEXT_BUDGET.maxChars,
    };
    const builtAt = this.now().toISOString();
    const warnings: string[] = [];
    const candidates: Candidate[] = [];
    let order = 0;

    for (const result of [
      new StaticPolicyContextSource().load(),
      new FlowHubContextSource({ now: new Date(builtAt) }).load(),
      new RecentMessagesContextSource(this.db).load(sessionId),
    ]) {
      warnings.push(...result.warnings);
      for (const item of result.items) {
        candidates.push({ item, order });
        order += 1;
      }
    }

    const selected = applyBudget(candidates, budget.maxItems, budget.maxChars);

    return {
      schemaVersion: "0.6",
      builtAt,
      sessionId,
      items: selected.items,
      budget: selected.budget,
      warnings,
    };
  }
}

export function summarizeBuiltContext(context: BuiltContext): {
  itemCount: number;
  usedChars: number;
  truncated: boolean;
  warnings: string[];
  sourceCounts: { static: number; flow_hub: number; sqlite: number };
} {
  const sourceCounts = { static: 0, flow_hub: 0, sqlite: 0 };
  for (const item of context.items) {
    sourceCounts[item.source.type] += 1;
  }
  return {
    itemCount: context.items.length,
    usedChars: context.budget.usedChars,
    truncated: context.budget.truncated,
    warnings: context.warnings,
    sourceCounts,
  };
}

function applyBudget(
  candidates: Candidate[],
  maxItems: number,
  maxChars: number,
): { items: ContextItem[]; budget: ContextBudget } {
  const sorted = [...candidates].sort((a, b) => {
    if (b.item.priority !== a.item.priority) {
      return b.item.priority - a.item.priority;
    }
    return a.order - b.order;
  });

  const items: ContextItem[] = [];
  let usedChars = 0;
  let truncated = false;

  for (const candidate of sorted) {
    if (items.length >= maxItems) {
      truncated = true;
      continue;
    }
    const chars = estimateChars(candidate.item.content);
    if (usedChars + chars > maxChars) {
      truncated = true;
      continue;
    }
    items.push({ ...candidate.item, estimatedChars: chars });
    usedChars += chars;
  }

  return {
    items,
    budget: {
      maxItems,
      maxChars,
      usedItems: items.length,
      usedChars,
      truncated,
    },
  };
}
