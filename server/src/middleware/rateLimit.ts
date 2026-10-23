import type { NextFunction, Request, Response } from 'express';

/**
 * Small in-memory fixed-window limiter (per process). Good enough to stop
 * brute force on a single instance; put a shared limiter (e.g. at the proxy)
 * in front when running several API instances.
 *
 * Limits are configurable: RATE_LIMIT_<NAME>=<max>/<windowSeconds>, e.g. RATE_LIMIT_AUTH=10/60.
 */
type Bucket = { count: number; resetAt: number };

export function rateLimit(name: string, defaults: { max: number; windowSec: number }, keyFn?: (req: Request) => string) {
  const raw = process.env[`RATE_LIMIT_${name.toUpperCase()}`]?.trim();
  const [maxStr, winStr] = raw ? raw.split('/') : [];
  const max = Number(maxStr) || defaults.max;
  const windowMs = (Number(winStr) || defaults.windowSec) * 1000;
  const buckets = new Map<string, Bucket>();

  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  }, Math.max(windowMs, 30_000)).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (process.env.RATE_LIMIT_DISABLED === 'true') return next();
    const key = `${keyFn ? keyFn(req) : ''}|${req.ip ?? 'unknown'}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - b.count)));
    if (b.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
      res.status(429).json({ success: false, message: 'Too many requests — please wait and try again.' });
      return;
    }
    next();
  };
}

/** Login, signup, password reset — keyed by IP + submitted email. */
export const authLimiter = rateLimit('auth', { max: 10, windowSec: 60 }, (req) =>
  String((req.body as { email?: unknown } | undefined)?.email ?? '').toLowerCase()
);
/** Unauthenticated public pages (e-signature links, status pages). */
export const publicLimiter = rateLimit('public', { max: 60, windowSec: 60 });
/** Telemetry ingest — generous, but stops a runaway client. */
export const ingestLimiter = rateLimit('ingest', { max: 1200, windowSec: 60 }, (req) => String(req.headers['x-monitor-key'] ?? ''));
/** PA / service-desk shared-secret ingest — slows secret brute-force. */
export const paIngestLimiter = rateLimit('pa_ingest', { max: 120, windowSec: 60 }, (req) =>
  String(req.headers['x-pa-ingest-secret'] ?? '').slice(0, 16)
);
