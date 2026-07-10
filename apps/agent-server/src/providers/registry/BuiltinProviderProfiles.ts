import type { ProviderProfile } from "./ProviderProfileTypes.js";

export const DRY_RUN_PROFILE_ID = "dry-run";
export const DRY_RUN_MODEL_ID = "dry-run";
export const DEEPSEEK_OFFICIAL_PROFILE_ID = "deepseek-official";

export function builtinProviderProfiles(): ProviderProfile[] {
  return [
    {
      id: DRY_RUN_PROFILE_ID,
      providerId: "dry-run",
      displayName: "Dry-run",
      protocol: "dry-run",
      baseUrl: "",
      external: false,
      enabled: true,
      models: [
        {
          id: DRY_RUN_MODEL_ID,
          displayName: "Dry-run",
          reasoningControl: { kind: "fixed", defaultPreset: "off" },
        },
      ],
    },
    {
      id: DEEPSEEK_OFFICIAL_PROFILE_ID,
      providerId: "deepseek",
      displayName: "DeepSeek",
      protocol: "openai-chat-completions",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      external: true,
      enabled: true,
      models: [
        {
          id: "deepseek-v4-pro",
          displayName: "DeepSeek V4 Pro",
          reasoningControl: {
            kind: "preset",
            adapterId: "deepseek-v4-thinking",
            supportedPresets: ["off", "high", "max"],
            defaultPreset: "high",
          },
        },
        {
          id: "deepseek-v4-flash",
          displayName: "DeepSeek V4 Flash",
          reasoningControl: {
            kind: "preset",
            adapterId: "deepseek-v4-thinking",
            supportedPresets: ["off", "high", "max"],
            defaultPreset: "high",
          },
        },
      ],
    },
  ];
}

export function builtinProviderProfileIds(): Set<string> {
  return new Set(builtinProviderProfiles().map((profile) => profile.id));
}
