import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

test('mobile tooling has an explicit, secret-free child environment', async () => {
  assert.ok(existsSync(new URL('../scripts/environment.mjs', import.meta.url)), 'mobile environment boundary is not implemented');
  const { childEnvironment } = await import('../scripts/environment.mjs');
  const result = childEnvironment({ PATH: 'tools', SystemRoot: 'windows', TEMP: 'tmp', DEEPSEEK_API_KEY: 'do-not-copy', PKOS_DATA_ROOT: 'formal', NODE_OPTIONS: '--require unsafe', HOME: 'home' });
  assert.equal(result.PATH, 'tools');
  assert.equal(result.DEEPSEEK_API_KEY, undefined);
  assert.equal(result.PKOS_DATA_ROOT, undefined);
  assert.equal(result.NODE_OPTIONS, undefined);
});

test('release config does not inherit debug networking', async () => {
  assert.ok(existsSync(new URL('../scripts/network.mjs', import.meta.url)), 'network policy is not implemented');
  const { capacitorConfig, contentSecurityPolicy, testPort } = await import('../scripts/network.mjs');
  assert.equal(capacitorConfig(false).server.androidScheme, 'https');
  assert.equal(capacitorConfig(true).server.androidScheme, 'http');
  for (const debug of [true, false]) {
    const config = capacitorConfig(debug);
    assert.equal(config.server.url, undefined);
    assert.equal(config.server.cleartext, false);
    assert.equal(config.android.allowMixedContent, false);
    assert.equal(config.plugins.CapacitorHttp.enabled, false);
  }
  assert.match(contentSecurityPolicy(false), /connect-src 'none'/);
  assert.match(contentSecurityPolicy(true), /connect-src http:\/\/127\.0\.0\.1:18790/);
  assert.doesNotMatch(contentSecurityPolicy(true), /unsafe-eval|\*/);
  assert.throws(() => testPort('8790'));
  assert.throws(() => testPort('0'));
});

test('Android cleartext exceptions are narrow debug resources only', () => {
  const root = new URL('../android/app/src/', import.meta.url);
  assert.ok(existsSync(new URL('debug/res/xml/network_security_config.xml', root)), 'debug-only network policy is not implemented');
  const main = readFileSync(new URL('main/res/xml/network_security_config.xml', root), 'utf8');
  const debug = readFileSync(new URL('debug/res/xml/network_security_config.xml', root), 'utf8');
  assert.doesNotMatch(main, /cleartextTrafficPermitted="true"/);
  assert.match(debug, /base-config cleartextTrafficPermitted="false"/);
  assert.deepEqual([...debug.matchAll(/<domain[^>]*>([^<]+)<\/domain>/g)].map(m => m[1]), ['localhost', '127.0.0.1']);
});
