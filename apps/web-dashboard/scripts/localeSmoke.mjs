import assert from "node:assert/strict";
import { build } from "esbuild";

for (const path of ["src/i18n/preference.ts", "../desktop/src/renderer/i18n/preference.ts"]) {
  const bundle = await build({ entryPoints: [path], bundle: true, write: false, format: "esm", platform: "node" });
  const { readLocale, saveLocale } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`);
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(readLocale(storage), "zh-CN");
  saveLocale("en", storage);
  assert.equal(readLocale(storage), "en");
  assert.deepEqual([...values], [["pkos.ui.locale", "en"]]);
  saveLocale("private content", storage);
  assert.equal(values.get("pkos.ui.locale"), "en");
  values.set("pkos.ui.locale", "invalid");
  assert.equal(readLocale(storage), "zh-CN");
  const denied = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); } };
  assert.equal(readLocale(denied), "zh-CN");
  assert.doesNotThrow(() => saveLocale("en", denied));
}
console.log("LOCALE_PREFERENCE_SMOKE_OK");
