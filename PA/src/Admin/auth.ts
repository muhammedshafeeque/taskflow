import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Admin API auth. Two ways in:
 *  1. `x-pa-admin-secret` — the shared secret (legacy; full access).
 *  2. `Authorization: Bearer <Atrium token>` — a personal API token (atr_…) or an
 *     Atrium session JWT. PA asks
 *     Atrium who it belongs to and allows it only if that user holds the
 *     permission in PA_ADMIN_PERMISSION (default: taskflow.service.ticket.update)
 *     or is listed in PA_ADMIN_EMAILS. Results are cached for 5 minutes.
 */
const TOKEN_CACHE_MS = 5 * 60 * 1000;
const tokenCache = new Map<string, { at: number; ok: boolean; email?: string }>();

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

async function verifyAtriumToken(token: string): Promise<{ ok: boolean; email?: string }> {
  const key = crypto.createHash('sha256').update(token).digest('hex');
  const hit = tokenCache.get(key);
  if (hit && Date.now() - hit.at < TOKEN_CACHE_MS) return hit;

  const base = process.env.TASKFLOW_API_URL?.trim().replace(/\/$/, '');
  if (!base) return { ok: false };
  let result: { ok: boolean; email?: string } = { ok: false };
  try {
    const res = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const json = (await res.json()) as { data?: { user?: { email?: string; permissions?: string[]; userType?: string } } };
      const user = json.data?.user;
      const required = process.env.PA_ADMIN_PERMISSION?.trim() || 'taskflow.service.ticket.update';
      const allowedEmails = (process.env.PA_ADMIN_EMAILS ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      const email = user?.email?.toLowerCase();
      const ok =
        user?.userType !== 'customer' &&
        Boolean(email) &&
        (allowedEmails.includes(email!) || (user?.permissions ?? []).includes(required));
      result = { ok, email };
    }
  } catch (err) {
    console.warn('Atrium token check failed', err instanceof Error ? err.message : err);
    // Don't cache transient failures.
    return { ok: false };
  }
  tokenCache.set(key, { ...result, at: Date.now() });
  if (tokenCache.size > 500) tokenCache.delete(tokenCache.keys().next().value as string);
  return result;
}

export function requireAdminSecret(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env.PA_ADMIN_SECRET?.trim();
  const provided = String(
    req.headers['x-pa-admin-secret'] ?? (typeof req.query.secret === 'string' ? req.query.secret : '') ?? ''
  ).trim();
  if (configured && provided && safeEqual(provided, configured)) {
    next();
    return;
  }

  const auth = req.headers.authorization;
  // Any Atrium credential works: a personal token (atr_…) or a signed-in session JWT
  // (e.g. from the VS Code extension). SSE clients can't set headers, so a personal
  // token may also arrive as ?secret=atr_…
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : provided.startsWith('atr_') ? provided : '';
  if (bearer) {
    void verifyAtriumToken(bearer).then((r) => {
      if (r.ok) {
        (req as Request & { adminEmail?: string }).adminEmail = r.email;
        next();
      } else {
        res.status(401).json({ success: false, error: 'This Atrium account is not allowed to administer PA' });
      }
    });
    return;
  }

  if (!configured) {
    res.status(503).json({ success: false, error: 'PA_ADMIN_SECRET is not configured' });
    return;
  }
  res.status(401).json({ success: false, error: 'Unauthorized' });
}
