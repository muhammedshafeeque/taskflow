import crypto from 'crypto';
import type { AuthTokens } from './auth.service';

type Entry = {
  tokens: AuthTokens;
  userType: string;
  expiresAt: number;
};

const store = new Map<string, Entry>();
const TTL_MS = 2 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of store) {
    if (v.expiresAt <= now) store.delete(k);
  }
}, 60_000).unref?.();

export function issueOAuthExchangeCode(
  tokens: AuthTokens,
  userType: string
): string {
  const code = crypto.randomBytes(32).toString('hex');
  store.set(code, {
    tokens,
    userType,
    expiresAt: Date.now() + TTL_MS,
  });
  return code;
}

export function consumeOAuthExchangeCode(code: string): AuthTokens | null {
  const entry = store.get(code);
  if (!entry) return null;
  store.delete(code);
  if (entry.expiresAt <= Date.now()) return null;
  return entry.tokens;
}
