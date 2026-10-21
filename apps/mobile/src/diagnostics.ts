export type Capability = { name: string; supported: boolean };

export function probeCapabilities(scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): Capability[] {
  return ['fetch', 'ReadableStream', 'TextDecoder', 'AbortController', 'URL', 'URLSearchParams', 'Promise', 'Headers', 'Response', 'Intl'].map(name => ({ name, supported: typeof scope[name] !== 'undefined' }));
}
