import type { ReasoningPreset } from "../ProviderTypes.js";

export type ReasoningAdapter = {
  id: string;
  supportedPresets: ReasoningPreset[];
  apply(preset: ReasoningPreset, body: Record<string, unknown>): Record<string, unknown>;
};

const ADAPTERS = new Map<string, ReasoningAdapter>([
  [
    "deepseek-v4-thinking",
    {
      id: "deepseek-v4-thinking",
      supportedPresets: ["off", "high", "max"],
      apply(preset, body) {
        if (preset === "off") {
          return {
            ...body,
            thinking: { type: "disabled" },
          };
        }
        return {
          ...body,
          thinking: { type: "enabled" },
          reasoning_effort: preset,
        };
      },
    },
  ],
]);

export function hasReasoningAdapter(adapterId: string): boolean {
  return ADAPTERS.has(adapterId);
}

export function applyReasoningAdapter(adapterId: string, preset: ReasoningPreset, body: Record<string, unknown>): Record<string, unknown> {
  const adapter = ADAPTERS.get(adapterId);
  if (!adapter || !adapter.supportedPresets.includes(preset)) {
    return body;
  }
  return adapter.apply(preset, body);
}

export function knownReasoningAdapterIds(): string[] {
  return Array.from(ADAPTERS.keys()).sort();
}
