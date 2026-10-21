import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const browser = process.env.PKOS_TEST_BROWSER ?? [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
].find(existsSync);
assert(browser, "Set PKOS_TEST_BROWSER to a Chromium/Edge executable");
const bundle = await build({
  entryPoints: ["src/scripts/reviewRaceBrowser.tsx"], bundle: true, write: false, format: "esm", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
});
const temp = mkdtempSync(join(tmpdir(), "pkos-review-browser-"));
let result;
const server = createServer(async (req, res) => {
  if (req.url === "/test.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" }).end(bundle.outputFiles[0].contents);
  } else if (req.url === "/result" && req.method === "POST") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    result = JSON.parse(Buffer.concat(chunks).toString());
    res.end("ok");
  } else {
    res.writeHead(200, { "Content-Type": "text/html" }).end('<!doctype html><div id="root"></div><script type="module" src="/test.js"></script>');
  }
});
let child;
try {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  child = spawn(browser, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${join(temp, "profile")}`, "--dump-dom", "--virtual-time-budget=10000", `http://127.0.0.1:${server.address().port}`], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-3000); });
  const timeout = setTimeout(() => child.kill(), 30000);
  try {
    await new Promise((done, reject) => { child.once("error", reject); child.once("exit", done); });
  } finally { clearTimeout(timeout); }
  assert(result, `Browser did not return a test result: ${stderr}`);
  for (const item of result) console.log(`${item.ok ? "PASS" : "FAIL"} ${item.name}${item.error ? `: ${item.error}` : ""}`);
  assert(result.every((item) => item.ok), "Review async UI regression failed");
  console.log("REVIEW_RACE_SMOKE_OK");
} finally {
  if (child && child.exitCode === null) child.kill();
  await new Promise((done) => server.close(done));
  assert(resolve(temp).startsWith(resolve(tmpdir())), "Unsafe browser temp path");
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
