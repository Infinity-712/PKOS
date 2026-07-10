import { DryRunProvider } from "./DryRunProvider.js";
import { OpenAIChatCompatibleProvider } from "./OpenAIChatCompatibleProvider.js";
import { openAIConfigFromSnapshot } from "./ProviderConfig.js";
import type { ProviderSelectionSnapshot } from "./ProviderRuntimeSelection.js";
import type { AgentProvider } from "./ProviderTypes.js";

export function createProviderFromSnapshot(snapshot: ProviderSelectionSnapshot, env: NodeJS.ProcessEnv = process.env): AgentProvider | null {
  if (snapshot.protocol === "dry-run") {
    return new DryRunProvider();
  }
  if (snapshot.protocol === "openai-chat-completions" && snapshot.configured) {
    return new OpenAIChatCompatibleProvider(openAIConfigFromSnapshot(snapshot, env));
  }
  return null;
}
