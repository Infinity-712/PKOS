import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

test('native listener resolved after disposal is still removed exactly once', async () => {
  assert.ok(existsSync(new URL('../src/lifecycle.ts', import.meta.url)), 'lifecycle cleanup is not implemented');
  const { manageNativeListeners } = await import('../src/lifecycle.js');
  let removed = 0;
  let resolve!: (handle: { remove(): Promise<void> }) => void;
  const pending = new Promise<{ remove(): Promise<void> }>(r => { resolve = r; });
  const cleanup = manageNativeListeners([pending]);
  cleanup();
  resolve({ async remove() { removed++; } });
  await pending;
  await Promise.resolve();
  cleanup();
  assert.equal(removed, 1);
});

test('unsupported Web APIs are named instead of silently assuming compatibility', async () => {
  assert.ok(existsSync(new URL('../src/diagnostics.ts', import.meta.url)), 'WebView capability checks are not implemented');
  const { probeCapabilities } = await import('../src/diagnostics.js');
  const results = probeCapabilities({});
  assert.equal(results.find(item => item.name === 'ReadableStream')?.supported, false);
  assert.equal(results.find(item => item.name === 'TextDecoder')?.supported, false);
});
