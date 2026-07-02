function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function textValue(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return String(value);
}

function listValue(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item)).filter((item) => item.length > 0);
}

function getCurrentState(context) {
  if (isObject(context) && isObject(context.current_state)) {
    return context.current_state;
  }
  return {};
}

function getWeeklyReviewGate(context) {
  if (isObject(context) && isObject(context.weekly_review_gate)) {
    return context.weekly_review_gate;
  }
  return {};
}

function getTaskFlowStub(context) {
  if (isObject(context) && isObject(context.task_flow_stub)) {
    return context.task_flow_stub;
  }
  return {};
}

function getWritePolicy(context) {
  if (isObject(context) && isObject(context.write_policy)) {
    return context.write_policy;
  }
  return {};
}

function isReviewRelatedText(userText) {
  const text = String(userText || "").toLowerCase();
  const keywords = [
    "weekly review",
    "weekly summary",
    "review",
    "summary",
    "zhou zongjie",
    "周总结",
    "总结",
    "回顾",
  ];
  for (let i = 0; i < keywords.length; i += 1) {
    if (text.indexOf(keywords[i]) !== -1) {
      return true;
    }
  }
  return false;
}

export function deriveMoonloloToneInstruction(context = {}) {
  const state = getCurrentState(context);
  const toneHint = textValue(state.tone_hint, "normal");

  if (toneHint === "soft_low_pressure") {
    return "Use a cute, gentle, low-pressure tone. Keep the reply short, avoid diagnosis, and suggest at most one tiny next action.";
  }

  if (toneHint === "short_recovery") {
    return "Use an even shorter recovery-oriented tone. Do not push tasks; offer rest-friendly wording without diagnosis.";
  }

  return "Use the normal cute companion tone: warm, clear, and light. Keep suggestions optional and non-authoritative.";
}

export function shouldMentionWeeklyReviewGate(context = {}, userText = "") {
  const gate = getWeeklyReviewGate(context);
  return gate.review_required_before_weekly_summary === true && isReviewRelatedText(userText);
}

export function buildMoonloloContextBlock(context = {}) {
  const state = getCurrentState(context);
  const gate = getWeeklyReviewGate(context);
  const taskFlow = getTaskFlowStub(context);
  const writePolicy = getWritePolicy(context);
  const allowedWrites = listValue(writePolicy.allowed_writes);
  const forbiddenWrites = listValue(writePolicy.forbidden_writes);
  const sampleItems = Array.isArray(gate.sample_items) ? gate.sample_items : [];
  const taskFlowDisabled = taskFlow.enabled === false;

  const lines = [
    "PKOS runtime context: profile=" + textValue(context.profile, "unknown") +
      ", schema_version=" + textValue(context.schema_version, "unknown") +
      ". This is runtime context only, not source of truth.",
    "Tone hint: " + textValue(state.tone_hint, "normal") +
      ". current_state may adjust tone and reply load only; it must not change decisions, reminder frequency, or become diagnosis.",
    deriveMoonloloToneInstruction(context),
  ];

  if (taskFlowDisabled) {
    lines.push(
      "Task flow is disabled: do not claim to know active tasks, do not invent tasks, and do not create next actions."
    );
  } else {
    lines.push("Task flow is not authoritative unless a future task system explicitly enables it.");
  }

  lines.push(
    "Weekly review gate: unprocessed_inbox_count=" +
      textValue(gate.unprocessed_inbox_count, "0") +
      ", review_required_before_weekly_summary=" +
      textValue(gate.review_required_before_weekly_summary, "false") +
      ", bounded_sample_items=" +
      String(sampleItems.length) +
      ". Mention this only for weekly summary/review requests; never summarize raw inbox as facts."
  );

  lines.push(
    "Write policy: allowed=[" +
      allowedWrites.join(", ") +
      "]; forbidden=[" +
      forbiddenWrites.join(", ") +
      "]. The context grants no extra write permission."
  );

  return lines.join("\n");
}
