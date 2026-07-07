import {
  optionalString,
  optionalStringEnum,
  requireRecord,
  requireStringEnum,
  textDigest,
  type ToolDefinition,
  type ToolOutput,
} from "../ToolTypes.js";

export type StateAppendInput = {
  energy: string;
  mood: string;
  body: string;
  context: string;
  mode: string;
  risk: {
    shortVideo: string;
    rumination: string;
    overload: string;
  };
  source: string;
  note?: string;
};

const ENERGY = new Set(["high", "low", "medium", "overloaded", "unknown", "very_low"]);
const MOOD = new Set(["anxious", "calm", "excited", "irritated", "low", "numb", "overloaded", "unknown"]);
const BODY = new Set(["chest_tight", "headache", "hungry", "normal", "sick", "sleepy", "tired", "unknown"]);
const CONTEXT = new Set(["before_sleep", "classroom", "dorm", "home", "library", "other", "outside", "travel", "unknown"]);
const MODE = new Set(["life", "other", "project", "quiet", "recovery", "social", "study", "unknown", "writing"]);
const RISK = new Set(["high", "low", "medium", "unknown"]);
const SOURCES = new Set(["app", "manual", "moonlolo", "web"]);

export const stateAppendTool: ToolDefinition<StateAppendInput, ToolOutput> = {
  name: "pkos.state.append",
  description: "Append one current-state snapshot through the Python CLI.",
  permissionLevel: "L1",
  sideEffect: true,
  requiresConfirmation: false,
  validateInput(input: unknown): StateAppendInput {
    const record = requireRecord(input, "pkos.state.append");
    const riskRecord = record.risk && typeof record.risk === "object" && !Array.isArray(record.risk)
      ? (record.risk as Record<string, unknown>)
      : {};
    return {
      energy: requireStringEnum(record.energy, "energy", ENERGY),
      mood: requireStringEnum(record.mood, "mood", MOOD),
      body: requireStringEnum(record.body, "body", BODY),
      context: optionalStringEnum(record.context, "context", CONTEXT, "unknown"),
      mode: optionalStringEnum(record.mode, "mode", MODE, "unknown"),
      risk: {
        shortVideo: optionalStringEnum(riskRecord.shortVideo ?? record.riskShortVideo, "risk.shortVideo", RISK, "unknown"),
        rumination: optionalStringEnum(riskRecord.rumination ?? record.riskRumination, "risk.rumination", RISK, "unknown"),
        overload: optionalStringEnum(riskRecord.overload ?? record.riskOverload, "risk.overload", RISK, "unknown"),
      },
      source: optionalStringEnum(record.source, "source", SOURCES, "manual"),
      note: optionalString(record.note, "note"),
    };
  },
  summarizeInput(input: StateAppendInput): Record<string, unknown> {
    return {
      operation: "pkos.state.append",
      energy: input.energy,
      mood: input.mood,
      body: input.body,
      context: input.context,
      mode: input.mode,
      risk: input.risk,
      source: input.source,
      ...textDigest(input.note, "note"),
    };
  },
  async execute(): Promise<ToolOutput> {
    return {
      status: "error",
      operation: "pkos.state.append",
      errorCode: "not_routed",
      message: "Tool execution is handled by WritebackRouter.",
    };
  },
};
