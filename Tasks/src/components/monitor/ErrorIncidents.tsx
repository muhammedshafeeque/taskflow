import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { monitorApi, projectsApi, type Project } from '../../lib/api';

type Group = Record<string, unknown> & {
  _id: string;
  message?: string;
  type?: string;
  count?: number;
  status?: 'open' | 'resolved';
  lastSeen?: string;
  acknowledgedAt?: string | null;
  snoozedUntil?: string | null;
  regressedAt?: string | null;
  linkedIssueKey?: string;
  linkedIssueId?: string;
  linkedProjectId?: string;
  assigneeId?: string | null;
};

const chip = 'rounded-full border px-1.5 py-0.5 text-[10px] font-medium';
const action =
  'rounded-md border border-[color:var(--border-subtle)] px-2 py-0.5 text-[11px] hover:bg-[color:var(--bg-page)] disabled:opacity-50';

function ago(iso?: string | null) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/** Error groups as incidents: acknowledge, snooze alerts, resolve, or file an issue. */
export default function ErrorIncidents({
  projectId,
  rows,
  token,
  canUpdate,
  onChanged,
  focusId,
}: {
  projectId: string;
  rows: Group[];
  token: string;
  canUpdate: boolean;
  onChanged: () => void;
  /** Error group opened from a link (?group=) — shown first and highlighted. */
  focusId?: string;
}) {
  const { user } = useAuth();
  const myId = (user as { id?: string; _id?: string } | null)?.id ?? (user as { _id?: string } | null)?._id;
  const [pmProjects, setPmProjects] = useState<Project[]>([]);
  const [filing, setFiling] = useState<string | null>(null);
  const [pmProjectId, setPmProjectId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canUpdate) return;
    projectsApi.list(1, 100, token).then((r) => {
      const list = r.success && r.data ? r.data.data : [];
      setPmProjects(list);
      if (list[0]) setPmProjectId((v) => v || list[0]._id);
    });
  }, [token, canUpdate]);

  async function patch(id: string, body: Parameters<typeof monitorApi.updateErrorGroup>[2]) {
    setBusy(id);
    setError('');
    const r = await monitorApi.updateErrorGroup(projectId, id, body, token);
    setBusy(null);
    if (r.success) onChanged();
    else setError(r.message ?? 'Update failed');
  }

  async function fileIssue(id: string) {
    if (!pmProjectId) return;
    setBusy(id);
    setError('');
    const r = await monitorApi.createIssueFromError(projectId, id, pmProjectId, token);
    setBusy(null);
    if (r.success) {
      setFiling(null);
      onChanged();
    } else setError(r.message ?? 'Could not create issue');
  }

  if (!rows.length) return <p className="py-6 text-center text-sm text-[color:var(--text-muted)]">No errors — nice.</p>;

  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-red-500">{error}</p>}
      {[...rows].sort((a, b) => (a._id === focusId ? -1 : b._id === focusId ? 1 : 0)).map((g) => {
        const snoozed = g.snoozedUntil && new Date(g.snoozedUntil) > new Date();
        const open = g.status !== 'resolved';
        return (
          <div
            key={g._id}
            className={`rounded-lg border px-3 py-2.5 text-[13px] ${g._id === focusId ? 'border-[color:var(--accent)] ring-1 ring-[color:var(--accent)]/40' : 'border-[color:var(--border-subtle)]'}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-[color:var(--text-primary)] break-words">{g.message}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[color:var(--text-muted)]">
                  <span className={`${chip} ${open ? 'border-rose-500/40 text-rose-500' : 'border-emerald-500/40 text-emerald-600'}`}>
                    {open ? 'open' : 'resolved'}
                  </span>
                  {g.regressedAt && open && <span className={`${chip} border-orange-500/40 text-orange-500`}>regressed {ago(g.regressedAt)}</span>}
                  {g.acknowledgedAt && open && <span className={`${chip} border-sky-500/40 text-sky-500`}>acknowledged</span>}
                  {g.assigneeId && <span className={`${chip} border-violet-500/40 text-violet-500`}>{String(g.assigneeId) === myId ? 'assigned to you' : 'assigned'}</span>}
                  {snoozed && <span className={`${chip} border-amber-500/40 text-amber-600`}>snoozed until {new Date(g.snoozedUntil!).toLocaleString()}</span>}
                  {g.linkedIssueKey && g.linkedProjectId && (
                    <Link
                      to={`/projects/${g.linkedProjectId}/issues/${encodeURIComponent(g.linkedIssueKey)}`}
                      className={`${chip} border-[color:var(--accent)]/40 text-[color:var(--accent)]`}
                    >
                      {g.linkedIssueKey}
                    </Link>
                  )}
                  <span>
                    {g.count ?? 0}× · last {ago(g.lastSeen)}
                  </span>
                </div>
              </div>
              {canUpdate && (
                <div className="flex flex-wrap gap-1.5">
                  {open && !g.acknowledgedAt && (
                    <button type="button" className={action} disabled={busy === g._id} onClick={() => patch(g._id, { acknowledged: true })}>
                      Acknowledge
                    </button>
                  )}
                  {open && myId && String(g.assigneeId ?? '') !== myId && (
                    <button type="button" className={action} disabled={busy === g._id} onClick={() => patch(g._id, { assigneeId: myId, acknowledged: true })}>
                      Assign to me
                    </button>
                  )}
                  {open && (
                    <select
                      className={action}
                      value=""
                      disabled={busy === g._id}
                      onChange={(e) => e.target.value && patch(g._id, { snoozeMinutes: Number(e.target.value) })}
                    >
                      <option value="">{snoozed ? 'Snoozed…' : 'Snooze…'}</option>
                      <option value="60">1 hour</option>
                      <option value="1440">24 hours</option>
                      <option value="10080">7 days</option>
                      {snoozed && <option value="0">Unsnooze</option>}
                    </select>
                  )}
                  {!g.linkedIssueId && (
                    <button type="button" className={action} onClick={() => setFiling(filing === g._id ? null : g._id)}>
                      Create issue
                    </button>
                  )}
                  <button
                    type="button"
                    className={action}
                    disabled={busy === g._id}
                    onClick={() => patch(g._id, { status: open ? 'resolved' : 'open' })}
                  >
                    {open ? 'Resolve' : 'Reopen'}
                  </button>
                </div>
              )}
            </div>
            {filing === g._id && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2 py-1 text-xs"
                  value={pmProjectId}
                  onChange={(e) => setPmProjectId(e.target.value)}
                >
                  {pmProjects.map((p) => (
                    <option key={p._id} value={p._id}>
                      {p.key} · {p.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-primary px-3 py-1 rounded-md text-xs" disabled={busy === g._id || !pmProjectId} onClick={() => fileIssue(g._id)}>
                  {busy === g._id ? 'Creating…' : 'Create bug'}
                </button>
                <span className="text-[10px] text-[color:var(--text-muted)]">Includes stack trace, counts and a link back here.</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
