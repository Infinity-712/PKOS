import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const parent = realpathSync(tmpdir());
const root = mkdtempSync(join(parent, "pkos-mobile-regression-"));
const env: NodeJS.ProcessEnv = {};
for (const name of ["PATH", "Path", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) {
  if (process.env[name] !== undefined) env[name] = process.env[name];
}
Object.assign(env, {
  TEMP: root, TMP: root, TMPDIR: root,
  PKOS_CORE_ROOT: resolve(serverRoot, "../.."), PKOS_DATA_ROOT: join(root, "data"),
  PKOS_AGENT_DB_PATH: join(root, "runtime", "agent.sqlite"), PKOS_RUNTIME_PROFILE_NAME: "mobile-regression-synthetic",
});

// Existing provider-profile tests replace fetch with their own fake provider;
// any request that escapes that fake must still be loopback, never production.
const guard = `
const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.port === "8790") {
    throw new Error("regression blocked non-test network request");
  }
  return original(input, init);
};`;

try {
  for (const script of ["smoke", "corsSmoke", "chatHistorySmoke", "providerProfileSmoke"]) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--import", `data:text/javascript,${encodeURIComponent(guard)}`, `src/scripts/${script}.ts`], {
      cwd: serverRoot, env, stdio: "inherit", windowsHide: true, timeout: 90_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${script} failed (${result.status})`);
  }
  console.log("MOBILE_COMPAT_ISOLATED_REGRESSION_OK");
} finally {
  if (dirname(root) !== parent || !basename(root).startsWith("pkos-mobile-regression-")
    || lstatSync(root).isSymbolicLink() || realpathSync(root) !== root) throw new Error("unsafe regression cleanup path");
  rmSync(root, { recursive: true, force: true });
}
