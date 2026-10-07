import { APP_VERSION } from '../appVersion';

/**
 * Browser self-reporting is OFF unless explicitly enabled.
 * VITE_MONITOR_KEY is always public in the SPA bundle — treat it as untrusted.
 * Prefer server-side MONITOR_KEY for production telemetry.
 */
const MONITOR_ENABLED = String(import.meta.env.VITE_MONITOR_ENABLED || '').toLowerCase() === 'true';
const MONITOR_BASE = String(
  import.meta.env.VITE_MONITOR_BASE_URL || ''
).replace(/\/+$/, '');
const MONITOR_KEY = String(import.meta.env.VITE_MONITOR_KEY || '').trim();
const RELEASE = String(import.meta.env.VITE_MONITOR_RELEASE || APP_VERSION || '').trim();

export function isMonitorClientEnabled() {
  return Boolean(MONITOR_ENABLED && MONITOR_BASE && MONITOR_KEY);
}

export function skipClientHttp(url: string) {
  const u = url.toLowerCase();
  if (u.includes('/monitor/ingest/')) return true;
  if (u.includes('/notifications/unread-count')) return true;
  if (u.includes('/inbox/unread-count')) return true;
  if (u.includes('/monitor/projects')) return true;
  if (u.includes('/auth/me')) return true;
  if (u.includes('/core/modules')) return true;
  return false;
}

export function isMonitorIngestUrl(url: string) {
  return url.includes('/monitor/ingest/');
}

export function monitorIngest(kind: string, body: Record<string, unknown>) {
  if (!isMonitorClientEnabled()) return;
  const payload = { release: RELEASE || undefined, ...body };
  void fetch(`${MONITOR_BASE}/monitor/ingest/${kind}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Monitor-Key': MONITOR_KEY,
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {
    /* never throw into the app */
  });
}

export function monitorLog(message: string, level = 'info', meta?: Record<string, unknown>) {
  monitorIngest('logs', { message, level, meta });
}

export function monitorError(err: unknown, kind: 'unhandled' | 'crash' = 'unhandled') {
  const e = err instanceof Error ? err : new Error(String(err));
  monitorIngest('errors', {
    message: e.message,
    type: e.name || 'Error',
    stack: e.stack,
    kind,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  });
}

export function monitorHttp(input: {
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
}) {
  if (skipClientHttp(input.url)) return;
  // Only report failures from the browser — reduces key-abuse noise if key leaks
  if ((input.status ?? 0) < 400 && (input.durationMs ?? 0) < 3000) return;
  monitorIngest('http', { ...input, direction: 'out' });
}

export function monitorVital(name: 'lcp' | 'inp' | 'cls' | 'ttfb', value: number) {
  monitorIngest('vitals', { name, value });
}

export function monitorPresence(sessionId: string, page: string, userId?: string) {
  monitorIngest('presence', {
    sessionId,
    page,
    userId,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
  });
}

export function monitorReleaseOnce() {
  if (!RELEASE) return;
  const flag = `monitor_release_${RELEASE}`;
  try {
    if (sessionStorage.getItem(flag)) return;
    sessionStorage.setItem(flag, '1');
  } catch {
    /* ignore */
  }
  monitorIngest('releases', { version: RELEASE });
}

export function monitorSessionId() {
  const key = 'monitor_session_id';
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return 'sess_anon';
  }
}
