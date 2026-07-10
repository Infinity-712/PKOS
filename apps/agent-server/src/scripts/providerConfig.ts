import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { resolveAgentPaths } from "../config/paths.js";
import {
  providerProfilesConfigPath,
  readUserProviderProfileConfig,
  validateProviderProfileConfig,
  writeUserProviderProfileConfig,
} from "../providers/registry/ProviderProfileConfigLoader.js";
import { ProviderProfileRegistry } from "../providers/registry/ProviderProfileRegistry.js";
import { ProviderProfileConfigError, type ProviderProfile, type ProviderProfileConfigFile } from "../providers/registry/ProviderProfileTypes.js";

type Command = "list" | "show" | "set" | "remove" | "validate";

const [, , commandRaw, ...args] = process.argv;
const command = commandRaw as Command | undefined;

try {
  if (!command || !["list", "show", "set", "remove", "validate"].includes(command)) {
    throw new ProviderProfileConfigError("invalid_provider_config", "usage: provider-config <list|show|set|remove|validate>");
  }
  const paths = resolveAgentPaths();
  if (command === "list") {
    printJson({ ok: true, path: providerProfilesConfigPath(paths), items: new ProviderProfileRegistry(paths).summaries() });
  } else if (command === "show") {
    const profileId = requireArg(args[0], "profile id");
    const item = new ProviderProfileRegistry(paths).summaries().find((profile) => profile.profileId === profileId);
    if (!item) {
      throw new ProviderProfileConfigError("invalid_provider_config", `profile not found: ${profileId}`);
    }
    printJson({ ok: true, item });
  } else if (command === "set") {
    const profileId = requireArg(args[0], "profile id");
    const json = requireJsonArg(args);
    const parsed = JSON.parse(json) as unknown;
    const profile = profileFromSetJson(profileId, parsed);
    const current = readUserProviderProfileConfig(paths);
    const profiles = [...current.profiles.filter((candidate) => candidate.id !== profileId), profile];
    writeUserProviderProfileConfig({ schemaVersion: "0.6", profiles }, paths);
    const item = new ProviderProfileRegistry(paths).summaries().find((candidate) => candidate.profileId === profileId);
    printJson({ ok: true, item });
  } else if (command === "remove") {
    const profileId = requireArg(args[0], "profile id");
    const current = readUserProviderProfileConfig(paths);
    writeUserProviderProfileConfig({ schemaVersion: "0.6", profiles: current.profiles.filter((profile) => profile.id !== profileId) }, paths);
    printJson({ ok: true, removed: profileId });
  } else {
    const path = providerProfilesConfigPath(paths);
    if (!existsSync(path)) {
      validateProviderProfileConfig({ schemaVersion: "0.6", profiles: [] }, { requireHttps: true, allowDryRun: false });
      printJson({ ok: true, path, profiles: 0 });
    } else {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      const config = validateProviderProfileConfig(parsed, { requireHttps: true, allowDryRun: false });
      writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      printJson({ ok: true, path, profiles: config.profiles.length });
    }
  }
} catch (error) {
  if (error instanceof ProviderProfileConfigError) {
    printJson({ ok: false, error: { code: error.code, message: error.message } });
    process.exit(1);
  }
  const message = error instanceof Error ? error.message : String(error);
  printJson({ ok: false, error: { code: "invalid_provider_config", message } });
  process.exit(1);
}

function profileFromSetJson(profileId: string, value: unknown): ProviderProfile {
  if (!isRecord(value)) {
    throw new ProviderProfileConfigError("invalid_provider_config", "profile JSON must be an object");
  }
  const candidate = { ...value, id: profileId };
  if (typeof value.id === "string" && value.id !== profileId) {
    throw new ProviderProfileConfigError("invalid_provider_config", "profile JSON id must match profile id argument");
  }
  const config = validateProviderProfileConfig({ schemaVersion: "0.6", profiles: [candidate] }, { requireHttps: true, allowDryRun: false });
  return config.profiles[0];
}

function requireArg(value: string | undefined, name: string): string {
  if (!value) {
    throw new ProviderProfileConfigError("invalid_provider_config", `${name} is required`);
  }
  return value;
}

function requireJsonArg(args: string[]): string {
  const jsonFlag = args.indexOf("--json");
  if (jsonFlag < 0 || !args[jsonFlag + 1]) {
    throw new ProviderProfileConfigError("invalid_provider_config", "--json is required");
  }
  return args[jsonFlag + 1];
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
