import crypto from 'crypto';
import { env } from '../../config/env';
import { ApiError } from '../../utils/ApiError';

const stateStore = new Map<string, { redirectUri: string; expiresAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of stateStore) {
    if (v.expiresAt <= now) stateStore.delete(k);
  }
}, 60_000).unref?.();

/** Allowed Microsoft OAuth redirect URIs (configured + frontend login). */
export function allowedMicrosoftRedirectUris(): string[] {
  const list = new Set<string>();
  const add = (u?: string) => {
    const v = (u || '').trim().replace(/\/$/, '');
    if (v) list.add(v);
  };
  add(env.azureRedirectUri);
  add(env.frontendUrl);
  add(`${env.frontendUrl.replace(/\/$/, '')}/login`);
  add(env.appUrl);
  for (const extra of (process.env.AZURE_REDIRECT_URI_ALLOWLIST || '').split(',')) {
    add(extra);
  }
  return [...list];
}

export function assertAllowedMicrosoftRedirectUri(redirectUri: string): string {
  const normalized = redirectUri.trim();
  const allowed = allowedMicrosoftRedirectUris();
  const ok = allowed.some(
    (a) => a === normalized || a === normalized.replace(/\/$/, '')
  );
  if (!ok) {
    throw new ApiError(400, 'redirectUri is not allowlisted');
  }
  return normalized;
}

export function createMicrosoftOAuthState(redirectUri: string): string {
  const state = crypto.randomBytes(24).toString('hex');
  stateStore.set(state, {
    redirectUri,
    expiresAt: Date.now() + STATE_TTL_MS,
  });
  return state;
}

export function consumeMicrosoftOAuthState(state: string): string | null {
  const entry = stateStore.get(state);
  if (!entry) return null;
  stateStore.delete(state);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.redirectUri;
}
