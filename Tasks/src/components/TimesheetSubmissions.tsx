import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import { canAny } from '../utils/moduleAccess';

type Submission = {
  _id: string;
  userId: { _id: string; name?: string; email?: string } | string;
  weekStart: string;
  status: 'submitted' | 'approved' | 'rejected';
  totalMinutes: number;
  billableMinutes: number;
  note?: string;
  decisionNote?: string;
};

const hours = (m: number) => `${(m / 60).toFixed(1)}h`;
const week = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const tone: Record<string, string> = {
  submitted: 'bg-amber-500/15 text-amber-600',
  approved: 'bg-emerald-500/15 text-emerald-600',
  rejected: 'bg-rose-500/15 text-rose-600',
};

/** Weekly timesheet submission (for the logged-in user) and the approval queue. */
export default function TimesheetSubmissions() {
  const { token, user } = useAuth();
  const canSubmit = canAny(user, 'taskflow.timesheet.submit');
  const [mine, setMine] = useState<Submission[]>([]);
  const [queue, setQueue] = useState<Submission[]>([]);
  const [weekOf, setWeekOf] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [msg, setMsg] = useState('');
  const showApprovals = new URLSearchParams(window.location.search).get('tab') === 'approvals';

  const load = useCallback(() => {
    if (!token) return;
    api.get<Submission[]>('/timesheet/approvals/submissions', token).then((r) => setMine(r.data ?? []));
    api.get<Submission[]>('/timesheet/approvals/submissions?scope=approve', token).then((r) => setQueue(r.data ?? []));
  }, [token]);
  useEffect(load, [load]);

  const submit = async () => {
    if (!token) return;
    const note = prompt('Note for your approver (optional)') ?? undefined;
    const r = await api.post('/timesheet/approvals/submit', { weekStart: weekOf, note }, token);
    setMsg(r.success ? 'Submitted for approval.' : r.message ?? 'Failed');
    load();
  };
  const decide = async (s: Submission, decision: 'approved' | 'rejected') => {
    if (!token) return;
    const note = decision === 'rejected' ? prompt('Reason for returning this timesheet') : undefined;
    if (decision === 'rejected' && note === null) return;
    const r = await api.post(`/timesheet/approvals/submissions/${s._id}/decision`, { decision, note }, token);
    if (!r.success) alert(r.message);
    load();
  };

  if (!canSubmit && queue.length === 0 && mine.length === 0) return null;
  return (
    <div className={`grid gap-4 ${queue.length ? 'lg:grid-cols-2' : ''}`}>
      {(canSubmit || mine.length > 0) && (
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">My weekly submissions</h2>
            {canSubmit && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[color:var(--text-muted)]">Week of</span>
                <input type="date" value={weekOf} onChange={(e) => setWeekOf(e.target.value)} className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2 py-1" />
                <button onClick={submit} className="btn-primary px-3 py-1.5 rounded-md text-xs">
                  Submit week
                </button>
              </div>
            )}
          </div>
          {msg && <p className="text-xs text-[color:var(--text-muted)]">{msg}</p>}
          <ul className="divide-y divide-[color:var(--border-subtle)] text-sm">
            {mine.slice(0, 8).map((s) => (
              <li key={s._id} className="flex items-center justify-between gap-3 py-1.5">
                <span>{week(s.weekStart)}</span>
                <span className="tabular-nums text-[color:var(--text-muted)]">
                  {hours(s.totalMinutes)} · {hours(s.billableMinutes)} billable
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${tone[s.status]}`} title={s.decisionNote}>
                  {s.status}
                </span>
              </li>
            ))}
            {mine.length === 0 && <li className="py-2 text-xs text-[color:var(--text-muted)]">Nothing submitted yet.</li>}
          </ul>
        </div>
      )}
      {queue.length > 0 && (
        <div id="approvals" className={`rounded-xl border bg-[color:var(--bg-surface)] p-4 space-y-3 ${showApprovals ? 'border-[color:var(--accent)]' : 'border-[color:var(--border-subtle)]'}`}>
          <h2 className="text-sm font-semibold">Waiting for your approval · {queue.length}</h2>
          <ul className="divide-y divide-[color:var(--border-subtle)] text-sm">
            {queue.map((s) => (
              <li key={s._id} className="py-2 space-y-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{typeof s.userId === 'object' ? s.userId.name ?? s.userId.email : 'User'}</span>
                  <span className="text-[color:var(--text-muted)]">{week(s.weekStart)}</span>
                  <span className="tabular-nums">
                    {hours(s.totalMinutes)} ({hours(s.billableMinutes)} billable)
                  </span>
                </div>
                {s.note && <p className="text-xs italic text-[color:var(--text-muted)]">{s.note}</p>}
                <div className="flex gap-2 text-xs">
                  <button onClick={() => decide(s, 'approved')} className="rounded-md bg-emerald-600 px-2.5 py-1 text-white">
                    Approve
                  </button>
                  <button onClick={() => decide(s, 'rejected')} className="rounded-md border border-rose-500/40 px-2.5 py-1 text-rose-500">
                    Return
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
