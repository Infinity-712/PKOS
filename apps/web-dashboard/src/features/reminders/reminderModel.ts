import {
  startOrReuseAttempt,
  type ActionDraft,
  type RequestAttemptState,
} from "../actions/requestAttempt.js";

export type ReminderFilters = {
  status: string;
  taskId: string;
  source: string;
  limit: string;
  title?: string;
};

export type ReminderCreateInput = {
  title: string;
  description: string;
  source: string;
  taskId: string;
  remindAt: string | null;
};

export type ReminderActionInput = {
  reminderId: string;
  reason: string;
};

export type ReminderRescheduleInput = ReminderActionInput & {
  remindAt: string | null;
};

export function buildReminderQuery(filters: ReminderFilters): string {
  const params = new URLSearchParams();
  const status = filters.status.trim();
  const taskId = filters.taskId.trim();
  const source = filters.source.trim();
  const limit = filters.limit.trim();
  if (status) {
    params.set("status", status);
  }
  if (taskId) {
    params.set("taskId", taskId);
  }
  if (source) {
    params.set("source", source);
  }
  if (limit) {
    params.set("limit", limit);
  }
  return params.toString();
}

export function createReminderCreateDraft(input: ReminderCreateInput): ActionDraft {
  return {
    actionName: "reminder-create",
    body: {
      title: input.title.trim(),
      description: input.description.trim(),
      source: input.source.trim() || "web",
      taskId: input.taskId.trim() || null,
      remindAt: typeof input.remindAt === "string" && input.remindAt.trim() ? input.remindAt.trim() : null,
      confirmed: true,
    },
  };
}

export function createReminderActionDraft(action: "acknowledge" | "cancel", input: ReminderActionInput): ActionDraft {
  return {
    actionName: action === "acknowledge" ? "reminder-acknowledge" : "reminder-cancel",
    body: {
      reminderId: input.reminderId,
      reason: input.reason.trim(),
      confirmed: true,
    },
  };
}

export function createReminderRescheduleDraft(input: ReminderRescheduleInput): ActionDraft {
  return {
    actionName: "reminder-reschedule",
    body: {
      reminderId: input.reminderId,
      remindAt: typeof input.remindAt === "string" && input.remindAt.trim() ? input.remindAt.trim() : null,
      reason: input.reason.trim(),
      confirmed: true,
    },
  };
}

export function startOrReuseReminderAttempt(
  current: RequestAttemptState,
  draft: ActionDraft,
  createRequestId: () => string,
): RequestAttemptState {
  const next = startOrReuseAttempt(current, draft, createRequestId);
  if (!next.frozenPayload || !next.frozenPayload.actionName.startsWith("reminder-") || next.frozenPayload.actionName === "reminder-create") {
    return next;
  }
  const { reminderId, ...body } = next.frozenPayload.body;
  void reminderId;
  return {
    ...next,
    frozenPayload: {
      ...next.frozenPayload,
      body,
    },
  };
}

export function canSubmitReminderCreate(input: ReminderCreateInput): boolean {
  return Boolean(input.title.trim() && input.remindAt);
}

export function canSubmitReminderAction(input: ReminderActionInput): boolean {
  return Boolean(input.reminderId.trim() && input.reason.trim());
}

export function canSubmitReminderReschedule(input: ReminderRescheduleInput): boolean {
  return Boolean(input.reminderId.trim() && input.reason.trim() && input.remindAt);
}
