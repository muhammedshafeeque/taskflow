import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FiCheck, FiCopy, FiDownload, FiEdit2, FiPlus, FiScissors, FiTrash2 } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import ConfirmModal from '../../components/ConfirmModal';
import { downloadCsv } from '../../lib/exportCsv';
import { resourcesApi, type ResourceAllocation } from '../../lib/api';
import {
  AllocationModal,
  Chip,
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  PageShell,
  Segmented,
  Stat,
  Toast,
  blankAllocation,
  btnPrimary,
  btnSecondary,
  diffDaysKey,
  draftFromAllocation,
  errorOf,
  fmtDate,
  inputCls,
  refKey,
  refName,
  relDays,
  todayKey,
  toInputDate,
  useResourceOptions,
  type AllocationDraft,
} from './resourceKit';

type StatusTab = 'current' | 'active' | 'upcoming' | 'past' | 'all';

function statusOf(a: ResourceAllocation, today: string): 'active' | 'upcoming' | 'past' {
  const s = toInputDate(a.startDate);
  const e = a.endDate ? toInputDate(a.endDate) : null;
  if (s > today) return 'upcoming';
  if (e && e < today) return 'past';
  return 'active';
}

export default function ResourcesAllocations() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.resources.allocation.manage');
  const workspaceKey = user?.activeOrganizationId ?? '';
  const [params, setParams] = useSearchParams();
  const { options } = useResourceOptions(token, workspaceKey);
  const [rows, setRows] = useState<ResourceAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<StatusTab>((params.get('status') as StatusTab) || 'current');
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState(params.get('userId') ?? '');
  const [projectId, setProjectId] = useState(params.get('projectId') ?? '');
  const [booking, setBooking] = useState<'all' | 'hard' | 'soft'>('all');
  const [draft, setDraft] = useState<AllocationDraft | null>(null);
  const [toast, setToast] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<ResourceAllocation | null>(null);
  const today = todayKey();

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    // Load everything once; status tabs filter on the client so counts stay visible.
    resourcesApi.listAllocations(token, { userId: userId || undefined, projectId: projectId || undefined }).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setRows(Array.isArray(res.data) ? res.data : []);
        setError('');
      } else setError(errorOf(res, 'Failed to load allocations'));
    });
  }, [token, userId, projectId]);

  useEffect(() => {
    load();
  }, [load, workspaceKey]);

  // Deep links: ?edit=<id> opens the editor, ?new=1 opens a blank one prefilled from filters.
  useEffect(() => {
    const editId = params.get('edit');
    if (editId && rows.length) {
      const row = rows.find((r) => r._id === editId);
      if (row && canManage) setDraft(draftFromAllocation(row));
      params.delete('edit');
      setParams(params, { replace: true });
    } else if (params.get('new') && canManage) {
      setDraft(
        blankAllocation({
          userId: params.get('userId') ?? '',
          projectId: params.get('projectId') ?? '',
          startDate: params.get('start') ?? todayKey(),
          demandId: params.get('demandId') ?? '',
        })
      );
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, rows, canManage, setParams]);

  function applyFilter(key: 'userId' | 'projectId', value: string) {
    if (key === 'userId') setUserId(value);
    else setProjectId(value);
    if (value) params.set(key, value);
    else params.delete(key);
    setParams(params, { replace: true });
  }

  const counts = useMemo(() => {
    const c = { active: 0, upcoming: 0, past: 0 };
    rows.forEach((r) => (c[statusOf(r, today)] += 1));
    return c;
  }, [rows, today]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const st = statusOf(r, today);
      if (tab === 'current' && st === 'past') return false;
      if ((tab === 'active' || tab === 'upcoming' || tab === 'past') && st !== tab) return false;
      if (booking === 'hard' && r.softBooked) return false;
      if (booking === 'soft' && !r.softBooked) return false;
      if (!q) return true;
      return [refName(r.userId as never), refName(r.projectId as never), r.roleLabel, r.notes]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, tab, booking, search, today]);

  const summary = useMemo(() => {
    const live = rows.filter((r) => statusOf(r, today) === 'active');
    const people = new Set(live.map((r) => refKey(r.userId as never)));
    const fte = live.filter((r) => !r.softBooked).reduce((s, r) => s + r.percent / 100, 0);
    const endingSoon = live.filter((r) => r.endDate && diffDaysKey(today, toInputDate(r.endDate)) <= options.settings.freeingSoonDays).length;
    return { people: people.size, fte: Math.round(fte * 10) / 10, soft: live.filter((r) => r.softBooked).length, endingSoon };
  }, [rows, today, options.settings.freeingSoonDays]);

  async function patch(r: ResourceAllocation, body: Record<string, unknown>, message: string) {
    if (!token) return;
    const res = await resourcesApi.updateAllocation(r._id, body, token);
    if (!res.success) {
      setToast(errorOf(res, 'Update failed'));
      return;
    }
    setToast(res.data?.conflicts?.overAllocated ? `${message} Note: person is now over-allocated (${res.data.conflicts.committedPercent}%).` : message);
    load();
  }

  async function remove(r: ResourceAllocation) {
    if (!token) return;
    const res = await resourcesApi.deleteAllocation(r._id, token);
    setConfirmDelete(null);
    setToast(res.success ? 'Allocation removed.' : errorOf(res, 'Delete failed'));
    load();
  }

  function exportCsv() {
    downloadCsv(`allocations-${today}`, filtered, [
      { header: 'Person', value: (r) => refName(r.userId as never) },
      { header: 'Email', value: (r) => (typeof r.userId === 'object' ? r.userId?.email : '') },
      { header: 'Project', value: (r) => refName(r.projectId as never) },
      { header: 'Role', value: (r) => r.roleLabel },
      { header: 'Percent', value: (r) => r.percent },
      { header: 'Start', value: (r) => toInputDate(r.startDate) },
      { header: 'End', value: (r) => toInputDate(r.endDate) },
      { header: 'Billable', value: (r) => (r.billable ? 'yes' : 'no') },
      { header: 'Soft', value: (r) => (r.softBooked ? 'yes' : 'no') },
      { header: 'Demand', value: (r) => (r.demandId && typeof r.demandId === 'object' ? r.demandId.title : '') },
      { header: 'Status', value: (r) => statusOf(r, today) },
      { header: 'Notes', value: (r) => r.notes },
    ]);
  }

  return (
    <PageShell
      title="Allocations"
      description="Book people onto projects with a share of their week, then keep the plan current as work starts, ends and shifts."
      actions={
        <>
          <Link to="/resources/schedule" className={btnSecondary}>
            Schedule view
          </Link>
          <button type="button" className={btnSecondary} onClick={exportCsv} disabled={filtered.length === 0}>
            <FiDownload /> Export
          </button>
          {canManage && (
            <button type="button" className={btnPrimary} onClick={() => setDraft(blankAllocation({ userId, projectId }))}>
              <FiPlus /> New allocation
            </button>
          )}
        </>
      }
    >
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="People booked now" value={summary.people} hint={`of ${options.users.length} in workspace`} />
        <Stat label="Committed FTE" value={summary.fte} hint="hard bookings active today" />
        <Stat label="Soft bookings" value={summary.soft} hint="tentative, not committed" tone={summary.soft ? 'warn' : undefined} />
        <Stat label="Ending soon" value={summary.endingSoon} hint={`within ${options.settings.freeingSoonDays} days`} to="/resources/bench" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'current', label: 'Current & upcoming', count: counts.active + counts.upcoming },
            { value: 'active', label: 'Active', count: counts.active },
            { value: 'upcoming', label: 'Upcoming', count: counts.upcoming },
            { value: 'past', label: 'Ended', count: counts.past },
            { value: 'all', label: 'All', count: rows.length },
          ]}
        />
        <Segmented
          value={booking}
          onChange={setBooking}
          options={[
            { value: 'all', label: 'All bookings' },
            { value: 'hard', label: 'Committed' },
            { value: 'soft', label: 'Soft' },
          ]}
        />
        <div className="flex flex-1 flex-wrap justify-end gap-2">
          <select value={userId} onChange={(e) => applyFilter('userId', e.target.value)} className={`${inputCls} w-auto max-w-[12rem]`} aria-label="Person">
            <option value="">All people</option>
            {options.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select value={projectId} onChange={(e) => applyFilter('projectId', e.target.value)} className={`${inputCls} w-auto max-w-[12rem]`} aria-label="Project">
            <option value="">All projects</option>
            {options.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} · {p.name}
              </option>
            ))}
          </select>
          <input type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputCls} w-44`} />
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && rows.length === 0 ? (
        <LoadingBlock label="Loading allocations…" />
      ) : filtered.length === 0 ? (
        <EmptyState title={rows.length === 0 ? 'No allocations yet' : 'Nothing matches these filters'}>
          {rows.length === 0 && canManage ? 'Add an allocation to start planning capacity.' : null}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[color:var(--border-subtle)] text-left text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
                <th className="px-4 py-3 font-medium">Person</th>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 font-medium">Commitment</th>
                <th className="px-4 py-3 font-medium">Dates</th>
                <th className="px-4 py-3 font-medium">Flags</th>
                {canManage && <th className="px-4 py-3 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const st = statusOf(r, today);
                const end = r.endDate ? toInputDate(r.endDate) : null;
                const endsIn = end ? diffDaysKey(today, end) : null;
                const uid = refKey(r.userId as never);
                const pid = refKey(r.projectId as never);
                return (
                  <tr key={r._id} className={`border-b border-[color:var(--border-subtle)]/60 hover:bg-[color:var(--bg-elevated)]/40 ${st === 'past' ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">
                      <button type="button" className="font-medium hover:text-[color:var(--accent)] text-left" onClick={() => applyFilter('userId', uid)}>
                        {refName(r.userId as never)}
                      </button>
                      {r.roleLabel && <div className="text-[11px] text-[color:var(--text-muted)]">{r.roleLabel}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {pid ? (
                        <Link to={`/projects/${pid}/dashboard`} className="text-[color:var(--accent)] hover:underline">
                          {refName(r.projectId as never)}
                        </Link>
                      ) : (
                        refName(r.projectId as never)
                      )}
                      {r.demandId && typeof r.demandId === 'object' && (
                        <div className="text-[11px] text-[color:var(--text-muted)]">↳ {r.demandId.title}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 w-32">
                        <div className="h-1.5 flex-1 rounded-full bg-[color:var(--bg-elevated)] overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${r.percent}%`,
                              background: r.softBooked ? 'repeating-linear-gradient(45deg,#f59e0b 0 3px,transparent 3px 6px)' : 'var(--accent)',
                            }}
                          />
                        </div>
                        <span className="tabular-nums text-xs w-9 text-right">{r.percent}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[color:var(--text-muted)] whitespace-nowrap">
                      {fmtDate(r.startDate)} → {end ? fmtDate(end) : 'open-ended'}
                      <div className="text-[11px]">
                        {st === 'upcoming' && `starts ${relDays(toInputDate(r.startDate), today)}`}
                        {st === 'active' && endsIn != null && (
                          <span className={endsIn <= options.settings.freeingSoonDays ? 'text-amber-400' : ''}>ends {relDays(end, today)}</span>
                        )}
                        {st === 'past' && `ended ${relDays(end, today)}`}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Chip tone={st === 'active' ? 'good' : st === 'upcoming' ? 'info' : 'neutral'}>{st}</Chip>
                        {r.billable ? <Chip tone="accent">billable</Chip> : <Chip>non-billable</Chip>}
                        {r.softBooked && <Chip tone="warn">soft</Chip>}
                      </div>
                    </td>
                    {canManage && (
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1 text-[color:var(--text-muted)]">
                          {r.softBooked && st !== 'past' && (
                            <IconBtn title="Confirm booking" onClick={() => void patch(r, { softBooked: false }, 'Booking confirmed.')}>
                              <FiCheck />
                            </IconBtn>
                          )}
                          <IconBtn title="Edit" onClick={() => setDraft(draftFromAllocation(r))}>
                            <FiEdit2 />
                          </IconBtn>
                          <IconBtn title={r.endDate ? 'Extend (copy from day after end)' : 'Duplicate'} onClick={() => setDraft(draftFromAllocation(r, true))}>
                            <FiCopy />
                          </IconBtn>
                          {st === 'active' && (
                            <IconBtn title="End today" onClick={() => void patch(r, { endDate: today < toInputDate(r.startDate) ? toInputDate(r.startDate) : today }, 'Allocation ended today.')}>
                              <FiScissors />
                            </IconBtn>
                          )}
                          <IconBtn title="Delete" danger onClick={() => setConfirmDelete(r)}>
                            <FiTrash2 />
                          </IconBtn>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {token && (
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
      <ConfirmModal
        open={!!confirmDelete}
        title="Delete allocation?"
        message={
          confirmDelete
            ? `${refName(confirmDelete.userId as never)} on ${refName(confirmDelete.projectId as never)} (${confirmDelete.percent}%). To keep history, use “End today” instead.`
            : ''
        }
        confirmLabel="Delete"
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
      <Toast message={toast} onDone={() => setToast('')} />
    </PageShell>
  );
}

function IconBtn({ title, onClick, children, danger }: { title: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`p-1.5 rounded-md hover:bg-[color:var(--bg-elevated)] ${danger ? 'hover:text-red-400' : 'hover:text-[color:var(--text-primary)]'}`}
    >
      {children}
    </button>
  );
}

