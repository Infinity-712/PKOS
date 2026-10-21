export type Language = 'zh' | 'en';
export type PendingMarker = { sessionId: string; generationId?: string };
export type MobilePreferences = {
  language: Language;
  baseUrl: string;
  fixtureId: string | null;
  lastSessionId: string | null;
  pending?: PendingMarker;
};
export interface PreferenceAdapter {
  load(): Promise<unknown>;
  save(value: MobilePreferences): Promise<void>;
}
export function projectPreferences(value: unknown): MobilePreferences {
  const source = isRecord(value) ? value : {};
  let baseUrl = DEFAULT_BASE_URL;
  let validBase = typeof source.baseUrl === 'string';
  try { if (validBase) baseUrl = normalizeBaseUrl(source.baseUrl as string); } catch { validBase = false; }
  const fixtureId = validBase ? identifier(source.fixtureId) : null;
  const pending = isRecord(source.pending) && fixtureId && identifier(source.pending.sessionId)
    ? { sessionId: identifier(source.pending.sessionId)!, ...(identifier(source.pending.generationId) ? { generationId: identifier(source.pending.generationId)! } : {}) }
    : undefined;
  return { language: source.language === 'en' ? 'en' : 'zh', baseUrl, fixtureId,
    lastSessionId: validBase ? identifier(source.lastSessionId) : null, ...(pending ? { pending } : {}) };
}

function identifier(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 256 ? value : null;
}
import { isRecord } from '@pkos/agent-client';
import { DEFAULT_BASE_URL, normalizeBaseUrl } from './compatClient.js';
