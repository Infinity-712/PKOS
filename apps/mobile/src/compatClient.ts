import { AgentApiClient, isRecord, type ProviderStatusResponse, type RuntimeInfoResponse } from '@pkos/agent-client';

export type CompatScenario = 'normal' | 'failed' | 'truncated' | 'disconnect' | 'slow';
export type CompatFixture = { mode: 'synthetic'; fixtureVersion: '1'; fixtureId: string };
declare const __COMPAT_PORT__: string | number | undefined;
export const DEFAULT_BASE_URL = normalizeBaseUrl(`http://127.0.0.1:${typeof __COMPAT_PORT__ === 'undefined' ? 18790 : __COMPAT_PORT__}`);
export const COMPAT_SCENARIOS: readonly CompatScenario[] = ['normal', 'failed', 'truncated', 'disconnect', 'slow'];
const REQUIRED_CAPABILITIES = ['runtime-info.v1', 'chat.sessions.read', 'chat.messages.read', 'chat.send.readonly', 'provider.status.read'];

export class CompatError extends Error {
  constructor(readonly code: string) { super(code); }
}

export function normalizeBaseUrl(value: string): string {
  const match = /^http:\/\/127\.0\.0\.1:([0-9]{4,5})\/?$/.exec(value.trim());
  const port = match ? Number(match[1]) : 0;
  if (port < 1024 || port > 65535 || port === 8790) throw new CompatError('unsafe_base_url');
  return `http://127.0.0.1:${port}`;
}

export function createCompatClient(baseUrl: string, fetchImpl: typeof fetch, scenario: CompatScenario = 'normal') {
  const origin = normalizeBaseUrl(baseUrl);
  const safeFetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin !== origin || url.username || url.password) throw new CompatError('unsafe_endpoint');
    const headers = new Headers();
    if (init.method === 'POST') headers.set('Content-Type', 'application/json');
    if (url.pathname === '/api/chat/send') headers.set('X-PKOS-Compat-Scenario', scenario);
    const response = await fetchWithAbort(fetchImpl, url.href, { ...init, headers, credentials: 'omit', redirect: 'error' });
    if (response.redirected || (response.url && new URL(response.url).origin !== origin)) throw new CompatError('unexpected_redirect');
    // Native fetch honors AbortSignal, but injected/WebView streams may not cancel a pending read.
    if (url.pathname === '/api/chat/send' && response.body && response.ok && init.signal) {
      return cancellableResponse(response, init.signal);
    }
    return response;
  };
  const client = new AgentApiClient({ baseUrl: origin, fetchImpl: safeFetch });
  return {
    client,
    async verify(signal?: AbortSignal): Promise<{ fixture: CompatFixture; runtime: RuntimeInfoResponse; provider: ProviderStatusResponse }> {
      const response = await safeFetch(`${origin}/__mobile_compat__/info`, { method: 'GET', signal });
      if (!response.ok) throw new CompatError('invalid_fixture');
      const value: unknown = await response.json();
      if (!isRecord(value) || value.mode !== 'synthetic' || value.fixtureVersion !== '1' || typeof value.fixtureId !== 'string' || !value.fixtureId.trim() || value.fixtureId.length > 256) throw new CompatError('invalid_fixture');
      const fixture: CompatFixture = { mode: 'synthetic', fixtureVersion: '1', fixtureId: value.fixtureId };
      const runtime = await client.getRuntimeInfo(signal);
      if (runtime.service.version !== '0.7-service-identity' || runtime.service.apiContractVersion !== '0.7' || !REQUIRED_CAPABILITIES.every(capability => runtime.service.capabilities.includes(capability))) throw new CompatError('incompatible_service');
      if (!runtime.database.exists || !runtime.database.compatible || !Number.isInteger(runtime.database.schemaVersion) || runtime.database.schemaVersion !== runtime.database.requiredSchemaVersion) throw new CompatError('incompatible_database');
      const provider = await client.getProviderStatus(signal);
      // Non-external profiles report keyConfigured=true when no key is required.
      if (runtime.provider.profileId !== 'dry-run' || provider.selection.profileId !== 'dry-run' || provider.selection.providerId !== 'dry-run'
        || provider.selection.external !== false || provider.selection.protocol !== 'dry-run' || provider.provider !== 'dry-run'
        || provider.dataEgress !== 'none' || provider.consentRequired || provider.toolsEnabled !== false
        || provider.capabilities.toolCallingEnabled !== false || provider.readOnly !== true) throw new CompatError('unsafe_provider');
      return { fixture, runtime, provider };
    },
  };
}

function fetchWithAbort(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const signal = init.signal;
  if (!signal) return fetchImpl(url, init);
  if (signal.aborted) return Promise.reject(new CompatError('local_abort'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      settled = true;
      signal.removeEventListener('abort', onAbort);
      reject(new CompatError('local_abort'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void Promise.resolve().then(() => {
      if (signal.aborted) throw new CompatError('local_abort');
      return fetchImpl(url, init);
    }).then(response => {
      signal.removeEventListener('abort', onAbort);
      if (settled) { void response.body?.cancel().catch(() => {}); return; }
      settled = true;
      resolve(response);
    }, error => {
      signal.removeEventListener('abort', onAbort);
      if (!settled) { settled = true; reject(error); }
    });
  });
}

function cancellableResponse(response: Response, signal: AbortSignal): Response {
  const reader = response.body!.getReader();
  let closed = false;
  let onAbort: () => void;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      onAbort = () => {
        if (closed) return;
        closed = true;
        signal.removeEventListener('abort', onAbort);
        controller.error(new CompatError('local_abort'));
        void reader.cancel().catch(() => {});
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    },
    async pull(controller) {
      try {
        const result = await reader.read();
        if (closed) return;
        if (result.done) {
          closed = true;
          signal.removeEventListener('abort', onAbort);
          reader.releaseLock();
          controller.close();
        } else controller.enqueue(result.value);
      } catch (error) {
        if (!closed) {
          closed = true;
          signal.removeEventListener('abort', onAbort);
          controller.error(error);
          void reader.cancel().catch(() => {});
        }
      }
    },
    cancel() {
      closed = true;
      signal.removeEventListener('abort', onAbort);
      return reader.cancel();
    },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}
