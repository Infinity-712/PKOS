import assert from 'node:assert/strict';
import test from 'node:test';
import { createMobileStore, canSubmit, shouldSendOnEnter } from '../src/store.js';
import { createCompatClient, normalizeBaseUrl } from '../src/compatClient.js';
import { projectPreferences, type MobilePreferences, type PreferenceAdapter } from '../src/preferences.js';

const stamp = '2026-10-05T00:00:00.000Z';
const session = (id: string) => ({ id, title: id, status: 'active', created_at: stamp, updated_at: stamp });
const message = (id: string, generationId: string | null = null) => ({ id, role: 'assistant', content: `history ${id}`, generationId, status: 'completed', createdAt: stamp, updatedAt: stamp });
const runtime = () => ({
  service: { name: 'pkos-agent-server', version: '0.7-service-identity', apiContractVersion: '0.7', buildFingerprint: '123456789abc', sourceRevision: 'synthetic', dirty: false, capabilities: ['runtime-info.v1', 'chat.sessions.read', 'chat.messages.read', 'chat.send.readonly', 'provider.status.read'], manifestFingerprint: '123456789abc' },
  profileName: 'synthetic', runtimeFingerprint: 'synthetic', dataRoot: { label: 'synthetic', fingerprint: 'synthetic' },
  database: { exists: true, schemaVersion: 6, requiredSchemaVersion: 6, compatible: true },
  process: { startedAt: stamp, pid: 1 }, provider: { profileId: 'dry-run', modelId: null, reasoningPreset: 'off', keyConfigured: true },
});
const provider = () => ({
  selection: { profileId: 'dry-run', providerId: 'dry-run', providerDisplayName: 'Synthetic', protocol: 'dry-run', modelId: 'mock', modelDisplayName: 'Mock', reasoningPreset: 'off', external: false, keyConfigured: true },
  connection: { state: 'dry_run', lastAttemptAt: null, lastSuccessAt: null, lastErrorCode: null }, consentRequired: false, configured: true,
  capabilities: { streaming: true, textGeneration: true, toolCallingEnabled: false, reasoningPresets: ['off'] }, provider: 'dry-run', model: null, dataEgress: 'none', toolsEnabled: false, readOnly: true,
});
let eventSeq = 0;
const event = (type: string, payload: unknown, sessionId = 'A', generationId = 'g1') => ({ id: `e${++eventSeq}`, ts: stamp, sessionId, generationId, type, payload, severity: 'info' });
const started = () => event('generation_started', { status: 'running' });
const delta = (text = '\u4f60\u597d\ud83d\ude42') => event('content_delta', { delta: text });
const completed = () => event('generation_completed', { status: 'completed', contentLength: 4 });
const json = (data: unknown) => Response.json(data);
function stream(items: unknown[], tail = '') {
  const bytes = new TextEncoder().encode(items.map(item => JSON.stringify(item)).join('\n') + '\n' + tail);
  let position = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (position === bytes.length) controller.close();
    else controller.enqueue(bytes.slice(position, ++position));
  } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function preferences(seed: unknown = undefined) {
  let value = seed;
  const saves: MobilePreferences[] = [];
  const adapter: PreferenceAdapter = { load: async () => value, save: async next => { value = structuredClone(next); saves.push(structuredClone(next)); } };
  return { adapter, saves, read: () => value };
}
function harness(seed?: unknown) {
  const prefs = preferences(seed);
  const h = {
    fixture: { mode: 'synthetic', fixtureVersion: '1', fixtureId: 'fixture-1' }, runtime: runtime(), provider: provider(),
    calls: [] as { path: string; init: RequestInit }[], histories: { A: [message('mA')], B: [message('mB')] } as Record<string, unknown[]>,
    history: undefined as undefined | ((id: string) => Promise<Response>),
    send: () => Promise.resolve(stream([started(), delta(), completed()])),
    abort: () => Promise.resolve(json({ ok: true, generationId: 'g1', status: 'aborted' })),
    prefs,
  };
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    h.calls.push({ path: url.pathname, init });
    if (url.pathname === '/__mobile_compat__/info') return json(h.fixture);
    if (url.pathname === '/api/runtime-info') return json(h.runtime);
    if (url.pathname === '/api/chat/provider-status') return json(h.provider);
    if (url.pathname === '/api/chat/sessions') return init.method === 'POST' ? json({ ok: true, session: session('C') }) : json({ ok: true, sessions: [session('A'), session('B')] });
    if (url.pathname.endsWith('/messages')) {
      const id = url.pathname.split('/')[4];
      return h.history ? h.history(id) : json({ sessionId: id, items: h.histories[id] ?? [], nextBefore: null });
    }
    if (url.pathname === '/api/chat/send') return h.send();
    if (url.pathname.endsWith('/abort')) return h.abort();
    throw new Error('unexpected endpoint');
  };
  const makeStore = () => createMobileStore({ fetch: fetchImpl, preferences: prefs.adapter, abortTimeoutMs: 15 });
  return { ...h, h, fetchImpl, makeStore, store: makeStore() };
}

test('only explicit loopback test ports normalize', () => {
  assert.equal(normalizeBaseUrl(' http://127.0.0.1:18790/ '), 'http://127.0.0.1:18790');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:20001'), 'http://127.0.0.1:20001');
  for (const value of ['http://127.0.0.1:8790', 'http://localhost:18790', 'https://127.0.0.1:18790', 'http://127.1:18790', 'http://127.0.0.1:80', 'http://127.0.0.1:18790/path', 'http://u:p@127.0.0.1:18790', 'http://127.0.0.1:18790?x', 'http://127.0.0.1:18790#x']) assert.throws(() => normalizeBaseUrl(value));
});
test('preference load/save projection only includes metadata', async () => {
  const dirty = { language: 'en', baseUrl: 'http://127.0.0.1:18790', fixtureId: 'fixture-1', lastSessionId: 'A', pending: { sessionId: 'A', generationId: 'g1', text: 'secret' }, messages: ['secret'], draft: 'secret', apiKey: 'secret' };
  assert.deepEqual(projectPreferences(dirty), { language: 'en', baseUrl: dirty.baseUrl, fixtureId: 'fixture-1', lastSessionId: 'A', pending: { sessionId: 'A', generationId: 'g1' } });
  const { store, prefs } = harness(dirty);
  await store.connect();
  store.setLanguage('zh');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(JSON.stringify(prefs.saves).includes('secret'), false);
  assert.equal(store.getSnapshot().views.A.status, 'unknown');
  store.dispose();
});
test('connect checks identity before history and omits credentials / forbids redirects', async () => {
  const { store, h } = harness();
  assert.equal(await store.connect(), true);
  assert.deepEqual(h.calls.slice(0, 3).map(c => c.path), ['/__mobile_compat__/info', '/api/runtime-info', '/api/chat/provider-status']);
  for (const call of h.calls) {
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.credentials, 'omit');
    assert.equal(new Headers(call.init.headers).has('Authorization'), false);
  }
  assert.equal(store.getSnapshot().views.A.messages[0].id, 'mA');
  store.dispose();
});
for (const keyConfigured of [true, false]) test(`dry-run readiness flag ${keyConfigured} is not credential evidence`, async () => {
  const { store, h } = harness();
  h.runtime.provider.keyConfigured = keyConfigured;
  h.provider.selection.keyConfigured = keyConfigured;
  assert.equal(await store.connect(), true);
  assert.equal(store.getSnapshot().provider?.selection.external, false);
  assert.equal(store.getSnapshot().runtime?.provider.keyConfigured, keyConfigured);
  assert.equal(await store.send('synthetic'), 'completed');
  store.dispose();
});
for (const [name, mutate] of [
  ['runtime profile', (h: ReturnType<typeof harness>['h']) => { h.runtime.provider.profileId = 'other'; }],
  ['selection profile', (h: ReturnType<typeof harness>['h']) => { h.provider.selection.profileId = 'other'; }],
  ['provider identity', (h: ReturnType<typeof harness>['h']) => { h.provider.selection.providerId = 'other'; }],
  ['top-level protocol', (h: ReturnType<typeof harness>['h']) => { h.provider.provider = 'openai-chat-completions'; }],
  ['data egress', (h: ReturnType<typeof harness>['h']) => { h.provider.dataEgress = 'configured-endpoint'; }],
  ['tools enabled', (h: ReturnType<typeof harness>['h']) => { h.provider.toolsEnabled = true; }],
  ['tool calling enabled', (h: ReturnType<typeof harness>['h']) => { h.provider.capabilities.toolCallingEnabled = true; }],
  ['not read-only', (h: ReturnType<typeof harness>['h']) => { h.provider.readOnly = false; }],
  ['consent required', (h: ReturnType<typeof harness>['h']) => { h.provider.consentRequired = true; }],
] as const) test(`dry-run guard still rejects ${name} regardless of readiness flag`, async () => {
  const { store, h } = harness();
  h.runtime.provider.keyConfigured = false;
  mutate(h);
  assert.equal(await store.connect(), false);
  assert.equal(h.calls.some(c => c.path.includes('/sessions')), false);
  assert.equal(await store.send('blocked'), 'blocked');
  store.dispose();
});
for (const [name, mutate] of [
  ['wrong mode', (h: ReturnType<typeof harness>['h']) => { h.fixture.mode = 'real'; }],
  ['wrong fixture version', (h: ReturnType<typeof harness>['h']) => { h.fixture.fixtureVersion = '2'; }],
  ['empty fixture', (h: ReturnType<typeof harness>['h']) => { h.fixture.fixtureId = ''; }],
  ['wrong service', (h: ReturnType<typeof harness>['h']) => { h.runtime.service.name = 'other'; }],
  ['wrong contract', (h: ReturnType<typeof harness>['h']) => { h.runtime.service.apiContractVersion = '99'; }],
  ['wrong version', (h: ReturnType<typeof harness>['h']) => { h.runtime.service.version = '99'; }],
  ['missing capability', (h: ReturnType<typeof harness>['h']) => { h.runtime.service.capabilities = []; }],
  ['incompatible database', (h: ReturnType<typeof harness>['h']) => { h.runtime.database.compatible = false; }],
  ['malformed runtime', (h: ReturnType<typeof harness>['h']) => { h.runtime.service.buildFingerprint = ''; }],
  ['external provider', (h: ReturnType<typeof harness>['h']) => { h.provider.selection.external = true; }],
  ['real provider', (h: ReturnType<typeof harness>['h']) => { h.provider.selection.protocol = 'openai-chat-completions'; }],
] as const) test(`identity blocks ${name}`, async () => {
  const { store, h } = harness(); mutate(h);
  assert.equal(await store.connect(), false);
  assert.equal(store.getSnapshot().connection, 'error');
  assert.equal(h.calls.some(c => c.path.includes('/sessions')), false);
  assert.equal(await store.send('text'), 'blocked');
  store.dispose();
});
test('send rechecks identity and uses scenario header / failed prefix only for mock', async () => {
  const { store, h } = harness(); await store.connect();
  h.send = async () => stream([started(), event('generation_failed', { code: 'synthetic_failure' })]);
  assert.equal(await store.send('text', 'failed'), 'failed');
  const call = h.calls.find(c => c.path === '/api/chat/send')!;
  assert.equal(new Headers(call.init.headers).get('X-PKOS-Compat-Scenario'), 'failed');
  assert.equal(JSON.parse(String(call.init.body)).message, '[compat:failed] text');
  assert.equal(JSON.parse(String(call.init.body)).allowExternalProvider, false);
  h.fixture.mode = 'real';
  assert.equal(await store.send('blocked'), 'blocked');
  assert.equal(h.calls.filter(c => c.path === '/api/chat/send').length, 1);
  store.dispose();
});
test('split UTF-8 Chinese/emoji streams and actual completed terminal', async () => {
  const { store, h } = harness(); await store.connect();
  assert.equal(await store.send('hello'), 'completed');
  assert.equal(store.getSnapshot().views.A.messages.at(-1)?.content, '\u4f60\u597d\ud83d\ude42');
  assert.equal(store.getSnapshot().pending, null);
  assert.equal(h.calls.filter(c => c.path === '/api/chat/send').length, 1);
  store.dispose();
});
for (const [name, items, tail, expected] of [
  ['failed', [started(), delta(), event('generation_failed', { code: 'mock_failure' })], '', 'failed'],
  ['aborted', [started(), delta(), event('generation_aborted', { reason: 'user_requested_abort' })], '', 'aborted'],
  ['EOF', [started(), delta()], '', 'unknown'],
  ['malformed tail', [started(), delta()], '{broken', 'unknown'],
  ['stream error', [started(), { ok: false, error: { code: 'network', message: 'secret' } }], '', 'unknown'],
  ['unknown event', [started(), event('new_unknown_event', {})], '', 'unknown'],
  ['invalid completed', [started(), event('generation_completed', {})], '', 'unknown'],
  ['invalid failed', [started(), event('generation_failed', { status: 'failed' })], '', 'unknown'],
  ['invalid aborted', [started(), event('generation_aborted', {})], '', 'unknown'],
  ['cross-session terminal', [started(), event('generation_completed', { status: 'completed' }, 'B')], '', 'unknown'],
  ['cross-generation delta', [started(), event('content_delta', { delta: 'wrong' }, 'A', 'other')], '', 'unknown'],
] as const) test(`terminal safety: ${name}`, async () => {
  const { store, h } = harness(); await store.connect(); h.send = async () => stream([...items], tail);
  assert.equal(await store.send('hello'), expected);
  assert.equal(store.getSnapshot().views.A.status, expected);
  assert.equal(Boolean(store.getSnapshot().pending), expected === 'unknown');
  if (expected === 'unknown') assert.equal(store.getSnapshot().views.A.error, 'result_unverified');
  store.dispose();
});
test('double click is single-flight; mobile Enter never sends and composition blocks', async () => {
  const { store, h } = harness(); await store.connect();
  const wait = deferred<Response>(); h.send = () => wait.promise;
  const first = store.send('hello');
  assert.equal(await store.send('hello'), 'busy');
  wait.resolve(stream([started(), completed()]));
  assert.equal(await first, 'completed');
  assert.equal(h.calls.filter(c => c.path === '/api/chat/send').length, 1);
  assert.equal(canSubmit('hello', true), false);
  assert.equal(canSubmit('hello', false, true), false);
  assert.equal(canSubmit('  ', false), false);
  assert.equal(canSubmit('hello', false), true);
  assert.equal(shouldSendOnEnter({ key: 'Enter', isComposing: false }), false);
  store.dispose();
});
test('late A history cannot pollute B; stale same-session response loses to newer one', async () => {
  const { store, h } = harness(); await store.connect();
  const old = deferred<Response>(); let first = true;
  h.history = async id => id === 'A' && first ? (first = false, old.promise) : json({ sessionId: id, items: [message(`new-${id}`)], nextBefore: null });
  const late = store.selectSession('A'); await store.selectSession('B'); await store.selectSession('A');
  old.resolve(json({ sessionId: 'A', items: [message('old-A')], nextBefore: null })); await late;
  assert.equal(store.getSnapshot().selectedId, 'A');
  assert.equal(store.getSnapshot().views.A.messages.some(m => m.id === 'old-A'), false);
  assert.deepEqual(store.getSnapshot().views.B.messages.map(m => m.id), ['new-B']);
  store.dispose();
});
test('reconstruction/resume always reads server history, keeps unresolved metadata, never posts', async () => {
  const { store, makeStore, h, prefs } = harness(); await store.connect();
  h.send = async () => stream([started(), delta()]);
  assert.equal(await store.send('not-on-disk'), 'unknown');
  store.suspend(); await store.resume();
  assert.equal(store.getSnapshot().pending?.generationId, 'g1');
  store.dispose(); const next = makeStore(); await next.connect();
  assert.equal(next.getSnapshot().views.A.status, 'unknown');
  assert.equal(next.getSnapshot().views.A.messages[0].id, 'mA');
  h.histories.A = [message('mA'), message('answer', 'g1')];
  await next.resume(); await next.resume();
  assert.deepEqual(next.getSnapshot().views.A.messages.map(m => m.id), ['mA', 'answer']);
  assert.equal(next.getSnapshot().pending, null);
  assert.equal(h.calls.filter(c => c.init.method === 'POST').length, 1);
  assert.equal(h.calls.some(c => c.path.includes('/generations/')), false);
  assert.equal(JSON.stringify(prefs.saves).includes('not-on-disk'), false);
  next.dispose();
});
test('fixture changes clear old views/pending; late old history ignored', async () => {
  const { store, h } = harness(); await store.connect();
  h.send = async () => stream([started()]); await store.send('hello');
  const wait = deferred<Response>(); h.history = () => wait.promise;
  const old = store.selectSession('B');
  h.fixture.fixtureId = 'fixture-2'; h.history = undefined;
  h.histories.A = [message('new-fixture')];
  await store.resume(); wait.resolve(json({ sessionId: 'B', items: [message('old-fixture')], nextBefore: null })); await old;
  assert.equal(store.getSnapshot().fixtureChanged, true);
  assert.equal(store.getSnapshot().pending, null);
  assert.equal(store.getSnapshot().views.B, undefined);
  assert.deepEqual(store.getSnapshot().views.A.messages.map(m => m.id), ['new-fixture']);
  store.dispose();
});
test('suspend cancels local stream without POST, preserves unknown; dispose removes listeners', async () => {
  const { store, h } = harness(); await store.connect();
  const seen = deferred<void>(); let canceled = false;
  h.send = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(started()) + '\n')); seen.resolve(); }, cancel() { canceled = true; } }));
  let notifications = 0; store.subscribe(() => { notifications++; });
  const send = store.send('hello'); await seen.promise; await new Promise(r => setTimeout(r, 0));
  store.suspend(); assert.equal(await send, 'unknown');
  assert.equal(store.getSnapshot().connection, 'suspended');
  assert.equal(store.getSnapshot().views.A.status, 'unknown');
  assert.equal(h.calls.some(c => c.path.endsWith('/abort')), false);
  assert.equal(canceled, true);
  store.dispose(); const count = notifications; store.setLanguage('en'); assert.equal(notifications, count);
});
test('bounded stop with unresponsive abort remains unknown and never clears newer state', async () => {
  const { store, h } = harness(); await store.connect(); const seen = deferred<void>();
  h.send = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(started()) + '\n')); seen.resolve(); } }));
  h.abort = () => new Promise(() => {});
  const send = store.send('hello'); await seen.promise; await new Promise(r => setTimeout(r, 0));
  await store.stop(); assert.equal(await send, 'unknown');
  assert.equal(store.getSnapshot().pending?.generationId, 'g1');
  assert.equal(store.getSnapshot().views.A.status, 'unknown');
  store.dispose();
});
test('server-confirmed abort can clear pending', async () => {
  const { store, h } = harness(); await store.connect(); const seen = deferred<void>();
  h.send = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(started()) + '\n')); seen.resolve(); } }));
  const send = store.send('hello'); await seen.promise; await new Promise(r => setTimeout(r, 0));
  await store.stop(); assert.equal(await send, 'aborted');
  assert.equal(store.getSnapshot().pending, null);
  assert.equal(store.getSnapshot().views.A.status, 'aborted');
  store.dispose();
});

test('normal AgentRunner context_built is informational, not a stream failure', async () => {
  const { store, h } = harness(); await store.connect();
  h.send = async () => stream([started(), event('context_built', { promptChars: 10, external: false }), delta(), completed()]);
  assert.equal(await store.send('hello'), 'completed');
  store.dispose();
});
test('aborting a fetch that ignores AbortSignal still settles and cancels late response body', async () => {
  const { store, h } = harness(); await store.connect();
  const sent = deferred<void>(); const response = deferred<Response>(); let canceled = false;
  h.send = () => { sent.resolve(); return response.promise; };
  const pending = store.send('hello'); await sent.promise;
  store.suspend();
  assert.equal(await Promise.race([pending, new Promise(r => setTimeout(() => r('hung'), 30))]), 'unknown');
  response.resolve(new Response(new ReadableStream({ cancel() { canceled = true; } })));
  await new Promise(r => setTimeout(r, 0));
  assert.equal(canceled, true);
  store.dispose();
});
test('aborted request cannot POST even when injected fetch ignores signal', async () => {
  const { fetchImpl, prefs, h } = harness(); const wait = deferred<Response>(); let gate = false;
  const store = createMobileStore({ preferences: prefs.adapter, fetch: async (input, init) => gate && String(input).endsWith('/__mobile_compat__/info') ? wait.promise : fetchImpl(input, init) });
  await store.connect(); gate = true;
  const pending = store.send('hello'); await store.stop();
  wait.resolve(json(h.fixture)); await pending;
  assert.equal(h.calls.some(c => c.path === '/api/chat/send'), false);
  assert.equal(store.getSnapshot().pending, null);
  store.dispose();
});
test('projection drops recovery identity when stored URL is invalid', () => {
  const result = projectPreferences({ language: 'en', baseUrl: 'http://127.0.0.1:8790', fixtureId: 'old', lastSessionId: 'A', pending: { sessionId: 'A', generationId: 'old' } });
  assert.equal(result.fixtureId, null);
  assert.equal(result.lastSessionId, null);
  assert.equal(result.pending, undefined);
});
test('an identity changed during send blocks POST and reports fixture switch', async () => {
  const { store, h } = harness(); await store.connect();
  h.fixture.fixtureId = 'fixture-2';
  assert.equal(await store.send('hello'), 'blocked');
  assert.equal(store.getSnapshot().fixtureChanged, true);
  assert.deepEqual(store.getSnapshot().views, {});
  assert.equal(h.calls.some(c => c.init.method === 'POST'), false);
  store.dispose();
});
test('late abort response cannot clear a newer fixture request', async () => {
  const { store, h } = harness(); await store.connect();
  const seen = deferred<void>(); const abort = deferred<Response>();
  h.send = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(JSON.stringify(started()) + '\n')); seen.resolve(); } }));
  h.abort = () => abort.promise;
  const first = store.send('first'); await seen.promise; await new Promise(r => setTimeout(r, 0));
  const stop = store.stop(); store.suspend(); await first;
  h.fixture.fixtureId = 'fixture-2'; await store.resume();
  h.send = async () => stream([event('generation_started', { status: 'running' }, 'A', 'g2')]);
  assert.equal(await store.send('second'), 'unknown');
  abort.resolve(json({ ok: true, generationId: 'g1', status: 'aborted' })); await stop;
  assert.equal(store.getSnapshot().pending?.generationId, 'g2');
  assert.equal(store.getSnapshot().views.A.status, 'unknown');
  store.dispose();
});
test('fixture-only client never creates sessions', async () => {
  const { store, h } = harness(); await store.connect();
  assert.equal(h.calls.some(c => c.init.method === 'POST'), false);
  assert.equal(await store.createSession('Synthetic'), null);
  assert.equal(store.getSnapshot().selectedId, 'A');
  assert.equal(store.getSnapshot().error, 'session_create_unsupported');
  assert.equal(h.calls.filter(c => c.init.method === 'POST').length, 0);
  store.dispose();
});
test('preference failure prevents sending without a recovery marker', async () => {
  const { fetchImpl, h } = harness();
  const store = createMobileStore({ fetch: fetchImpl, preferences: { load: async () => null, save: async () => { throw new Error('secret data'); } } });
  await store.connect();
  assert.equal(await store.send('hello'), 'blocked');
  assert.equal(h.calls.some(c => c.init.method === 'POST'), false);
  assert.equal(store.getSnapshot().error, 'preferences_unavailable');
  store.dispose();
});
test('transport strips arbitrary credentials and rejects redirected responses', async () => {
  const compat = createCompatClient('http://127.0.0.1:18790', async (_input, init) => {
    assert.equal(init?.credentials, 'omit');
    assert.equal(init?.redirect, 'error');
    assert.deepEqual([...new Headers(init?.headers).keys()], []);
    const response = json({ mode: 'synthetic', fixtureVersion: '1', fixtureId: 'f' });
    Object.defineProperty(response, 'redirected', { value: true });
    return response;
  });
  await assert.rejects(() => compat.verify(), /unexpected_redirect/);
});
test('external-store snapshots stay stable until updates and unsubscribe works', async () => {
  const { store } = harness(); let count = 0;
  const previous = store.getSnapshot(); assert.equal(store.getSnapshot(), previous);
  const unsubscribe = store.subscribe(() => { count++; });
  await store.connect(); assert.notEqual(store.getSnapshot(), previous);
  const ready = store.getSnapshot(); assert.equal(store.getSnapshot(), ready);
  unsubscribe(); const before = count; store.setLanguage('en'); assert.equal(count, before);
  store.dispose();
});
test('terminal refresh replaces optimistic entries with stable server message IDs', async () => {
  const { store, h } = harness(); await store.connect();
  h.send = async () => {
    h.histories.A = [message('mA'), { ...message('user-1'), role: 'user', content: 'hello' }, { ...message('answer-1', 'g1'), content: '\u4f60\u597d\ud83d\ude42' }];
    return stream([started(), delta(), completed()]);
  };
  assert.equal(await store.send('hello'), 'completed');
  assert.deepEqual(store.getSnapshot().views.A.messages.map(m => m.id), ['mA', 'user-1', 'answer-1']);
  assert.equal(store.getSnapshot().views.A.status, 'completed');
  assert.equal(h.calls.filter(c => c.path.endsWith('/messages')).length, 2);
  store.dispose();
});
test('terminal refresh failure does not undo confirmed completion or resurrect pending', async () => {
  const { store, h } = harness(); await store.connect();
  h.history = async () => { throw new Error('offline'); };
  assert.equal(await store.send('hello'), 'completed');
  assert.equal(store.getSnapshot().views.A.status, 'completed');
  assert.equal(store.getSnapshot().pending, null);
  store.dispose();
});

for (const interruption of ['suspend', 'reconnect', 'dispose'] as const) test(`${interruption} while saving an unposted marker clears persisted recovery state`, async () => {
  const { store, h, prefs, makeStore } = harness();
  await store.connect();
  const entered = deferred<void>(); const release = deferred<void>();
  const save = prefs.adapter.save;
  let delayed = false;
  prefs.adapter.save = async value => {
    if (!delayed && value.pending && !value.pending.generationId) {
      delayed = true;
      entered.resolve();
      await release.promise;
    }
    await save(value);
  };
  const sending = store.send('not posted');
  await entered.promise;
  assert.deepEqual(store.getSnapshot().pending, { sessionId: 'A' });
  let reconnect: Promise<boolean> | undefined;
  if (interruption === 'reconnect') reconnect = store.connect();
  else store[interruption]();
  release.resolve();
  assert.equal(await sending, 'blocked');
  if (reconnect) await reconnect;
  // Drain the adapter's queued cleanup before reconstructing a separate store.
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(h.calls.some(call => call.init.method === 'POST'), false);
  assert.equal(store.getSnapshot().pending, null);
  assert.equal((prefs.read() as MobilePreferences).pending, undefined);
  if (interruption !== 'dispose') {
    assert.equal(await store.resume(), true);
    assert.equal(store.getSnapshot().pending, null);
    assert.notEqual(store.getSnapshot().views.A.status, 'unknown');
    store.dispose();
  }
  const restored = makeStore();
  assert.equal(await restored.connect(), true);
  assert.equal(restored.getSnapshot().pending, null);
  assert.equal(await restored.send('explicit new send'), 'completed');
  assert.equal(h.calls.filter(call => call.init.method === 'POST').length, 1);
  restored.dispose();
});

test('late unposted save continuation cannot erase a newer same-session pending marker', async () => {
  const { store, h, prefs } = harness(); await store.connect();
  const entered = deferred<void>(); const release = deferred<void>();
  const save = prefs.adapter.save; let delayed = false;
  prefs.adapter.save = async value => {
    if (!delayed && value.pending && !value.pending.generationId) {
      delayed = true; entered.resolve(); await release.promise;
    }
    await save(value);
  };
  const old = store.send('old'); await entered.promise;
  store.suspend();
  h.send = async () => stream([event('generation_started', { status: 'running' }, 'A', 'new-generation')]);
  const newStarted = deferred<void>(); let next: Promise<string> | undefined;
  const unsubscribe = store.subscribe(() => {
    if (store.getSnapshot().connection === 'ready' && !next) {
      next = store.send('new'); newStarted.resolve();
    }
  });
  const resumed = store.resume();
  await newStarted.promise;
  release.resolve();
  assert.equal(await old, 'blocked');
  await resumed;
  assert.equal(await next, 'unknown');
  assert.deepEqual(store.getSnapshot().pending, { sessionId: 'A', generationId: 'new-generation' });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual((prefs.read() as MobilePreferences).pending, { sessionId: 'A', generationId: 'new-generation' });
  assert.equal(h.calls.filter(call => call.path === '/api/chat/send').length, 1);
  unsubscribe(); store.dispose();
});

test('backgrounding a posted request before its first event preserves the session-only marker', async () => {
  const { store, h, prefs } = harness(); await store.connect();
  const posted = deferred<void>(); const response = deferred<Response>();
  h.send = () => { posted.resolve(); return response.promise; };
  const sending = store.send('posted'); await posted.promise;
  store.suspend();
  assert.equal(await sending, 'unknown');
  response.resolve(stream([]));
  assert.equal(await store.resume(), true);
  assert.deepEqual(store.getSnapshot().pending, { sessionId: 'A' });
  assert.deepEqual((prefs.read() as MobilePreferences).pending, { sessionId: 'A' });
  assert.equal(store.getSnapshot().views.A.status, 'unknown');
  assert.equal(h.calls.filter(call => call.init.method === 'POST').length, 1);
  store.dispose();
});
