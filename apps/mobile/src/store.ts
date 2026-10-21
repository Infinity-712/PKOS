import { isRecord, type AgentEvent, type ChatSession, type ProviderStatusResponse, type RuntimeInfoResponse } from '@pkos/agent-client';
import { COMPAT_SCENARIOS, CompatError, DEFAULT_BASE_URL, createCompatClient, normalizeBaseUrl, type CompatFixture, type CompatScenario } from './compatClient.js';
import { projectPreferences, type Language, type PendingMarker, type PreferenceAdapter } from './preferences.js';

export const UNKNOWN_RESULT_CODE = 'result_unverified';
export type ViewStatus = 'idle' | 'loading' | 'sending' | 'streaming' | 'completed' | 'failed' | 'aborted' | 'unknown';
export type SendStatus = 'completed' | 'failed' | 'aborted' | 'unknown' | 'blocked' | 'busy';
export type MobileMessage = {
  id: string; role: 'user' | 'assistant'; content: string; generationId: string | null;
  status: ViewStatus; createdAt: string; updatedAt: string;
};
export type SessionView = { messages: MobileMessage[]; status: ViewStatus; error: string | null };
export type MobileSnapshot = {
  connection: 'disconnected' | 'connecting' | 'ready' | 'error' | 'suspended';
  baseUrl: string; locale: Language; error: string | null;
  runtime: RuntimeInfoResponse | null; provider: ProviderStatusResponse | null;
  fixture: CompatFixture | null; fixtureChanged: boolean;
  sessions: ChatSession[]; selectedId: string | null;
  views: Record<string, SessionView>; pending: PendingMarker | null;
};
export interface MobileStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): MobileSnapshot;
  connect(baseUrl?: string): Promise<boolean>;
  resume(): Promise<boolean>;
  selectSession(id: string): Promise<void>;
  createSession(title?: string): Promise<string | null>;
  send(text: string, scenario?: CompatScenario): Promise<SendStatus>;
  stop(): Promise<void>;
  suspend(): void;
  setLanguage(language: Language): void;
  dispose(): void;
}
export type MobileStoreOptions = { fetch?: typeof fetch; preferences: PreferenceAdapter; abortTimeoutMs?: number };
export function canSubmit(text: string, composing: boolean, busy = false): boolean { return Boolean(text.trim()) && !composing && !busy; }
export function shouldSendOnEnter(_event?: unknown): false { return false; }
type ActiveSend = {
  epoch: number; sequence: number; sessionId: string; controller: AbortController;
  assistantId: string; generationId?: string; posted: boolean; terminal: boolean;
  result: SendStatus; seen: Set<string>;
};
const MAX_VIEWS = 32;
const MAX_MESSAGES = 400;
const EMPTY_VIEW: SessionView = { messages: [], status: 'idle', error: null };

export function createMobileStore(options: MobileStoreOptions): MobileStore {
  let snapshot: MobileSnapshot = { connection: 'disconnected', baseUrl: DEFAULT_BASE_URL, locale: 'zh', error: null, runtime: null, provider: null, fixture: null, fixtureChanged: false, sessions: [], selectedId: null, views: {}, pending: null };
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const listeners = new Set<() => void>();
  const controllers = new Set<AbortController>();
  const historySequences = new Map<string, number>();
  let epoch = 0;
  let sequence = 0;
  let disposed = false;
  let active: ActiveSend | null = null;
  let storedFixtureId: string | null = null;
  let loaded: Promise<void> | undefined;
  let saves: Promise<boolean> = Promise.resolve(true);

  function patch(change: Partial<MobileSnapshot>) {
    if (disposed) return;
    snapshot = { ...snapshot, ...change };
    for (const listener of listeners) listener();
  }
  function view(id: string, change: Partial<SessionView>) {
    const views = { ...snapshot.views, [id]: { ...(snapshot.views[id] ?? EMPTY_VIEW), ...change } };
    const keys = Object.keys(views);
    for (const key of keys) {
      if (Object.keys(views).length <= MAX_VIEWS) break;
      if (key !== id && key !== snapshot.selectedId && key !== snapshot.pending?.sessionId && key !== active?.sessionId) {
        delete views[key];
        historySequences.delete(key);
      }
    }
    patch({ views });
  }
  function persist(): Promise<boolean> {
    const projected = projectPreferences({ language: snapshot.locale, baseUrl: snapshot.baseUrl,
      fixtureId: storedFixtureId, lastSessionId: snapshot.selectedId, pending: snapshot.pending });
    saves = saves.then(async () => {
      try { await options.preferences.save(projected); return true; }
      catch { patch({ error: 'preferences_unavailable' }); return false; }
    });
    return saves;
  }
  function load() {
    return loaded ??= (async () => {
      try {
        const value = projectPreferences(await options.preferences.load());
        if (disposed) return;
        storedFixtureId = value.fixtureId;
        patch({ baseUrl: value.baseUrl, locale: value.language, selectedId: value.lastSessionId, pending: value.pending ?? null });
      } catch { patch({ error: 'preferences_unavailable' }); }
    })();
  }
  const current = (request: ActiveSend) => !disposed && active === request && request.epoch === epoch;
  function settle(request: ActiveSend, status: 'completed' | 'failed' | 'aborted' | 'unknown') {
    if (!current(request)) return;
    request.result = status;
    request.terminal = status !== 'unknown';
    const messages = (snapshot.views[request.sessionId]?.messages ?? []).map(message => message.id === request.assistantId ? { ...message, status, updatedAt: new Date().toISOString() } : message);
    view(request.sessionId, { messages, status, error: status === 'unknown' ? UNKNOWN_RESULT_CODE : status === 'failed' ? 'generation_failed' : null });
    if (request.terminal && snapshot.pending?.sessionId === request.sessionId && (!snapshot.pending.generationId || snapshot.pending.generationId === request.generationId)) {
      patch({ pending: null });
      void persist();
    }
  }
  function invalidate() {
    const request = active;
    if (request) {
      if (request.posted && !request.terminal) settle(request, 'unknown');
      if (!request.posted && current(request) && snapshot.pending?.sessionId === request.sessionId && snapshot.pending.generationId === undefined) {
        patch({ pending: null });
        // Queue after the in-flight save so an unsent recovery marker cannot survive it.
        void persist();
      }
      request.controller.abort();
      if (active === request) active = null;
    }
    epoch++;
    for (const controller of controllers) controller.abort();
    controllers.clear();
    historySequences.clear();
  }
  function acceptIdentity(identity: Awaited<ReturnType<ReturnType<typeof createCompatClient>['verify']>>, baseUrl: string) {
    const changed = storedFixtureId !== null && (storedFixtureId !== identity.fixture.fixtureId || snapshot.baseUrl !== baseUrl);
    storedFixtureId = identity.fixture.fixtureId;
    patch({ ...identity, baseUrl, fixtureChanged: changed,
      ...(changed ? { views: {}, pending: null, selectedId: null, sessions: [] } : {}) });
    return changed;
  }
  async function history(id: string, atEpoch: number) {
    const seq = ++sequence;
    historySequences.set(id, seq);
    const controller = new AbortController(); controllers.add(controller);
    const prior = snapshot.views[id] ?? EMPTY_VIEW;
    view(id, { status: active?.sessionId === id ? prior.status : 'loading', error: null });
    try {
      const response = await createCompatClient(snapshot.baseUrl, fetchImpl).client.getSessionMessages(id, { limit: 200 }, controller.signal);
      if (disposed || atEpoch !== epoch || historySequences.get(id) !== seq) return;
      if (response.sessionId !== id) throw new CompatError('history_session_mismatch');
      const pending = snapshot.pending?.sessionId === id ? snapshot.pending : null;
      const confirmed = pending?.generationId ? response.items.find(item => item.role === 'assistant' && item.generationId === pending.generationId) : undefined;
      if (confirmed && active?.sessionId !== id) { patch({ pending: null }); void persist(); }
      // Server IDs deduplicate saved history; local partials survive only while unresolved/active.
      const unresolved = snapshot.pending?.sessionId === id;
      const previous = snapshot.views[id]?.messages ?? [];
      const merged = new Map<string, MobileMessage>();
      for (const item of previous) if (!item.id.startsWith('local:')) merged.set(item.id, item);
      for (const item of response.items) merged.set(item.id, item);
      for (const item of previous) {
        if (!item.id.startsWith('local:')) continue;
        const saved = item.generationId && response.items.some(server => server.role === item.role && server.generationId === item.generationId);
        if (!saved && item.role === 'assistant' && (unresolved || active?.sessionId === id || item.status === 'failed' || item.status === 'aborted')) merged.set(item.id, item);
        if (item.role === 'user' && active?.sessionId === id && !active.terminal) merged.set(item.id, item);
      }
      const status = active?.sessionId === id ? (snapshot.views[id]?.status ?? 'streaming') : unresolved ? 'unknown' : confirmed?.status ?? 'idle';
      view(id, { messages: [...merged.values()].slice(-MAX_MESSAGES), status, error: unresolved && active?.sessionId !== id ? UNKNOWN_RESULT_CODE : null });
    } catch {
      if (!disposed && atEpoch === epoch && historySequences.get(id) === seq) {
        const unresolved = snapshot.pending?.sessionId === id;
        const terminal = active?.sessionId === id && active.terminal;
        view(id, { status: terminal ? snapshot.views[id].status : unresolved ? 'unknown' : 'failed', error: unresolved ? UNKNOWN_RESULT_CODE : 'history_unavailable' });
      }
    } finally { controllers.delete(controller); }
  }
  async function connect(baseUrl?: string): Promise<boolean> {
    if (disposed) return false;
    invalidate();
    const atEpoch = epoch;
    patch({ connection: 'connecting', error: null });
    await load();
    if (disposed || atEpoch !== epoch) return false;
    const controller = new AbortController(); controllers.add(controller);
    try {
      const base = normalizeBaseUrl(baseUrl ?? snapshot.baseUrl);
      const compat = createCompatClient(base, fetchImpl);
      const identity = await compat.verify(controller.signal);
      if (disposed || atEpoch !== epoch) return false;
      acceptIdentity(identity, base);
      const response = await compat.client.listChatSessions(controller.signal);
      if (disposed || atEpoch !== epoch) return false;
      const selectedId = response.sessions.some(session => session.id === snapshot.selectedId) ? snapshot.selectedId : response.sessions[0]?.id ?? null;
      patch({ sessions: response.sessions, selectedId });
      if (selectedId) await history(selectedId, atEpoch);
      if (disposed || atEpoch !== epoch) return false;
      patch({ connection: 'ready' });
      await persist();
      return true;
    } catch (error) {
      if (!disposed && atEpoch === epoch) patch({ connection: 'error', runtime: null, provider: null, error: error instanceof CompatError ? error.code : 'connection_failed' });
      return false;
    } finally { controllers.delete(controller); }
  }
  async function selectSession(id: string) {
    if (disposed || snapshot.connection !== 'ready' || !snapshot.sessions.some(session => session.id === id)) return;
    patch({ selectedId: id }); void persist();
    await history(id, epoch);
  }
  async function createSession(_title?: string): Promise<string | null> {
    patch({ error: 'session_create_unsupported' });
    return null;
  }
  function applyEvent(request: ActiveSend, event: AgentEvent) {
    if (event.sessionId !== request.sessionId || !event.generationId || !isRecord(event.payload)) throw new CompatError('invalid_stream');
    if (request.generationId && request.generationId !== event.generationId) throw new CompatError('invalid_stream');
    if (request.seen.has(event.id)) return;
    if (request.seen.size >= 4096) throw new CompatError('stream_limit');
    request.seen.add(event.id);
    if (event.type === 'generation_started') {
      if (request.generationId || event.payload.status !== 'running') throw new CompatError('invalid_stream');
      request.generationId = event.generationId;
      patch({ pending: { sessionId: request.sessionId, generationId: request.generationId } }); void persist();
      view(request.sessionId, { status: 'streaming' });
    } else if (!request.generationId) throw new CompatError('invalid_stream');
    else if (event.type === 'content_delta') {
      if (typeof event.payload.delta !== 'string') throw new CompatError('invalid_stream');
      const delta = event.payload.delta;
      const messages = snapshot.views[request.sessionId]?.messages ?? [];
      const existing = messages.find(message => message.id === request.assistantId);
      const content = (existing?.content ?? '') + delta;
      if (content.length > 1_000_000) throw new CompatError('stream_limit');
      const now = new Date().toISOString();
      const next: MobileMessage = { id: request.assistantId, role: 'assistant', content, generationId: request.generationId, status: 'streaming', createdAt: existing?.createdAt ?? now, updatedAt: now };
      view(request.sessionId, { messages: (existing ? messages.map(message => message.id === next.id ? next : message) : [...messages, next]).slice(-MAX_MESSAGES), status: 'streaming' });
    } else if (event.type === 'context_built') {
      if (event.payload.external === true) throw new CompatError('unsafe_provider');
    } else if (event.type === 'generation_completed') {
      if (event.payload.status !== 'completed' || typeof event.payload.contentLength !== 'number' || !Number.isInteger(event.payload.contentLength) || event.payload.contentLength < 0) throw new CompatError('invalid_terminal');
      settle(request, 'completed');
    } else if (event.type === 'generation_failed') {
      if (typeof event.payload.code !== 'string' || !event.payload.code.trim()) throw new CompatError('invalid_terminal');
      settle(request, 'failed');
    } else if (event.type === 'generation_aborted') {
      if (typeof event.payload.reason !== 'string' || !event.payload.reason.trim()) throw new CompatError('invalid_terminal');
      settle(request, 'aborted');
    } else throw new CompatError('unexpected_stream_event');
  }
  async function send(text: string, scenario: CompatScenario = 'normal'): Promise<SendStatus> {
    if (active) return 'busy';
    if (disposed || snapshot.connection !== 'ready' || !snapshot.selectedId || snapshot.pending || !canSubmit(text, false) || !COMPAT_SCENARIOS.includes(scenario)) return 'blocked';
    const request: ActiveSend = { epoch, sequence: ++sequence, sessionId: snapshot.selectedId, controller: new AbortController(), assistantId: `local:assistant:${sequence}`, posted: false, terminal: false, result: 'unknown', seen: new Set() };
    active = request;
    try {
      const compat = createCompatClient(snapshot.baseUrl, fetchImpl, scenario);
      const identity = await compat.verify(request.controller.signal);
      if (!current(request) || request.controller.signal.aborted) return 'blocked';
      if (identity.fixture.fixtureId !== snapshot.fixture?.fixtureId) {
        invalidate(); acceptIdentity(identity, snapshot.baseUrl); patch({ connection: 'disconnected' }); void persist(); return 'blocked';
      }
      patch({ runtime: identity.runtime, provider: identity.provider, pending: { sessionId: request.sessionId } });
      if (!await persist() || !current(request) || request.controller.signal.aborted) {
        if (current(request)) { patch({ pending: null }); void persist(); }
        return 'blocked';
      }
      historySequences.set(request.sessionId, ++sequence);
      const now = new Date().toISOString();
      const user: MobileMessage = { id: `local:user:${request.sequence}`, role: 'user', content: text, generationId: null, status: 'completed', createdAt: now, updatedAt: now };
      view(request.sessionId, { messages: [...(snapshot.views[request.sessionId]?.messages ?? []), user].slice(-MAX_MESSAGES), status: 'sending', error: null });
      request.posted = true;
      for await (const event of compat.client.sendChatMessage({ sessionId: request.sessionId, message: scenario === 'failed' ? `[compat:failed] ${text}` : text, allowExternalProvider: false }, request.controller.signal)) {
        if (!current(request) || request.terminal) break;
        applyEvent(request, event);
        if (request.terminal) break;
      }
      if (current(request) && !request.terminal) settle(request, 'unknown');
      return request.result;
    } catch (error) {
      if (current(request)) {
        if (request.posted) { if (!request.terminal) settle(request, 'unknown'); }
        else {
          request.result = 'blocked';
          if (!request.controller.signal.aborted) patch({ connection: 'error', error: error instanceof CompatError ? error.code : 'connection_failed' });
        }
      }
      return request.result;
    } finally {
      request.controller.abort(); request.seen.clear();
      if (current(request) && request.terminal) await history(request.sessionId, request.epoch);
      if (active === request) active = null;
    }
  }
  async function stop() {
    const request = active;
    if (!request || disposed) return;
    if (request.generationId && !request.terminal) {
      const controller = new AbortController(); controllers.add(controller);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, Math.max(1, Math.min(options.abortTimeoutMs ?? 1500, 5000))); });
        const response = await Promise.race([createCompatClient(snapshot.baseUrl, fetchImpl).client.abortGeneration(request.generationId, controller.signal).catch(() => null), timeout]);
        if (current(request) && !request.terminal && response?.ok && response.generationId === request.generationId && response.status !== 'running') settle(request, response.status);
      } finally { clearTimeout(timer); controller.abort(); controllers.delete(controller); }
    }
    if (current(request)) {
      if (request.posted && !request.terminal) settle(request, 'unknown');
      request.controller.abort();
    }
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { if (disposed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect, resume: () => connect(), selectSession, createSession, send, stop,
    suspend() { if (!disposed) { invalidate(); patch({ connection: 'suspended' }); } },
    setLanguage(language) { if (!disposed && (language === 'zh' || language === 'en')) { patch({ locale: language }); void persist(); } },
    dispose() { if (!disposed) { invalidate(); disposed = true; listeners.clear(); } },
  };
}
