import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

type JsonRecord = Record<string, unknown>;

const dataRoot = mkdtempSync(join(tmpdir(), "pkos-provider-config-smoke-"));
const apiKey = "PROVIDER_CONFIG_TEST_KEY_SHOULD_NOT_BE_WRITTEN";
const env = { ...process.env, PKOS_DATA_ROOT: dataRoot, DEEPSEEK_API_KEY: apiKey };

try {
  const validProfile = {
    providerId: "deepseek",
    displayName: "DeepSeek",
    protocol: "openai-chat-completions",
    baseUrl: "https://your-api-base.example/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    external: true,
    enabled: true,
    models: [
      {
        id: "model-name",
        displayName: "model-name",
        contextWindow: 128000,
        maxOutputTokens: 4096,
        reasoningControl: { kind: "fixed", defaultPreset: "off" },
      },
    ],
  };

  assert(runConfig(["set", "custom-deepseek", "--json", JSON.stringify(validProfile)]).ok, "set valid profile failed");
  const list = runConfig(["list"]);
  assert(list.ok && JSON.stringify(list.payload).includes("custom-deepseek"), "list did not include profile");
  const show = runConfig(["show", "custom-deepseek"]);
  const shownItem = show.payload.item as JsonRecord | undefined;
  assert(show.ok && shownItem?.keyConfigured === true, "show did not report keyConfigured");
  assert(!JSON.stringify(show.payload).includes(apiKey), "show leaked API key value");
  assert(runConfig(["validate"]).ok, "validate failed for valid profile");
  assert(noTmpFiles(), "atomic write left a temporary file");

  const profileFile = join(dataRoot, "runtime", "agent", "provider_profiles.json");
  assert(!readFileSync(profileFile, "utf8").includes(apiKey), "profile config file contains actual API key");

  writeFileSync(
    profileFile,
    JSON.stringify({
      schemaVersion: "0.6",
      profiles: [
        { ...validProfile, id: "dup-a" },
        { ...validProfile, id: "dup-a" },
      ],
    }),
    "utf8",
  );
  expectError(["validate"], "duplicate_provider_profile");

  expectSetError({ ...validProfile, models: [validProfile.models[0], validProfile.models[0]] }, "duplicate_provider_model");
  expectSetError({ ...validProfile, protocol: "deepseek-native" }, "unknown_provider_protocol");
  expectSetError({ ...validProfile, baseUrl: "http://example.test/v1" }, "invalid_provider_url");
  expectSetError({ ...validProfile, baseUrl: "https://user:pass@example.test/v1" }, "invalid_provider_url");
  expectSetError({ ...validProfile, models: [{ ...validProfile.models[0], reasoningControl: { kind: "preset", adapterId: "unknown", supportedPresets: ["high"], defaultPreset: "high" } }] }, "unknown_reasoning_adapter");
  expectSetError({ ...validProfile, apiKey: "plaintext" }, "plaintext_api_key_not_allowed");
  expectSetError({ ...validProfile, authorization: "Bearer secret" }, "plaintext_api_key_not_allowed");
  expectSetError({ ...validProfile, headers: { authorization: "secret" } }, "plaintext_api_key_not_allowed");
  expectSetError({ ...validProfile, extraBody: { temperature: 0 } }, "plaintext_api_key_not_allowed");
  expectError(["set", "deepseek-official", "--json", JSON.stringify(validProfile)], "builtin_profile_id_reserved");

  writeFileSync(profileFile, JSON.stringify({ schemaVersion: "0.6", profiles: [] }), "utf8");
  assert(runConfig(["set", "custom-deepseek", "--json", JSON.stringify(validProfile)]).ok, "reset valid profile failed");
  assert(runConfig(["remove", "custom-deepseek"]).ok, "remove failed");
  const afterRemove = runConfig(["list"]);
  assert(afterRemove.ok && !JSON.stringify(afterRemove.payload).includes("custom-deepseek"), "remove did not remove profile");

  assert(!existsOutsideRuntimeAgent(), "provider config created unexpected authority files");
  console.log("PROVIDER_CONFIG_SMOKE_OK");
} finally {
  rmSync(dataRoot, { recursive: true, force: true });
}

function expectSetError(profile: JsonRecord, code: string): void {
  expectError(["set", `bad-${code}`, "--json", JSON.stringify(profile)], code);
}

function expectError(args: string[], code: string): void {
  const result = runConfig(args);
  assert(!result.ok, `${args.join(" ")} unexpectedly succeeded`);
  assert(result.code === code, `${args.join(" ")} expected ${code}, got ${result.code}`);
}

function runConfig(args: string[]): { ok: boolean; code?: string; payload: JsonRecord } {
  const tsxCli = join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const result = spawnSync(process.execPath, [tsxCli, "src/scripts/providerConfig.ts", ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) {
    throw result.error;
  }
  const stdout = result.stdout.trim();
  const payload = stdout ? (JSON.parse(stdout) as JsonRecord) : {};
  const error = payload.error;
  return {
    ok: result.status === 0 && payload.ok === true,
    code: error && typeof error === "object" && "code" in error ? String((error as JsonRecord).code) : undefined,
    payload,
  };
}

function noTmpFiles(): boolean {
  const dir = join(dataRoot, "runtime", "agent");
  return readdirSync(dir).every((name) => !name.endsWith(".tmp"));
}

function existsOutsideRuntimeAgent(): boolean {
  for (const name of ["objects", "review", "digests", "raw_vault", "inbox", "state"]) {
    try {
      readdirSync(join(dataRoot, name));
      return true;
    } catch {
      // absent is expected.
    }
  }
  return false;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
