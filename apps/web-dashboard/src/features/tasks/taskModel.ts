import {
  startOrReuseAttempt,
  type ActionDraft,
  type RequestAttemptState,
} from "../actions/requestAttempt.js";

export type TaskFilters = {
  status: string;
  priority: string;
  tag: string;
  limit: string;
  title?: string;
};

export type TaskCreateInput = {
  title: string;
  description: string;
  source: string;
  tags: string[];
  priority: string;
  dueAt: string | null;
};

export type TaskTransitionInput = {
  taskId: string;
  targetStatus: string;
  reason: string;
};

const TRANSITIONS: Record<string, string[]> = {
  open: ["in_progress", "blocked", "done", "cancelled"],
  in_progress: ["open", "blocked", "done", "cancelled"],
  blocked: ["open", "in_progress", "done", "cancelled"],
  done: ["open"],
  cancelled: ["open"],
};

export function buildTaskQuery(filters: TaskFilters): string {
  const params = new URLSearchParams();
  const status = filters.status.trim();
  const priority = filters.priority.trim();
  const tag = filters.tag.trim();
  const limit = filters.limit.trim();
  if (status) {
    params.set("status", status);
  }
  if (priority) {
    params.set("priority", priority);
  }
  if (tag) {
    params.set("tag", tag);
  }
  if (limit) {
    params.set("limit", limit);
  }
  return params.toString();
}

export function createTaskCreateDraft(input: TaskCreateInput): ActionDraft {
  return {
    actionName: "task-create",
    body: {
      title: input.title.trim(),
      description: input.description.trim(),
      source: input.source.trim() || "web",
      tags: input.tags.map((tag) => tag.trim()).filter(Boolean),
      priority: input.priority || "normal",
      dueAt: typeof input.dueAt === "string" && input.dueAt.trim() ? input.dueAt.trim() : null,
      confirmed: true,
    },
  };
}

export function createTaskTransitionDraft(input: TaskTransitionInput): ActionDraft {
  return {
    actionName: "task-transition",
    body: {
      taskId: input.taskId,
      targetStatus: input.targetStatus,
      reason: input.reason.trim(),
      confirmed: true,
    },
  };
}

export function startOrReuseTaskAttempt(
  current: RequestAttemptState,
  draft: ActionDraft,
  createRequestId: () => string,
): RequestAttemptState {
  const next = startOrReuseAttempt(current, draft, createRequestId);
  if (!next.frozenPayload || next.frozenPayload.actionName !== "task-transition") {
    return next;
  }
  const { taskId, ...body } = next.frozenPayload.body;
  void taskId;
  return {
    ...next,
    frozenPayload: {
      ...next.frozenPayload,
      body,
    },
  };
}

export function canSubmitTaskCreate(input: TaskCreateInput): boolean {
  return Boolean(input.title.trim());
}

export function canSubmitTaskTransition(input: TaskTransitionInput): boolean {
  return Boolean(input.taskId.trim() && input.targetStatus.trim() && input.reason.trim());
}

export function allowedTaskTransitions(status: string): string[] {
  return TRANSITIONS[status] ? [...TRANSITIONS[status]] : [];
}
