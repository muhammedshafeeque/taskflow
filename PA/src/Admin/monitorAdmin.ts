/**
 * Atrium Monitor bridge for the mobile Control Center:
 * - /monitor/projects/*  → transparent proxy to Taskflow /api/monitor/projects/*
 * - /monitor/feed        → cross-project health + alert inbox in one call
 * - /push/*              → Expo push token registry
 * - startMonitorAlertWatcher() pushes new alert deliveries, new errors and uptime outages.
 */
import { Router, type Request, type Response } from 'express';
import { MobilePushToken, MonitorWatchState } from '../Models/MobilePush';
import { taskflowMonitorRequest } from './taskflowContext';
import { sendExpoPush } from '../Push/expoPush';

type Json = Record<string, unknown>;

type MonitorProjectRow = { _id: string; name: string; key: string };

export type FeedAlert = {
  id: string;
  kind: 'delivery' | 'error' | 'uptime';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  body: string;
  projectId: string;
  projectName: string;
  at: string;
  ref?: string;
};

export type MonitorFeed = {
  available: boolean;
  reason?: string;
  generatedAt: string;
  projects: Array<{
    id: string;
    name: string;
    key: string;
    overview: Json | null;
    uptime: Array<{
      id: string;
      name: string;
      url: string;
      up: boolean | null;
      latencyMs?: number;
      okRate: number | null;
      samples: Array<{ ok: boolean; latencyMs?: number; at: string }>;
    }>;
  }>;
  alerts: FeedAlert[];
  totals: {
    openErrors: number;
    liveUsers: number;
    httpErrors: number;
    uptimeDown: number;
    alerts24h: number;
  };
};

function dataOf<T>(json: unknown, fallback: T): T {
  if (json && typeof json === 'object' && 'data' in (json as Json)) {
    return ((json as Json).data as T) ?? fallback;
  }
  return fallback;
}

async function tf<T>(path: string, fallback: T): Promise<T> {
  const { status, json } = await taskflowMonitorRequest(path);
  if (status >= 400) return fallback;
  return dataOf<T>(json, fallback);
}

const DAY = 24 * 60 * 60 * 1000;

type RawProject = {
  p: MonitorProjectRow;
  overview: Json | null;
  deliveries: Json[];
  errors: Json[];
  checks: Json[];
  samples: Json[];
};

function errorOf(json: unknown, status: number): string {
  const j = (json ?? {}) as Json;
  return String(j.error || j.message || `Atrium monitor unavailable (${status})`);
}

/** Preferred: one call to Taskflow /api/monitor/pa/summary. Returns null when not supported. */
async function loadViaSummary(): Promise<RawProject[] | { error: string } | null> {
  const { status, json } = await taskflowMonitorRequest('/summary');
  if (status === 404) return null; // older Taskflow or JWT mode — fall back to fan-out
  if (status >= 400) return { error: errorOf(json, status) };
  const data = dataOf<{ projects?: Array<Json> }>(json, {});
  return (data.projects ?? []).map((row) => ({
    p: { _id: String(row._id), name: String(row.name ?? ''), key: String(row.key ?? '') },
    overview: (row.overview as Json | null) ?? null,
    deliveries: (row.deliveries as Json[]) ?? [],
    errors: (row.errors as Json[]) ?? [],
    checks: (row.checks as Json[]) ?? [],
    samples: (row.samples as Json[]) ?? [],
  }));
}

async function loadViaFanOut(): Promise<RawProject[] | { error: string }> {
  const head = await taskflowMonitorRequest('/projects');
  if (head.status >= 400) return { error: errorOf(head.json, head.status) };
  const projects = dataOf<MonitorProjectRow[]>(head.json, []);
  return Promise.all(
    projects.map(async (p) => {
      const pid = encodeURIComponent(String(p._id));
      const [overview, deliveries, errors, checks, samples] = await Promise.all([
        tf<Json | null>(`/projects/${pid}/overview`, null),
        tf<Json[]>(`/projects/${pid}/alert-deliveries`, []),
        tf<Json[]>(`/projects/${pid}/errors?status=open&limit=20`, []),
        tf<Json[]>(`/projects/${pid}/uptime`, []),
        tf<Json[]>(`/projects/${pid}/uptime-samples`, []),
      ]);
      return { p, overview, deliveries, errors, checks, samples };
    })
  );
}

export async function buildMonitorFeed(): Promise<MonitorFeed> {
  const generatedAt = new Date().toISOString();
  const rows = (await loadViaSummary()) ?? (await loadViaFanOut());
  if (!Array.isArray(rows)) {
    return {
      available: false,
      reason: rows.error,
      generatedAt,
      projects: [],
      alerts: [],
      totals: { openErrors: 0, liveUsers: 0, httpErrors: 0, uptimeDown: 0, alerts24h: 0 },
    };
  }

  const alerts: FeedAlert[] = [];
  const outProjects: MonitorFeed['projects'] = [];
  const totals = { openErrors: 0, liveUsers: 0, httpErrors: 0, uptimeDown: 0, alerts24h: 0 };
  const since = Date.now() - DAY;

  for (const { p, overview, deliveries, errors, checks, samples } of rows) {
    const projectId = String(p._id);
    const projectName = p.name;
    totals.openErrors += Number(overview?.openErrors ?? 0);
    totals.liveUsers += Number(overview?.liveUsers ?? 0);
    totals.httpErrors += Number(overview?.httpErrors ?? 0);

    for (const d of deliveries.slice(0, 30)) {
      const at = String(d.timestamp || '');
      if (at && new Date(at).getTime() >= since) totals.alerts24h += 1;
      alerts.push({
        id: `d:${String(d._id)}`,
        kind: 'delivery',
        severity: d.ok === false ? 'warning' : severityForTrigger(String(d.trigger || '')),
        title: String(d.subject || d.trigger || 'Alert fired'),
        body: String(d.summary || (d.ok === false ? `Delivery failed: ${d.error || ''}` : '')),
        projectId,
        projectName,
        at,
        ref: String(d.ruleId || ''),
      });
    }

    for (const e of errors.slice(0, 15)) {
      alerts.push({
        id: `e:${String(e._id)}`,
        kind: 'error',
        severity: Number(e.count ?? 1) >= 10 ? 'critical' : 'warning',
        title: String(e.type || 'Error'),
        body: `${String(e.message || '').slice(0, 180)} · ${Number(e.count ?? 1)}×`,
        projectId,
        projectName,
        at: String(e.lastSeen || e.firstSeen || ''),
        ref: String(e._id),
      });
    }

    const uptime = checks.map((c) => {
      const mine = samples
        .filter((s) => String(s.checkId) === String(c._id))
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
      const latest = mine[0];
      const okCount = mine.filter((s) => s.ok).length;
      const up = latest ? Boolean(latest.ok) : null;
      if (up === false) {
        totals.uptimeDown += 1;
        alerts.push({
          id: `u:${String(c._id)}`,
          kind: 'uptime',
          severity: 'critical',
          title: `${String(c.name)} is down`,
          body: `${String(c.url)}${latest?.status ? ` · HTTP ${latest.status}` : ''}${
            latest?.error ? ` · ${String(latest.error).slice(0, 120)}` : ''
          }`,
          projectId,
          projectName,
          at: String(latest?.timestamp || ''),
          ref: String(c._id),
        });
      }
      return {
        id: String(c._id),
        name: String(c.name),
        url: String(c.url),
        up,
        latencyMs: latest?.latencyMs as number | undefined,
        okRate: mine.length ? okCount / mine.length : null,
        samples: mine
          .slice(0, 30)
          .reverse()
          .map((s) => ({
            ok: Boolean(s.ok),
            latencyMs: s.latencyMs as number | undefined,
            at: String(s.timestamp),
          })),
      };
    });

    outProjects.push({ id: projectId, name: projectName, key: p.key, overview, uptime });
  }

  alerts.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { available: true, generatedAt, projects: outProjects, alerts: alerts.slice(0, 150), totals };
}

function severityForTrigger(trigger: string): FeedAlert['severity'] {
  if (['uptime_down', 'error_spike', 'error_new'].includes(trigger)) return 'critical';
  if (['http_status', 'log_level', 'transaction_slow', 'vital_threshold'].includes(trigger)) return 'warning';
  return 'info';
}

/* ---------------------------------- routes --------------------------------- */

export const monitorAdminRouter = Router();

monitorAdminRouter.get('/feed', async (_req, res, next) => {
  try {
    res.json({ success: true, data: await buildMonitorFeed() });
  } catch (err) {
    next(err);
  }
});

const PROXY_METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);

async function proxy(req: Request, res: Response) {
  if (!PROXY_METHODS.has(req.method)) {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }
  const { status, json } = await taskflowMonitorRequest(`/projects${req.url === '/' ? '' : req.url}`, {
    method: req.method,
    body: req.method === 'GET' || req.method === 'DELETE' ? undefined : req.body ?? {},
  });
  res.status(status).json(json);
}

monitorAdminRouter.use('/projects', (req, res, next) => {
  proxy(req, res).catch(next);
});

export const pushAdminRouter = Router();

pushAdminRouter.post('/register', async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { token?: string; platform?: string; deviceName?: string; kinds?: string[] };
    const token = String(body.token || '').trim();
    if (!/^(Exponent|Expo)PushToken\[.+\]$/.test(token)) {
      res.status(400).json({ success: false, error: 'Invalid Expo push token' });
      return;
    }
    const doc = await MobilePushToken.findOneAndUpdate(
      { token },
      {
        $set: {
          platform: String(body.platform || 'android'),
          deviceName: String(body.deviceName || '').slice(0, 80),
          kinds: Array.isArray(body.kinds) ? body.kinds.map(String) : [],
          lastSeenAt: new Date(),
        },
      },
      { upsert: true, new: true }
    ).lean();
    res.json({ success: true, data: doc });
  } catch (err) {
    next(err);
  }
});

pushAdminRouter.post('/unregister', async (req, res, next) => {
  try {
    await MobilePushToken.deleteOne({ token: String(req.body?.token || '') });
    res.json({ success: true, data: { ok: true } });
  } catch (err) {
    next(err);
  }
});

pushAdminRouter.post('/test', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    const filter = token ? { token } : {};
    const tokens = (await MobilePushToken.find(filter).lean()).map((t) => t.token);
    const sent = await sendExpoPush(tokens, {
      title: 'PA Control · test alert',
      body: 'Push notifications are working.',
      data: { kind: 'test' },
    });
    res.json({ success: true, data: { sent } });
  } catch (err) {
    next(err);
  }
});

/* --------------------------------- watcher -------------------------------- */

let watcherTimer: ReturnType<typeof setInterval> | null = null;
let watcherRunning = false;

async function watchOnce() {
  if (watcherRunning) return;
  watcherRunning = true;
  try {
    const devices = await MobilePushToken.find().lean();
    if (!devices.length) return;

    const feed = await buildMonitorFeed();
    if (!feed.available) return;

    const state =
      (await MonitorWatchState.findOne({ key: 'default' })) ??
      (await MonitorWatchState.create({ key: 'default' }));
    const firstRun = !state.lastDeliveryAt && !state.lastErrorAt;
    const lastDelivery = state.lastDeliveryAt?.getTime() ?? Date.now();
    const lastError = state.lastErrorAt?.getTime() ?? Date.now();
    const prevDown = new Set(state.downCheckIds);

    const fresh: FeedAlert[] = [];
    let maxDelivery = lastDelivery;
    let maxError = lastError;
    const nowDown: string[] = [];

    for (const a of feed.alerts) {
      const t = a.at ? new Date(a.at).getTime() : 0;
      if (a.kind === 'delivery') {
        if (t > lastDelivery) fresh.push(a);
        maxDelivery = Math.max(maxDelivery, t);
      } else if (a.kind === 'error') {
        if (t > lastError) fresh.push(a);
        maxError = Math.max(maxError, t);
      } else if (a.kind === 'uptime' && a.ref) {
        nowDown.push(a.ref);
        if (!prevDown.has(a.ref)) fresh.push(a);
      }
    }

    // Recovery notices for checks that came back up.
    for (const p of feed.projects) {
      for (const u of p.uptime) {
        if (prevDown.has(u.id) && u.up === true) {
          fresh.push({
            id: `r:${u.id}`,
            kind: 'uptime',
            severity: 'info',
            title: `${u.name} recovered`,
            body: u.url,
            projectId: p.id,
            projectName: p.name,
            at: new Date().toISOString(),
            ref: u.id,
          });
        }
      }
    }

    state.lastDeliveryAt = new Date(maxDelivery);
    state.lastErrorAt = new Date(maxError);
    state.downCheckIds = nowDown;
    state.updatedAt = new Date();
    await state.save();

    if (firstRun) return; // establish baseline without flooding devices

    for (const a of fresh.slice(0, 10)) {
      const targets = devices
        .filter((d) => !d.kinds?.length || d.kinds.includes(a.kind) || d.kinds.includes(a.severity))
        .map((d) => d.token);
      await sendExpoPush(targets, {
        title: `${a.severity === 'critical' ? '🔴' : a.severity === 'warning' ? '🟠' : '🔵'} ${a.projectName} · ${a.title}`,
        body: a.body || a.title,
        data: { kind: a.kind, alertId: a.id, projectId: a.projectId, ref: a.ref ?? '' },
      });
    }
  } catch (err) {
    console.warn('monitor watcher error', err);
  } finally {
    watcherRunning = false;
  }
}

export function startMonitorAlertWatcher() {
  if (watcherTimer) return;
  const seconds = Math.max(30, Number(process.env.MONITOR_WATCH_INTERVAL_SEC) || 60);
  watcherTimer = setInterval(() => void watchOnce(), seconds * 1000);
  setTimeout(() => void watchOnce(), 5000);
}

export function stopMonitorAlertWatcher() {
  if (watcherTimer) clearInterval(watcherTimer);
  watcherTimer = null;
}
