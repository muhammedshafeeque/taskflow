import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import ErrorIncidents from '../../components/monitor/ErrorIncidents';
import { monitorApi, WS_URL } from '../../lib/api';
import { monitorInputClass, useMonitorWorkspace } from './MonitorWorkspace';
import { ModuleHeader, StatusPill } from '../../components/moduleKit';
import SectionCard from '../../components/SectionCard';
import { FiPlus } from 'react-icons/fi';

const TITLES: Record<string, { title: string; subtitle: string }> = {
  logs: { title: 'Logs', subtitle: 'Live tail of ingest/logs. Filter by level in search.' },
  errors: { title: 'Errors', subtitle: 'Grouped exceptions and crashes. Toggle open / resolved.' },
  live: { title: 'Live users', subtitle: 'Sessions seen in the last two minutes.' },
  performance: { title: 'Performance', subtitle: 'Slow transactions: routes and page loads.' },
  http: { title: 'HTTP', subtitle: 'Inbound and outbound calls: method, URL, status, duration.' },
  vitals: { title: 'Web vitals', subtitle: 'LCP, INP, CLS, and TTFB from web apps.' },
  uptime: { title: 'Uptime', subtitle: 'Platform pings configured URLs. No SDK required.' },
  releases: { title: 'Releases', subtitle: 'Versions first seen on ingest.' },
  events: { title: 'Events', subtitle: 'Custom named events from your apps.' },
  devices: { title: 'Devices', subtitle: 'User-agent breakdown from presence.' },
};

function flatten(kind: string, r: Record<string, unknown>): Record<string, string> {
  if (kind === 'logs')
    return { time: String(r.timestamp ?? ''), level: String(r.level ?? ''), message: String(r.message ?? ''), release: String(r.release ?? '') };
  if (kind === 'errors')
    return {
      message: String(r.message ?? ''),
      count: String(r.count ?? ''),
      status: String(r.status ?? ''),
      lastSeen: String(r.lastSeen ?? ''),
      id: String(r._id ?? ''),
    };
  if (kind === 'live')
    return { page: String(r.page ?? ''), user: String(r.userId ?? ''), ua: String(r.userAgent ?? ''), lastSeen: String(r.lastSeen ?? '') };
  if (kind === 'performance')
    return { name: String(r.name ?? ''), durationMs: String(r.durationMs ?? ''), status: String(r.status ?? ''), release: String(r.release ?? '') };
  if (kind === 'http')
    return { method: String(r.method ?? ''), url: String(r.url ?? ''), status: String(r.status ?? ''), durationMs: String(r.durationMs ?? '') };
  if (kind === 'vitals') return { name: String(r.name ?? ''), value: String(r.value ?? ''), release: String(r.release ?? '') };
  if (kind === 'releases') return { version: String(r.version ?? ''), firstSeen: String(r.firstSeen ?? '') };
  if (kind === 'events') return { name: String(r.name ?? ''), time: String(r.timestamp ?? '') };
  return { ua: typeof r._id === 'string' ? r._id : JSON.stringify(r._id), count: String(r.count ?? '') };
}

function levelTone(level: string): 'green' | 'amber' | 'red' | 'blue' | 'slate' {
  const l = level.toLowerCase();
  if (l === 'error' || l === 'fatal') return 'red';
  if (l === 'warn' || l === 'warning') return 'amber';
  if (l === 'info') return 'blue';
  if (l === 'debug') return 'slate';
  return 'green';
}

export default function MonitorTelemetry() {
  const { pathname } = useLocation();
  const kind = pathname.split('/').filter(Boolean).pop() || 'logs';
  const meta = TITLES[kind] ?? { title: kind, subtitle: '' };
  const { token, user } = useAuth();
  const { projectId, project, envs, apps, filters, setFilters, qparams } = useMonitorWorkspace();
  const canManageUptime = canAny(user, 'taskflow.monitor.uptime.manage');
  const canUpdateErrors = canAny(user, 'taskflow.monitor.error.update');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [uptimePack, setUptimePack] = useState<{ checks: Record<string, unknown>[]; samples: Record<string, unknown>[] } | null>(null);
  const [error, setError] = useState('');
  const [uptimeForm, setUptimeForm] = useState({ name: '', url: '', intervalMinutes: '5' });

  const load = useCallback(() => {
    if (!token || !projectId) return;
    setError('');
    if (kind === 'uptime') {
      Promise.all([monitorApi.uptime(projectId, token), monitorApi.uptimeSamples(projectId, token)]).then(([c, s]) => {
        if (!c.success || !s.success) setError(c.message || s.message || 'Failed');
        else setUptimePack({ checks: (c.data as Record<string, unknown>[]) ?? [], samples: (s.data as Record<string, unknown>[]) ?? [] });
      });
      return;
    }
    const map: Record<string, () => Promise<{ success: boolean; data?: unknown; message?: string }>> = {
      logs: () => monitorApi.logs(projectId, token, qparams),
      errors: () => monitorApi.errors(projectId, token, qparams),
      live: () => monitorApi.liveUsers(projectId, token, qparams),
      performance: () => monitorApi.transactions(projectId, token, qparams),
      http: () => monitorApi.http(projectId, token, qparams),
      vitals: () => monitorApi.vitals(projectId, token, qparams),
      events: () => monitorApi.events(projectId, token, qparams),
      releases: () => monitorApi.releases(projectId, token, qparams),
      devices: () => monitorApi.devices(projectId, token),
    };
    map[kind]?.().then((r) => {
      if (!r.success) setError(r.message || 'Failed to load');
      else setRows(Array.isArray(r.data) ? (r.data as Record<string, unknown>[]) : []);
    });
  }, [token, projectId, kind, qparams]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 8000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (kind !== 'logs' || !projectId || !token) return;
    const socket = io(WS_URL, { path: '/socket.io', auth: { token } });
    socket.emit('subscribe:monitor', { projectId, environmentId: filters.environmentId || undefined });
    socket.on('monitor:event', (msg: { channel?: string; payload?: unknown }) => {
      if (msg.channel !== 'log') return;
      setRows((prev) => [msg.payload as Record<string, unknown>, ...prev].slice(0, 200));
    });
    return () => {
      socket.disconnect();
    };
  }, [kind, projectId, token, filters.environmentId]);

  const tableRows = rows.map((r) => flatten(kind, r));
  const cols = tableRows[0] ? Object.keys(tableRows[0]).filter((c) => c !== 'id') : [];

  return (
    <div className="w-full animate-fade-in space-y-5 px-4 py-8 sm:px-6 lg:px-8">
      <ModuleHeader eyebrow={project?.key ?? 'Monitor'} title={meta.title} subtitle={meta.subtitle} accent="#22d3ee" />

      {kind !== 'uptime' && kind !== 'devices' && (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 sm:grid-cols-5">
          {(
            [
              ['Environment', 'environmentId', 'select-env'],
              ['App', 'appId', 'select-app'],
              ['Release', 'release', 'text'],
              ['Search', 'q', 'text'],
              ['From', 'from', 'datetime-local'],
            ] as const
          ).map(([label, key, type]) => (
            <label key={key} className="block">
              <span className="mb-1 block text-[11px] font-medium text-[color:var(--text-muted)]">{label}</span>
              {type === 'select-env' ? (
                <select className={monitorInputClass} value={filters.environmentId} onChange={(e) => setFilters({ ...filters, environmentId: e.target.value })}>
                  <option value="">All</option>
                  {envs.map((e) => (
                    <option key={e._id} value={e._id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              ) : type === 'select-app' ? (
                <select className={monitorInputClass} value={filters.appId} onChange={(e) => setFilters({ ...filters, appId: e.target.value })}>
                  <option value="">All</option>
                  {apps.map((a) => (
                    <option key={a._id} value={a._id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={type === 'datetime-local' ? 'datetime-local' : 'text'}
                  className={monitorInputClass}
                  value={key === 'release' || key === 'q' || key === 'from' ? filters[key] : ''}
                  onChange={(e) => {
                    if (key === 'release' || key === 'q' || key === 'from') setFilters({ ...filters, [key]: e.target.value });
                  }}
                />
              )}
            </label>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-rose-400">{error}</p>}

      {kind === 'uptime' ? (
        <SectionCard title="Checks" description="GET/HEAD from the API host.">
          {canManageUptime && token && (
            <form
              className="mb-4 grid gap-2 sm:grid-cols-[1fr_2fr_5rem_auto]"
              onSubmit={(e) => {
                e.preventDefault();
                monitorApi.createUptime(projectId, { ...uptimeForm, intervalMinutes: Number(uptimeForm.intervalMinutes) }, token).then((r) => {
                  if (r.success) {
                    setUptimeForm({ name: '', url: '', intervalMinutes: '5' });
                    load();
                  } else setError(r.message || 'Could not create check');
                });
              }}
            >
              <input className={monitorInputClass} placeholder="Name" value={uptimeForm.name} onChange={(e) => setUptimeForm((f) => ({ ...f, name: e.target.value }))} />
              <input className={monitorInputClass} placeholder="https://example.com/health" value={uptimeForm.url} onChange={(e) => setUptimeForm((f) => ({ ...f, url: e.target.value }))} />
              <input className={monitorInputClass} value={uptimeForm.intervalMinutes} onChange={(e) => setUptimeForm((f) => ({ ...f, intervalMinutes: e.target.value }))} />
              <button type="submit" className="btn-primary btn-primary-sm inline-flex h-9 items-center gap-1">
                <FiPlus className="h-3.5 w-3.5" /> Add
              </button>
            </form>
          )}
          <ul className="mb-6 space-y-2">
            {(uptimePack?.checks ?? []).map((c) => (
              <li key={String(c._id)} className="flex items-center justify-between rounded-lg border border-[color:var(--border-subtle)] px-3 py-2 text-[13px]">
                <span>
                  <span className="font-medium">{String(c.name)}</span>
                  <span className="ml-2 text-[color:var(--text-muted)]">{String(c.url)}</span>
                </span>
                {canManageUptime && token && (
                  <button type="button" className="text-rose-400" onClick={() => monitorApi.deleteUptime(projectId, String(c._id), token).then(load)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">Recent samples</h3>
          <DataTable
            rows={(uptimePack?.samples ?? []).map((s) => ({
              ok: String(s.ok),
              status: String(s.status ?? ''),
              ms: String(s.latencyMs ?? ''),
              at: String(s.timestamp ?? ''),
            }))}
          />
        </SectionCard>
      ) : (
        <SectionCard title={meta.title} description={`${tableRows.length} row${tableRows.length === 1 ? '' : 's'}`}>
          {kind === 'errors' && token ? (
            <ErrorIncidents
              projectId={projectId}
              rows={rows as Parameters<typeof ErrorIncidents>[0]['rows']}
              token={token}
              canUpdate={canUpdateErrors}
              onChanged={load}
              focusId={new URLSearchParams(location.search).get('group') ?? undefined}
            />
          ) : (
          <DataTable
            rows={tableRows}
            cols={cols}
            onAction={
              kind === 'errors' && token
                ? (row) => {
                    if (!row.id) return;
                    monitorApi.patchError(projectId, row.id, row.status === 'open' ? 'resolved' : 'open', token).then(load);
                  }
                : undefined
            }
            renderCell={
              kind === 'logs'
                ? (col, val) => (col === 'level' ? <StatusPill label={val} tone={levelTone(val)} /> : val)
                : kind === 'errors'
                  ? (col, val) => (col === 'status' ? <StatusPill label={val} tone={val === 'open' ? 'red' : 'green'} /> : val)
                  : undefined
            }
          />
          )}
        </SectionCard>
      )}
    </div>
  );
}

function DataTable({
  rows,
  cols,
  onAction,
  renderCell,
}: {
  rows: Record<string, string>[];
  cols?: string[];
  onAction?: (row: Record<string, string>) => void;
  renderCell?: (col: string, val: string) => ReactNode;
}) {
  if (!rows.length) {
    return (
      <div className="rounded-lg border border-dashed border-[color:var(--border-subtle)] px-4 py-12 text-center text-[13px] text-[color:var(--text-muted)]">
        Nothing in this window. Ingest with an app key or clear filters.
      </div>
    );
  }
  const columns = cols ?? Object.keys(rows[0]).filter((c) => c !== 'id');
  return (
    <div className="overflow-x-auto rounded-lg border border-[color:var(--border-subtle)]">
      <table className="min-w-full text-left text-[12px]">
        <thead className="bg-[color:var(--bg-page)] text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2.5">
                {c}
              </th>
            ))}
            {onAction && <th className="px-3 py-2.5" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-[color:var(--border-subtle)] odd:bg-[color:var(--bg-page)]/35">
              {columns.map((c) => (
                <td key={c} className="max-w-xs truncate px-3 py-2.5 text-[color:var(--text-primary)]">
                  {renderCell ? renderCell(c, row[c] ?? '') : <span className="font-mono text-[11px]">{row[c]}</span>}
                </td>
              ))}
              {onAction && (
                <td className="px-3 py-2.5">
                  <button type="button" className="text-[12px] font-medium text-cyan-300 hover:underline" onClick={() => onAction(row)}>
                    Toggle
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
