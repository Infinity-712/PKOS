import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('mobile shell is present with three views, explicit send and native lifecycle', () => {
  const file = new URL('../src/App.tsx', import.meta.url);
  assert.ok(existsSync(file), 'mobile UI is not implemented');
  const source = readFileSync(file, 'utf8');
  for (const contract of ['data-testid="connection-page"', "'chat-page'", "'history-page'", 'onCompositionStart', 'onCompositionEnd', 'manageNativeListeners', 'appStateChange', 'backButton']) assert.ok(source.includes(contract), contract);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|CapacitorHttp|electron|node:fs/);
});
