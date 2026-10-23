import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiChevronDown, FiChevronLeft, FiChevronRight, FiChevronRight as FiCaret, FiPlus } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { resourcesApi, type ResourceAllocation, type ResourceSchedule } from '../../lib/api';
import {
  AllocationModal,
  EmptyState,
  ErrorBanner,
  LEVEL_COLOR,
  LEVEL_LABEL,
  LoadingBlock,
  PageShell,
  Segmented,
  Toast,
  addDaysKey,
  blankAllocation,
  btnPrimary,
  btnSecondary,
  diffDaysKey,
  draftFromAllocation,
  errorOf,
  fmtShort,
  inputCls,
  loadLevel,
  refName,
  todayKey,
  toInputDate,
  useResourceOptions,
  weekStartKey,
  type AllocationDraft,
  type LoadLevel,
} from './resourceKit';

const NAME_COL = 'minmax(11rem, 14rem)';

function cellBg(level: LoadLevel, pct: number): string {
  if (level === 'none') return 'transparent';
  const strength = level === 'over' ? 38 : Math.round(14 + Math.min(pct, 100) * 0.18);
  return `color-mix(in srgb, ${LEVEL_COLOR[level]} ${strength}%, transparent)`;
}

export default function ResourcesSchedule() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.resources.allocation.manage');
  const workspaceKey = user?.activeOrganizationId ?? '';
  const { options } = useResourceOptions(token, workspaceKey);
  const today = todayKey();
  const [from, setFrom] = useState(weekStartKey(today));
  const [weeks, setWeeks] = useState(12);
  const [view, setView] = useState<'people' | 'projects'>('people');
  const [department, setDepartment] = useState('');
  const [projectId, setProjectId] = useState('');
  const [search, setSearch] = useState('');
  const [onlyFree, setOnlyFree] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [data, setData] = useState<ResourceSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<AllocationDraft | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    resourcesApi.schedule(token, { from, weeks, department: department || undefined, projectId: projectId || undefined }).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setData(res.data);
        setError('');
      } else setError(errorOf(res, 'Failed to load schedule'));
    });
  }, [token, from, weeks, department, projectId]);

  useEffect(() => {
    load();
  }, [load, workspaceKey]);

  const settings = data?.settings ?? options.settings;
  const cols = `${NAME_COL} repeat(${data?.weeks.length ?? weeks}, minmax(2.75rem, 1fr))`;

  const people = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.people.filter((p) => {
      if (q && !`${p.name} ${p.email} ${p.department ?? ''}`.toLowerCase().includes(q)) return false;
      if (onlyFree && !p.weeks.some((w) => w.hardPct < settings.benchThresholdPct)) return false;
      return true;
    });
  }, [data, search, onlyFree, settings.benchThresholdPct]);

  function toggle(id: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function bookCell(userId: string, weekStart: string) {
    if (!canManage) return;
    const start = weekStart < today ? today : weekStart;
    setDraft(blankAllocation({ userId, projectId, startDate: start, endDate: addDaysKey(start, 13) }));
  }

  /** Grid column span (1-based, after the name column) an allocation covers in the visible window. */
  function span(a: ResourceAllocation): [number, number] | null {
    if (!data) return null;
    const last = addDaysKey(data.to, 0);
    const s = toInputDate(a.startDate);
    const e = a.endDate ? toInputDate(a.endDate) : last;
    if (e < data.from || s > last) return null;
    const startIdx = Math.max(0, Math.floor(diffDaysKey(data.from, s < data.from ? data.from : s) / 7));
    const endIdx = Math.min(data.weeks.length - 1, Math.floor(diffDaysKey(data.from, e > last ? last : e) / 7));
    return [startIdx + 2, endIdx + 3];
  }

  const weekHeader = data && (
    <div className="grid sticky top-0 z-10 bg-[color:var(--bg-surface)] border-b border-[color:var(--border-subtle)]" style={{ gridTemplateColumns: cols }}>
      <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">{view === 'people' ? 'Person' : 'Project'}</div>
      {data.weeks.map((w) => {
        const isNow = w <= today && today <= addDaysKey(w, 6);
        return (
          <div key={w} className={`px-1 py-2 text-center text-[10px] leading-tight ${isNow ? 'text-[color:var(--accent)] font-semibold' : 'text-[color:var(--text-muted)]'}`}>
            {fmtShort(w)}
            {isNow && <div className="text-[9px]">this wk</div>}
          </div>
        );
      })}
    </div>
  );

  return (
    <PageShell
      title="Schedule"
      description="Week-by-week bookings for everyone. Expand a person to see their allocations as bars; click a free week to book them."
      actions={
        <>
          <Link to="/resources/allocations" className={btnSecondary}>
            List view
          </Link>
          {canManage && (
            <button type="button" className={btnPrimary} onClick={() => setDraft(blankAllocation({ projectId }))}>
              <FiPlus /> New allocation
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1">
          <button type="button" className={btnSecondary} onClick={() => setFrom(addDaysKey(from, -7 * Math.max(1, Math.floor(weeks / 2))))} aria-label="Earlier">
            <FiChevronLeft />
          </button>
          <button type="button" className={btnSecondary} onClick={() => setFrom(weekStartKey(today))}>
            Today
          </button>
          <button type="button" className={btnSecondary} onClick={() => setFrom(addDaysKey(from, 7 * Math.max(1, Math.floor(weeks / 2))))} aria-label="Later">
            <FiChevronRight />
          </button>
        </div>
        <Segmented
          value={String(weeks) as '8' | '12' | '26'}
          onChange={(v) => setWeeks(Number(v))}
          options={[
            { value: '8', label: '8 wks' },
            { value: '12', label: '12 wks' },
            { value: '26', label: '26 wks' },
          ]}
        />
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'people', label: 'By person' },
            { value: 'projects', label: 'By project' },
          ]}
        />
        <div className="flex flex-1 flex-wrap justify-end gap-2">
          {options.departments.length > 0 && (
            <select value={department} onChange={(e) => setDepartment(e.target.value)} className={`${inputCls} w-auto`} aria-label="Department">
              <option value="">All departments</option>
              {options.departments.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
          )}
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={`${inputCls} w-auto max-w-[12rem]`} aria-label="Project">
            <option value="">All projects</option>
            {options.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} · {p.name}
              </option>
            ))}
          </select>
          {view === 'people' && (
            <>
              <label className="flex items-center gap-1.5 text-xs text-[color:var(--text-muted)]">
                <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />
                Has free weeks
              </label>
              <input type="search" placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputCls} w-40`} />
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-[color:var(--text-muted)]">
        {(['bench', 'partial', 'busy', 'over'] as LoadLevel[]).map((l) => (
          <span key={l} className="inline-flex items-center gap-1.5">
            <span className="h-3 w-4 rounded-sm" style={{ background: cellBg(l, 60) }} />
            {LEVEL_LABEL[l]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-4 rounded-sm" style={{ background: 'repeating-linear-gradient(45deg,#f59e0b88 0 3px,transparent 3px 6px)' }} />
          Soft booking
        </span>
        <span>Cells show the week’s average committed %; ▲ marks a peak above the limit inside the week.</span>
      </div>

      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && !data ? (
        <LoadingBlock label="Loading schedule…" />
      ) : !data ? null : view === 'people' ? (
        people.length === 0 ? (
          <EmptyState title="No one to show">Try clearing the filters.</EmptyState>
        ) : (
          <div className={`rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-auto max-h-[72vh] ${loading ? 'opacity-60' : ''}`}>
            <div className="min-w-[48rem]">
              {weekHeader}
              {people.map((p) => {
                const open = expanded.has(p.userId);
                return (
                  <Fragment key={p.userId}>
                    <div className="grid border-b border-[color:var(--border-subtle)]/60 hover:bg-[color:var(--bg-elevated)]/30" style={{ gridTemplateColumns: cols }}>
                      <button type="button" onClick={() => toggle(p.userId)} className="flex items-center gap-1.5 px-3 py-2 text-left min-w-0">
                        {open ? <FiChevronDown className="shrink-0" /> : <FiCaret className="shrink-0 opacity-60" />}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{p.name}</span>
                          <span className="block truncate text-[11px] text-[color:var(--text-muted)]">
                            {p.department || p.email} · {p.capacityHoursPerWeek}h/wk
                          </span>
                        </span>
                      </button>
                      {p.weeks.map((w) => {
                        const level = loadLevel(w.hardPct, settings);
                        const free = Math.max(0, 100 - w.hardPct);
                        return (
                          <button
                            type="button"
                            key={w.weekStart}
                            onClick={() => bookCell(p.userId, w.weekStart)}
                            disabled={!canManage}
                            title={`${fmtShort(w.weekStart)}: ${w.hardPct}% committed${w.softPct ? `, ${w.softPct}% soft` : ''}${w.peakPct > w.hardPct ? `, peak ${w.peakPct}%` : ''} · ${Math.round((p.capacityHoursPerWeek * free) / 100)}h free${canManage ? ' — click to book' : ''}`}
                            className="relative m-0.5 rounded-md text-[11px] tabular-nums flex items-center justify-center min-h-[2.25rem] transition hover:ring-1 hover:ring-[color:var(--accent)]/60 disabled:cursor-default"
                            style={{ background: cellBg(level, w.hardPct) }}
                          >
                            {w.softPct > 0 && (
                              <span
                                className="absolute inset-x-0 bottom-0 h-1.5 rounded-b-md"
                                style={{ background: 'repeating-linear-gradient(45deg,#f59e0b 0 3px,transparent 3px 6px)' }}
                              />
                            )}
                            <span className={w.hardPct === 0 ? 'text-[color:var(--text-subtle)]' : level === 'over' ? 'text-red-300 font-semibold' : ''}>
                              {w.hardPct === 0 ? '·' : `${w.hardPct}`}
                            </span>
                            {w.peakPct > settings.overAllocationPct && level !== 'over' && <span className="absolute top-0.5 right-1 text-[8px] text-red-400">▲</span>}
                          </button>
                        );
                      })}
                    </div>
                    {open && (
                      <div className="border-b border-[color:var(--border-subtle)]/60 bg-[color:var(--bg-page)]/40 py-1.5">
                        {p.allocations.length === 0 ? (
                          <p className="px-4 py-2 text-xs text-[color:var(--text-muted)]">No allocations in this window.</p>
                        ) : (
                          p.allocations.map((a) => {
                            const sp = span(a);
                            if (!sp) return null;
                            return (
                              <div key={a._id} className="grid items-center" style={{ gridTemplateColumns: cols }}>
                                <div className="px-3 pl-9 text-[11px] text-[color:var(--text-muted)] truncate">{a.roleLabel || refName(a.projectId as never, false)}</div>
                                <button
                                  type="button"
                                  disabled={!canManage}
                                  onClick={() => setDraft(draftFromAllocation(a))}
                                  style={{
                                    gridColumn: `${sp[0]} / ${sp[1]}`,
                                    background: a.softBooked
                                      ? 'repeating-linear-gradient(45deg, color-mix(in srgb,#f59e0b 35%,transparent) 0 6px, color-mix(in srgb,#f59e0b 15%,transparent) 6px 12px)'
                                      : 'color-mix(in srgb, var(--accent) 28%, transparent)',
                                  }}
                                  className="m-0.5 h-6 rounded-md px-2 text-[11px] text-left truncate border border-[color:var(--accent)]/30 hover:border-[color:var(--accent)] disabled:cursor-default"
                                  title={`${refName(a.projectId as never)} · ${a.percent}% · ${fmtShort(a.startDate)} → ${a.endDate ? fmtShort(a.endDate) : 'open'}${a.softBooked ? ' (soft)' : ''}`}
                                >
                                  <b>{(a.projectId as { key?: string })?.key ?? refName(a.projectId as never)}</b> {a.percent}%
                                </button>
                              </div>
                            );
                          })
                        )}
                        <div className="px-9 pt-1 flex gap-3 text-[11px]">
                          <Link to={`/resources/allocations?userId=${p.userId}`} className="text-[color:var(--accent)] hover:underline">
                            All allocations →
                          </Link>
                          <Link to={`/resources/engagement`} className="text-[color:var(--accent)] hover:underline">
                            Task engagement →
                          </Link>
                        </div>
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </div>
        )
      ) : data.projects.length === 0 ? (
        <EmptyState title="No project bookings in this window" />
      ) : (
        <div className={`rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-auto max-h-[72vh] ${loading ? 'opacity-60' : ''}`}>
          <div className="min-w-[48rem]">
            {weekHeader}
            {data.projects.map((p) => {
              const max = Math.max(1, ...p.weeksFte);
              return (
                <div key={p.projectId} className="grid border-b border-[color:var(--border-subtle)]/60" style={{ gridTemplateColumns: cols }}>
                  <Link to={`/resources/allocations?projectId=${p.projectId}`} className="px-3 py-2 min-w-0 hover:text-[color:var(--accent)]">
                    <span className="block truncate text-sm font-medium">{p.key ? `${p.key} · ${p.name ?? ''}` : p.name}</span>
                    <span className="block text-[11px] text-[color:var(--text-muted)]">{p.people} people booked</span>
                  </Link>
                  {p.weeksFte.map((fte, i) => (
                    <div
                      key={i}
                      className="relative m-0.5 flex items-end rounded-md min-h-[2.25rem] bg-[color:var(--bg-elevated)]/40 overflow-hidden"
                      title={`${fmtShort(data.weeks[i])}: ${fte} FTE`}
                    >
                      <div className="w-full bg-[color:var(--accent)]/45" style={{ height: `${(fte / max) * 100}%` }} />
                      <span className="absolute inset-0 flex items-center justify-center text-[10px] tabular-nums">{fte > 0 ? fte : ''}</span>
                    </div>
                  ))}
                </div>
              );
            })}
            <p className="px-3 py-2 text-[11px] text-[color:var(--text-muted)]">Values are committed FTE (sum of hard-booked % ÷ 100) averaged over each week.</p>
          </div>
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
      <Toast message={toast} onDone={() => setToast('')} />
    </PageShell>
  );
}

