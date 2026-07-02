import {
  buildMoonloloContextBlock,
  deriveMoonloloToneInstruction,
  shouldMentionWeeklyReviewGate,
} from "./moonlolo_context_prompt.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const RAW_INBOX_FULL_TEXT = "RAW_INBOX_FULL_TEXT_SHOULD_NOT_APPEAR_IN_PROMPT";

const context = {
  schema_version: "0.5-beta",
  profile: "moonlolo",
  generated_at: "2026-07-02T12:00:00Z",
  current_state: {
    energy: "low",
    mood: "calm",
    body: "tired",
    context: "home",
    mode: "recovery",
    updated_at: "2026-07-02T11:58:00Z",
    tone_hint: "soft_low_pressure",
  },
  reminder_state: null,
  weekly_review_gate: {
    cadence: "weekly",
    unprocessed_inbox_count: 3,
    archived_this_week: 1,
    converted_this_week: 1,
    review_required_before_weekly_summary: true,
    sample_items: [
      {
        id: "inbox_fixture_1",
        created_at: "2026-07-02T09:00:00Z",
        source: "moonlolo",
        capture_type: "note",
        content_excerpt: "bounded excerpt only",
        content: RAW_INBOX_FULL_TEXT,
      },
    ],
  },
  task_flow_stub: {
    enabled: false,
    reason: "task_system_not_implemented",
    active_task: null,
    next_action: null,
  },
  write_policy: {
    agent_may_write: true,
    allowed_writes: ["inbox_append", "state_append"],
    forbidden_writes: [
      "trusted",
      "objects",
      "tasks",
      "task_auto_creation",
      "weekly_summary_without_review",
      "raw_vault_mutation",
      "secret_reading",
    ],
    authority: "runtime context only; not source of truth",
  },
};

const toneInstruction = deriveMoonloloToneInstruction(context);
assert(toneInstruction.indexOf("low-pressure") !== -1, "soft_low_pressure should produce low-pressure tone");
assert(toneInstruction.indexOf("diagnosis") !== -1, "tone instruction should avoid diagnosis");

const block = buildMoonloloContextBlock(context);
assert(block.indexOf("profile=moonlolo") !== -1, "context block should include profile");
assert(block.indexOf("schema_version=0.5-beta") !== -1, "context block should include schema version");
assert(block.indexOf("Tone hint: soft_low_pressure") !== -1, "context block should include tone hint");
assert(block.indexOf("tone and reply load only") !== -1, "context block should limit state to tone");
assert(block.indexOf("do not invent tasks") !== -1, "disabled task flow should forbid invented tasks");
assert(block.indexOf("trusted") !== -1, "forbidden trusted boundary should be expressed");
assert(block.indexOf("objects") !== -1, "forbidden objects boundary should be expressed");
assert(block.indexOf("tasks") !== -1, "forbidden tasks boundary should be expressed");
assert(block.indexOf(RAW_INBOX_FULL_TEXT) === -1, "context block must not include raw inbox full text");

assert(
  shouldMentionWeeklyReviewGate(context, "just chatting for a bit") === false,
  "ordinary chat should not mention weekly review gate"
);
assert(
  shouldMentionWeeklyReviewGate(context, "我们做周总结吧") === true,
  "weekly summary text should mention weekly review gate when review is required"
);

console.log("MOONLOLO_CONTEXT_PROMPT_OK");
