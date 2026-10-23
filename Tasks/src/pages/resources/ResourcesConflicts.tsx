import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiEdit2 } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { resourcesApi, type ResourceConflict, type ResourceConflictReport } from '../../lib/api';
import {
  AllocationModal,
  Chip,
  EmptyState,
  ErrorBanner,
  LEVEL_COLOR,
  LoadingBlock,
  PageShell,
  Segmented,
  Stat,
  Toast,
  draftFromAllocation,
  errorOf,
  fmtShort,
  refName,
  relDays,
  toInputDate,
  useResourceOptions,
  type AllocationDraft,
} from './resourceKit';

type Filter = 'all' | ResourceConflict['severity'];

const SEVERITY: Record<ResourceConflict['severity'], { label: string; tone: 'bad' | 'warn' | 'info'; color: string; help: string }> = {
  over: { label: 'Over-allocated', tone: 'bad', color: LEVEL_COLOR.over, help: 'Hard bookings exceed the over-allocation limit.' },
  inactive_member: {
    label: 'Not in workspace',
    tone: 'warn',
    color: LEVEL_COLOR.busy,
    help: 'Booked person is no longer an active member — reassign or end these allocations.',
  },
  soft_risk: {
    label: 'Soft-booking risk',
    tone: 'info',
    color: LEVEL_COLOR.bench,
    help: 'Fits as booked, but confirming the tentative bookings would push this person over the limit.',
  },
};

export default function ResourcesConflicts() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.resources.allocation.manage');
  const workspaceKey = user?.activeOrganizationId ?? '';
  const { options } = useResourceOptions(canManage ? token : null, workspaceKey);
  const [data, setData] = useState<ResourceConflictReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [draft, setDraft] = useState<AllocationDraft | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    resourcesApi.conflicts(token).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setData(res.data);
        setError('');
      } else setError(errorOf(res, 'Failed to load conflicts'));
    });
  }, [token]);

  useEffect(() => {
    load();
  }, [load, workspaceKey]);

  const rows = useMemo(() => (data ? data.conflicts.filter((c) => filter === 'all' || c.severity === filter) : []), [data, filter]);

  return (
    <PageShell
      title="Conflicts"
      description={
        data
          ? `Booking problems from ${fmtShort(data.from)} to ${fmtShort(data.to)} (next ${data.lookaheadDays} days). Limit is ${data.overAllocationPct}% of a person's week.`
          : 'Over-allocations and risky bookings in the coming weeks.'
      }
      actions={
        <Link to="/resources/schedule" className="text-xs text-[color:var(--accent)] hover:underline">
          Open schedule →
        </Link>
      }
    >
      {error && <ErrorBanner message={error} onRetry={load} />}
      {!data ? (
        loading && <LoadingBlock label="Checking bookings…" />
      ) : (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat label="Over-allocated" value={data.overCount} tone={data.overCount ? 'bad' : 'good'} />
            <Stat label="Not in workspace" value={data.inactiveCount} tone={data.inactiveCount ? 'warn' : undefined} />
            <Stat label="Soft-booking risk" value={data.softRiskCount} />
            <Stat label="People affected" value={data.peopleAffected} hint="excluding soft risks" />
          </div>

          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All', count: data.count },
              { value: 'over', label: 'Over-allocated', count: data.overCount },
              { value: 'inactive_member', label: 'Not in workspace', count: data.inactiveCount },
              { value: 'soft_risk', label: 'Soft risk', count: data.softRiskCount },
            ]}
          />

          {rows.length === 0 ? (
            <EmptyState title={data.count === 0 ? 'No conflicts ahead' : 'Nothing in this category'}>
              {data.count === 0 && `Everyone fits within ${data.overAllocationPct}% for the next ${data.lookaheadDays} days.`}
            </EmptyState>
          ) : (
            <div className="space-y-3">
              {rows.map((c) => {
                const sev = SEVERITY[c.severity];
                return (
                  <article
                    key={c.id}
                    className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 card-shadow"
                    style={{ borderLeft: `3px solid ${sev.color}` }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{c.userName}</p>
                          <Chip tone={sev.tone} title={sev.help}>
                            {sev.label}
                          </Chip>
                        </div>
                        <p className="text-xs text-[color:var(--text-muted)] mt-0.5">
                          {c.start === c.end ? fmtShort(c.start) : `${fmtShort(c.start)} – ${fmtShort(c.end)}`} · {c.days} day{c.days === 1 ? '' : 's'}
                          {c.startsInDays > 0 ? ` · starts ${relDays(c.start)}` : ' · happening now'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold tabular-nums" style={{ color: sev.color }}>
                          {c.peakPercent}%
                        </p>
                        {c.severity === 'soft_risk' && <p className="text-[11px] text-[color:var(--text-muted)]">{c.hardPercent}% confirmed</p>}
                      </div>
                    </div>
                    <ul className="mt-3 divide-y divide-[color:var(--border-subtle)]/60 text-sm">
                      {c.allocations.map((a) => (
                        <li key={a._id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                          <span className="font-medium">{refName(a.projectId as never)}</span>
                          <span className="tabular-nums">{a.percent}%</span>
                          {a.softBooked && <Chip tone="warn">soft</Chip>}
                          {a.roleLabel && <span className="text-xs text-[color:var(--text-muted)]">{a.roleLabel}</span>}
                          <span className="text-xs text-[color:var(--text-muted)]">
                            {fmtShort(toInputDate(a.startDate))} → {a.endDate ? fmtShort(toInputDate(a.endDate)) : 'open-ended'}
                          </span>
                          {canManage && (
                            <button
                              type="button"
                              className="ml-auto inline-flex items-center gap-1 text-xs text-[color:var(--accent)] hover:underline"
                              onClick={() => setDraft(draftFromAllocation(a))}
                            >
                              <FiEdit2 /> Adjust
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}

      {token && canManage && (
        <AllocationModal
          open={!!draft}
          draft={draft}
          options={options}
          token={token}
          onClose={() => setDraft(null)}
          onSaved={(m) => {
            setDraft(null);
            setToast(m ?? 'Saved.');
            load();
          }}
        />
      )}
      <Toast message={toast} onDone={() => setToast('')} />
    </PageShell>
  );
}
