import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import MetricCard from '../../components/MetricCard';
import SectionCard from '../../components/SectionCard';
import {
  resourcesApi,
  type EngagementDay,
  type EngagementLevel,
  type EngagementPerson,
  type EngagementReport,
  type EngagementHoursSource,
  type ResourceSettingsRow,
} from '../../lib/api';

/* ─── Date helpers (day keys are UTC YYYY-MM-DD, matching the API) ───────── */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Ranges longer than this switch the heatmap to one column per week. */
const WEEKLY_AFTER_DAYS = 42;
const OVER_COLOR = '#d03b3b';

function localTodayKey(): string {
  return new Date().toLocaleDateString('en-CA');
}

function addDays(key: string, n: number): string {
  return new Date(new Date(`${key}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

function diffDays(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / DAY_MS);
}

function fmtDay(key: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  if (!key) return '—';
  return new Date(`${key.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', ...opts });
}

function relDay(key: string | null, today: string): string {
  if (!key) return '';
  const d = diffDays(today, key.slice(0, 10));
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d > 1) return `in ${d} days`;
  return `${-d} days ago`;
}

const PRESETS: Array<{ label: string; range: (today: string) => [string, string] }> = [
  {
    label: 'This week',
    range: (t) => {
      const dow = new Date(`${t}T00:00:00Z`).getUTCDay();
      const monday = addDays(t, -((dow + 6) % 7));
      return [monday, addDays(monday, 6)];
    },
  },
  { label: 'Next 2 weeks', range: (t) => [t, addDays(t, 13)] },
  { label: 'Next 4 weeks', range: (t) => [t, addDays(t, 27)] },
  { label: 'Next quarter', range: (t) => [t, addDays(t, 90)] },
];

/* ─── Cell styling ───────────────────────────────────────────────────────── */

type Cell = {
  key: string;
  label: string;
  sub: string;
  kind: EngagementDay['kind'] | 'mixed';
  level: EngagementLevel;
  pct: number;
  days: EngagementDay[];
  isToday: boolean;
  pending: boolean;
};

const LEVEL_LABEL: Record<EngagementLevel, string> = {
  off: 'Off',
  free: 'Available',
  partial: 'Partially busy',
  busy: 'Busy',
  over: 'Over-booked',
};

function cellStyle(cell: Pick<Cell, 'kind' | 'level' | 'pct' | 'pending'>): React.CSSProperties {
  if (cell.kind === 'leave' || cell.kind === 'holiday') {
    return {
      background:
        'repeating-linear-gradient(45deg, var(--bg-elevated) 0 3px, color-mix(in srgb, var(--text-muted) 28%, var(--bg-elevated)) 3px 5px)',
    };
  }
  if (cell.level === 'off') return { background: 'color-mix(in srgb, var(--bg-elevated) 70%, transparent)' };
  if (cell.level === 'over') return { background: OVER_COLOR };
  // One-hue sequential ramp mixed from the theme accent, so it reads in light and dark mode.
  const strength = cell.pct <= 0 ? 6 : Math.min(92, 14 + cell.pct * 0.78);
  return {
    background: `color-mix(in srgb, var(--accent) ${strength}%, var(--bg-surface))`,
    ...(cell.pending ? { outline: '1.5px dashed var(--text-muted)', outlineOffset: -2 } : {}),
  };
}

function cellGlyph(cell: Cell): string {
  if (cell.kind === 'leave') return 'L';
  if (cell.kind === 'holiday') return 'H';
  if (cell.level === 'over') return '!';
  return '';
}

function levelFromPct(pct: number, threshold: number, busy: number): EngagementLevel {
  if (pct > 100) return 'over';
  if (pct >= busy) return 'busy';
  if (pct >= threshold) return 'partial';
  return 'free';
}

function buildCells(days: EngagementDay[], weekly: boolean, today: string, threshold: number, busy: number): Cell[] {
  if (!weekly) {
    return days.map((d) => ({
      key: d.date,
      label: fmtDay(d.date, { weekday: 'narrow' }),
      sub: fmtDay(d.date, { day: 'numeric' }),
      kind: d.kind,
      level: d.level,
      pct: d.engagementPct,
      days: [d],
      isToday: d.date === today,
      pending: Boolean(d.note && d.kind === 'work'),
    }));
  }
  const cells: Cell[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    const working = chunk.filter((d) => d.level !== 'off');
    const pct = working.length ? Math.round(working.reduce((s, d) => s + d.engagementPct, 0) / working.length) : 0;
    const leaveDays = chunk.filter((d) => d.kind === 'leave' || d.kind === 'holiday').length;
    const allOff = working.length === 0;
    cells.push({
      key: chunk[0].date,
      label: fmtDay(chunk[0].date, { day: 'numeric', month: 'short' }),
      sub: 'wk',
      kind: allOff && leaveDays > 0 ? 'leave' : 'mixed',
      level: allOff ? 'off' : working.some((d) => d.level === 'over') && pct > 100 ? 'over' : levelFromPct(pct, threshold, busy),
      pct,
      days: chunk,
      isToday: chunk.some((d) => d.date === today),
      pending: false,
    });
  }
  return cells;
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

type SortKey = 'busiest' | 'freeSoonest' | 'name';

export default function ResourcesEngagement() {
  const { token, user } = useAuth();
  const workspaceKey = user?.activeOrganizationId ?? '';
  const today = localTodayKey();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 27));
  const [projectId, setProjectId] = useState('');
  const [threshold, setThreshold] = useState(20);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('busiest');
  const [view, setView] = useState<'heatmap' | 'table'>('heatmap');
  const [focusDate, setFocusDate] = useState(today);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; key: string }>>([]);
  const [data, setData] = useState<EngagementReport | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const canManageSettings = canAny(user, 'taskflow.resources.settings.manage', 'taskflow.resources.allocation.manage');
  const [tip, setTip] = useState<{ x: number; y: number; person: EngagementPerson; cell: Cell } | null>(null);

  useEffect(() => {
    if (!token) return;
    resourcesApi.options(token).then((res) => {
      if (res.success && res.data) setProjects(res.data.projects);
    });
  }, [token, workspaceKey]);

  const requestKey = [from, to, projectId, threshold, workspaceKey, reloadTick].join('|');
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    if (!token) return;
    let stale = false;
    resourcesApi
      .engagement(token, { from, to, projectId, threshold: String(threshold) })
      .then((res) => {
        if (stale) return;
        setLoadedKey(requestKey);
        if (res.success && res.data) {
          setData(res.data);
          setError('');
        } else setError((res as { message?: string }).message ?? 'Failed to load engagement');
      });
    return () => {
      stale = true;
    };
  }, [token, from, to, projectId, threshold, requestKey]);

  function applyRange(f: string, t: string) {
    setFrom(f);
    setTo(t);
    if (focusDate < f || focusDate > t) setFocusDate(f <= today && today <= t ? today : f);
  }

  /** Picking a snapshot date outside the loaded range moves the range to start there. */
  function pickFocusDate(d: string) {
    if (!d) return;
    setFocusDate(d);
    if (d < from || d > to) {
      const len = Math.max(6, diffDays(from, to));
      setFrom(d);
      setTo(addDays(d, len));
    }
  }

  const weekly = diffDays(from, to) + 1 > WEEKLY_AFTER_DAYS;

  const people = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const rows = data.people.filter(
      (p) => !q || p.name?.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q) || p.department?.toLowerCase().includes(q)
    );
    const freeKey = (p: EngagementPerson) => p.summary.nextAvailable ?? '9999-12-31';
    return [...rows].sort((a, b) => {
      if (sort === 'name') return (a.name ?? '').localeCompare(b.name ?? '');
      if (sort === 'freeSoonest') return freeKey(a).localeCompare(freeKey(b)) || a.summary.avgEngagement - b.summary.avgEngagement;
      return b.summary.avgEngagement - a.summary.avgEngagement;
    });
  }, [data, search, sort]);

  const focusIdx = data ? diffDays(data.from, focusDate) : -1;
  const snapshot = useMemo(() => {
    if (!data || focusIdx < 0 || focusIdx >= data.team.length) return null;
    const groups: Record<'over' | 'busy' | 'partial' | 'free' | 'away', Array<{ p: EngagementPerson; d: EngagementDay }>> = {
      over: [],
      busy: [],
      partial: [],
      free: [],
      away: [],
    };
    for (const p of people) {
      const d = p.days[focusIdx];
      if (!d) continue;
      if (d.level === 'off') groups.away.push({ p, d });
      else groups[d.level].push({ p, d });
    }
    for (const g of Object.values(groups)) g.sort((a, b) => b.d.engagementPct - a.d.engagementPct);
    return { team: data.team[focusIdx], groups };
  }, [data, focusIdx, people]);

  const inputCls =
    'px-2.5 py-1.5 rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm';

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-5">
      {/* Header + controls */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Team engagement</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">
            How busy each person is on any date — today or planned ahead — and when they free up.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[color:var(--border-subtle)] p-1 bg-[color:var(--bg-surface)]">
          {PRESETS.map((p) => {
            const [f, t] = p.range(today);
            const active = f === from && t === to;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => applyRange(f, t)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[color:var(--accent)] text-white'
                    : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)]'
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-[color:var(--text-muted)] flex flex-col gap-1">
          From
          <input type="date" className={inputCls} value={from} onChange={(e) => e.target.value && applyRange(e.target.value, to < e.target.value ? e.target.value : to)} />
        </label>
        <label className="text-xs text-[color:var(--text-muted)] flex flex-col gap-1">
          To
          <input type="date" className={inputCls} value={to} min={from} onChange={(e) => e.target.value && applyRange(from, e.target.value)} />
        </label>
        <label className="text-xs text-[color:var(--text-muted)] flex flex-col gap-1">
          Project
          <select className={`${inputCls} max-w-[14rem]`} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} · {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[color:var(--text-muted)] flex flex-col gap-1">
          “Available” means below
          <select className={inputCls} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
            {[10, 20, 30, 50].map((v) => (
              <option key={v} value={v}>
                {v}% busy
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-[color:var(--text-muted)] flex flex-col gap-1">
          Sort
          <select className={inputCls} value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="busiest">Busiest first</option>
            <option value="freeSoonest">Free soonest</option>
            <option value="name">Name</option>
          </select>
        </label>
        <input
          type="search"
          placeholder="Search people…"
          className={`${inputCls} w-48`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-500">{error}</div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <MetricCard
          title="Avg engagement"
          value={`${data?.summary.avgEngagement ?? 0}%`}
          helperText={`${fmtDay(data?.from)} – ${fmtDay(data?.to)}`}
          loading={loading && !data}
        />
        <MetricCard
          title="Over-booked people"
          value={data?.summary.overbookedPeople ?? 0}
          helperText="> 100% on at least one day"
          loading={loading && !data}
        />
        <MetricCard
          title="Spare capacity"
          value={`${Math.round(data?.summary.availableHours ?? 0)}h`}
          helperText="Unbooked hours in range"
          loading={loading && !data}
        />
        <MetricCard
          title={`Available ${focusDate === today ? 'today' : fmtDay(focusDate)}`}
          value={snapshot ? `${snapshot.groups.free.length} / ${people.length}` : '—'}
          helperText={`Below ${threshold}% busy`}
          loading={loading && !data}
        />
        <MetricCard
          title="Overdue · undated tasks"
          value={`${data?.summary.overdueTasks ?? 0} · ${data?.summary.unscheduledTasks ?? 0}`}
          helperText="Not placed on the calendar"
          loading={loading && !data}
        />
      </div>

      {data && (
        <EstimateCoverage
          report={data}
          canManage={canManageSettings}
          token={token}
          onSaved={() => setReloadTick((n) => n + 1)}
        />
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_20rem] gap-5 items-start">
        {/* Heatmap / table */}
        <SectionCard
          title={view === 'heatmap' ? 'Engagement by day' : 'Engagement summary'}
          description={
            view === 'heatmap'
              ? `${weekly ? 'Weekly averages' : 'Daily'} · click a date to see who's free · click a person for detail`
              : 'Per-person totals for the selected range'
          }
          actions={
            <div className="flex rounded-lg border border-[color:var(--border-subtle)] p-0.5">
              {(['heatmap', 'table'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize ${
                    view === v ? 'bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)]' : 'text-[color:var(--text-muted)]'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          }
        >
          {loading && !data ? (
            <div className="h-64 rounded-lg skeleton" />
          ) : !data || people.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sm text-[color:var(--text-muted)]">
              No people match these filters.
            </div>
          ) : view === 'table' ? (
            <SummaryTable people={people} today={data.today} />
          ) : (
            <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
              <Legend threshold={data.threshold} busy={data.busyPct} />
              <div className="overflow-x-auto -mx-2 px-2">
                <table className="border-separate" style={{ borderSpacing: 2 }}>
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-[color:var(--bg-surface)] min-w-[13rem]" />
                      {buildCells(people[0].days, weekly, data.today, data.threshold, data.busyPct).map((c, i) => {
                        const selected = weekly
                          ? c.days.some((d) => d.date === focusDate)
                          : c.key === focusDate;
                        const holiday = !weekly ? data.team[i]?.holiday : undefined;
                        return (
                          <th key={c.key} className="p-0 font-normal">
                            <button
                              type="button"
                              title={holiday ? `${fmtDay(c.key, { dateStyle: 'full' })} · ${holiday}` : fmtDay(c.key, { dateStyle: 'full' })}
                              onClick={() => setFocusDate(c.key)}
                              className={`flex flex-col items-center justify-center rounded-md leading-tight ${weekly ? 'w-12' : 'w-7'} h-9 text-[10px] ${
                                selected
                                  ? 'bg-[color:var(--accent)] text-white'
                                  : c.isToday
                                    ? 'text-[color:var(--accent)] font-semibold'
                                    : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]'
                              }`}
                            >
                              <span>{c.label}</span>
                              <span className="font-semibold">{c.sub}</span>
                            </button>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((p) => {
                      const cells = buildCells(p.days, weekly, data.today, data.threshold, data.busyPct);
                      const isOpen = expanded === p.userId;
                      return (
                        <Fragment key={p.userId}>
                          <tr>
                            <td className="sticky left-0 z-10 bg-[color:var(--bg-surface)] pr-3 py-0.5">
                              <button
                                type="button"
                                onClick={() => setExpanded(isOpen ? null : p.userId)}
                                className="w-full text-left flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-[color:var(--bg-elevated)]"
                                aria-expanded={isOpen}
                              >
                                <Avatar name={p.name} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-medium text-[color:var(--text-primary)]">
                                    {p.name}
                                  </span>
                                  <span className="block truncate text-[11px] text-[color:var(--text-muted)]">
                                    {p.summary.avgEngagement}% avg · <FreeText person={p} today={data.today} short />
                                  </span>
                                </span>
                              </button>
                            </td>
                            {cells.map((c) => (
                              <td key={c.key} className="p-0">
                                <div
                                  role="img"
                                  aria-label={`${p.name}, ${fmtDay(c.key)}: ${c.level === 'off' ? 'off' : `${c.pct}% ${LEVEL_LABEL[c.level]}`}`}
                                  onMouseEnter={(e) => setTip({ x: e.clientX, y: e.clientY, person: p, cell: c })}
                                  onMouseMove={(e) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))}
                                  onMouseLeave={() => setTip(null)}
                                  onClick={() => setFocusDate(c.key)}
                                  className={`${weekly ? 'w-12' : 'w-7'} h-7 rounded-[4px] flex items-center justify-center text-[10px] font-bold cursor-pointer ${
                                    c.level === 'over' || c.pct >= 70 ? 'text-white' : 'text-[color:var(--text-muted)]'
                                  } ${c.isToday ? 'ring-1 ring-[color:var(--accent)]' : ''}`}
                                  style={cellStyle(c)}
                                >
                                  {cellGlyph(c)}
                                </div>
                              </td>
                            ))}
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={cells.length + 1} className="pb-3">
                                <PersonDetail person={p} today={data.today} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </SectionCard>

        {/* Snapshot for a single date */}
        <SectionCard
          title={`On ${fmtDay(focusDate, { weekday: 'short', day: 'numeric', month: 'short' })}`}
          description={focusDate === today ? 'Today' : relDay(focusDate, today)}
          actions={<input type="date" className={`${inputCls} text-xs`} value={focusDate} onChange={(e) => pickFocusDate(e.target.value)} />}
        >
          {!snapshot ? (
            <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
          ) : !snapshot.team.working ? (
            <p className="text-sm text-[color:var(--text-muted)]">
              Non-working day{snapshot.team.holiday ? ` — ${snapshot.team.holiday}` : ''}.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-[color:var(--text-primary)]">{snapshot.team.avgEngagement}%</span>
                <span className="text-xs text-[color:var(--text-muted)]">team average</span>
              </div>
              <SnapshotGroup title="Available" hint={`below ${data?.threshold}%`} rows={snapshot.groups.free} />
              <SnapshotGroup title="Partially busy" rows={snapshot.groups.partial} />
              <SnapshotGroup title="Busy" hint={`${data?.busyPct}%+`} rows={snapshot.groups.busy} />
              <SnapshotGroup title="Over-booked" hint="over 100%" rows={snapshot.groups.over} danger />
              <SnapshotGroup title="Away" rows={snapshot.groups.away} />
            </div>
          )}
        </SectionCard>
      </div>

      {tip && <CellTooltip {...tip} />}
    </div>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────────────── */

function Avatar({ name }: { name: string }) {
  const initials = (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span className="shrink-0 w-7 h-7 rounded-full bg-[color:var(--accent-subtle)] text-[color:var(--accent)] text-[11px] font-semibold flex items-center justify-center">
      {initials}
    </span>
  );
}

function FreeText({ person, today, short = false }: { person: EngagementPerson; today: string; short?: boolean }) {
  const s = person.summary;
  if (s.freeFrom && s.freeFrom <= today) return <span>free now</span>;
  if (s.freeFrom) return <span>free from {fmtDay(s.freeFrom)}</span>;
  if (s.busyThroughRangeEnd) {
    if (s.openEndedAllocation) return <span>{short ? 'busy, no end date' : 'Busy with an open-ended allocation'}</span>;
    if (s.commitmentsEnd) return <span>busy until {fmtDay(s.commitmentsEnd, { day: 'numeric', month: 'short', year: 'numeric' })}</span>;
    return <span>busy past range</span>;
  }
  return <span>—</span>;
}

function Legend({ threshold, busy }: { threshold: number; busy: number }) {
  const items: Array<{ label: string; style: React.CSSProperties; glyph?: string }> = [
    { label: `Available (<${threshold}%)`, style: cellStyle({ kind: 'work', level: 'free', pct: 5, pending: false }) },
    { label: 'Partial', style: cellStyle({ kind: 'work', level: 'partial', pct: 50, pending: false }) },
    { label: `Busy (${busy}–100%)`, style: cellStyle({ kind: 'work', level: 'busy', pct: 95, pending: false }) },
    { label: 'Over-booked', style: cellStyle({ kind: 'work', level: 'over', pct: 120, pending: false }), glyph: '!' },
    { label: 'Leave / holiday', style: cellStyle({ kind: 'leave', level: 'off', pct: 0, pending: false }), glyph: 'L' },
    { label: 'Weekend', style: cellStyle({ kind: 'weekend', level: 'off', pct: 0, pending: false }) },
    { label: 'Leave pending', style: cellStyle({ kind: 'work', level: 'free', pct: 0, pending: true }) },
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-3 text-[11px] text-[color:var(--text-muted)]">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-[3px] flex items-center justify-center text-[8px] font-bold text-white" style={i.style}>
            {i.glyph === '!' ? '!' : ''}
          </span>
          {i.label}
        </span>
      ))}
    </div>
  );
}

function CellTooltip({ x, y, person, cell }: { x: number; y: number; person: EngagementPerson; cell: Cell }) {
  const single = cell.days.length === 1 ? cell.days[0] : null;
  const left = Math.min(x + 14, window.innerWidth - 260);
  const top = Math.min(y + 14, window.innerHeight - 180);
  return (
    <div
      className="fixed z-50 w-60 pointer-events-none rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-lg px-3 py-2 text-xs"
      style={{ left, top }}
    >
      <div className="font-semibold text-[color:var(--text-primary)]">{person.name}</div>
      <div className="text-[color:var(--text-muted)] mb-1.5">
        {single
          ? fmtDay(cell.key, { weekday: 'long', day: 'numeric', month: 'short' })
          : `Week of ${fmtDay(cell.key)}`}
      </div>
      {single && single.level === 'off' ? (
        <div className="text-[color:var(--text-primary)]">
          {single.kind === 'leave' ? 'On leave' : single.kind === 'holiday' ? `Holiday${single.note ? ` — ${single.note}` : ''}` : 'Weekend'}
        </div>
      ) : (
        <div className="space-y-0.5 text-[color:var(--text-primary)]">
          <Row k="Engagement" v={`${cell.pct}% · ${LEVEL_LABEL[cell.level]}`} />
          {single && (
            <>
              <Row k="Allocated" v={`${single.allocatedPct}%${single.softPct ? ` (+${single.softPct}% soft)` : ''}`} />
              <Row k="Tasks" v={`${single.taskCount} · ${single.taskHours}h of ${single.capacityHours}h`} />
              {single.overdueHours > 0 && <Row k="Catching up" v={`${single.overdueHours}h overdue work`} />}
              {single.kind === 'half_leave' && <Row k="Note" v="Half-day leave" />}
              {single.note && single.kind === 'work' && <Row k="Note" v={single.note} />}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[color:var(--text-muted)]">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}

function SnapshotGroup({
  title,
  hint,
  rows,
  danger = false,
}: {
  title: string;
  hint?: string;
  rows: Array<{ p: EngagementPerson; d: EngagementDay }>;
  danger?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)] mb-1.5">
        <span>
          {danger && <span className="mr-1" style={{ color: OVER_COLOR }}>⚠</span>}
          {title} {hint && <span className="normal-case font-normal tracking-normal">· {hint}</span>}
        </span>
        <span>{rows.length}</span>
      </div>
      <ul className="space-y-1">
        {rows.map(({ p, d }) => (
          <li key={p.userId} className="flex items-center gap-2 text-[13px]">
            <Avatar name={p.name} />
            <span className="flex-1 truncate text-[color:var(--text-primary)]">{p.name}</span>
            <span className="text-xs tabular-nums text-[color:var(--text-muted)]">
              {d.level === 'off' ? (d.kind === 'leave' ? 'Leave' : d.kind === 'holiday' ? 'Holiday' : 'Off') : `${d.engagementPct}%`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PersonDetail({ person, today }: { person: EngagementPerson; today: string }) {
  const s = person.summary;
  const stats: Array<[string, string]> = [
    ['Avg / peak', `${s.avgEngagement}% / ${s.peakEngagement}%`],
    ['Next available day', s.nextAvailable ? `${fmtDay(s.nextAvailable)} (${relDay(s.nextAvailable, today)})` : 'Not in range'],
    ['Remaining task work', `${s.remainingHours}h${s.noEstimateTasks ? ` · ${s.noEstimateTasks} unestimated` : ''}`],
    ['Tasks clear by', s.unplacedHours > 0 ? 'After this range' : s.tasksClearOn ? fmtDay(s.tasksClearOn, { day: 'numeric', month: 'short', year: 'numeric' }) : 'No dated work'],
    ['Commitments end', s.openEndedAllocation ? 'Open-ended allocation' : s.unplacedHours > 0 ? 'After this range' : s.commitmentsEnd ? fmtDay(s.commitmentsEnd, { day: 'numeric', month: 'short', year: 'numeric' }) : 'None'],
    ['Spare hours', `${s.availableHours}h`],
    ['Busy / free days', `${s.busyDays} / ${s.freeDays}`],
    ['Leave days', String(s.leaveDays)],
  ];
  const scheduleTone: Record<string, string> = {
    overdue: 'text-red-500',
    scheduled: 'text-[color:var(--text-muted)]',
    unscheduled: 'text-amber-500',
  };
  return (
    <div className="mt-1 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-4 space-y-4 max-w-4xl sticky left-0">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map(([k, v]) => (
          <div key={k}>
            <div className="text-[11px] text-[color:var(--text-muted)]">{k}</div>
            <div className="text-[13px] font-medium text-[color:var(--text-primary)]">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-xs font-semibold text-[color:var(--text-primary)] mb-2">Allocations in range</h4>
          {person.allocations.length === 0 ? (
            <p className="text-xs text-[color:var(--text-muted)]">No project allocations.</p>
          ) : (
            <ul className="space-y-1.5">
              {person.allocations.map((a) => (
                <li key={a.allocationId} className="text-xs flex items-center justify-between gap-2">
                  <span className="truncate text-[color:var(--text-primary)]">
                    <span className="font-medium">{a.key ?? a.name}</span>
                    {a.roleLabel && <span className="text-[color:var(--text-muted)]"> · {a.roleLabel}</span>}
                    {a.softBooked && <span className="ml-1 text-[color:var(--text-muted)] italic">soft</span>}
                  </span>
                  <span className="shrink-0 tabular-nums text-[color:var(--text-muted)]">
                    {a.percent}% · {fmtDay(a.startDate)} → {a.endDate ? fmtDay(a.endDate) : 'open'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-xs font-semibold text-[color:var(--text-primary)] mb-2">
            Open tasks <span className="font-normal text-[color:var(--text-muted)]">({person.tasks.length})</span>
          </h4>
          {person.tasks.length === 0 ? (
            <p className="text-xs text-[color:var(--text-muted)]">No open assigned issues.</p>
          ) : (
            <ul className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
              {person.tasks.map((t) => (
                <li key={`${t.issueId}|${t.lane ?? ''}`} className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      to={t.project ? `/projects/${t.project.id}/issues/${t.key ?? t.issueId}` : '/issues'}
                      className="truncate text-[color:var(--text-primary)] hover:text-[color:var(--accent)]"
                    >
                      <span className="font-mono text-[color:var(--text-muted)] mr-1">{t.key}</span>
                      {t.title}
                    </Link>
                    <span className={`shrink-0 tabular-nums ${scheduleTone[t.schedule]}`}>
                      {t.schedule === 'unscheduled'
                        ? 'No deadline'
                        : `${t.schedule === 'overdue' ? 'Overdue · ' : ''}${fmtDay(t.windowEnd)}${t.windowSource !== 'due' ? ` (${t.windowSource})` : ''}`}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-[color:var(--text-muted)]">
                    {t.lane && <span className="rounded bg-[color:var(--accent-subtle)] text-[color:var(--accent)] px-1">{t.lane} stage</span>}
                    <span>{t.status}</span>
                    <span>·</span>
                    {t.hoursSource === 'none' ? (
                      <span className="text-amber-500">no estimate</span>
                    ) : (
                      <span className="tabular-nums">
                        {t.remainingHours}h left of {t.estimateHours}h
                        <span className="opacity-70"> ({SOURCE_LABEL[t.hoursSource]})</span>
                      </span>
                    )}
                    {t.overEstimate && <span className="text-amber-500">· over estimate ({t.loggedHours}h logged)</span>}
                    {t.unplacedHours > 0 && <span className="text-red-500">· {t.unplacedHours}h beyond range</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {(s.overdueHours > 0 || s.unscheduledHours > 0) && (
            <p className="mt-2 text-[11px] text-[color:var(--text-muted)]">
              {s.overdueHours > 0 && <>{s.overdueHours}h overdue work is scheduled into spare time from today. </>}
              {s.unscheduledHours > 0 && <>{s.unscheduledHours}h of work has no due date, sprint or milestone, so it isn't on the calendar.</>}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryTable({ people, today }: { people: EngagementPerson[]; today: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[color:var(--border-subtle)] text-[color:var(--text-muted)] text-xs">
            <th className="px-3 py-2 font-medium">Person</th>
            <th className="px-3 py-2 font-medium text-right">Avg</th>
            <th className="px-3 py-2 font-medium text-right">Peak</th>
            <th className="px-3 py-2 font-medium text-right">Over-booked days</th>
            <th className="px-3 py-2 font-medium text-right">Spare hours</th>
            <th className="px-3 py-2 font-medium text-right">Open tasks</th>
            <th className="px-3 py-2 font-medium text-right">Work left</th>
            <th className="px-3 py-2 font-medium">Next available</th>
            <th className="px-3 py-2 font-medium">Free</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--border-subtle)]">
          {people.map((p) => (
            <tr key={p.userId}>
              <td className="px-3 py-2">
                <div className="text-[color:var(--text-primary)] font-medium">{p.name}</div>
                {p.department && <div className="text-[11px] text-[color:var(--text-muted)]">{p.department}</div>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{p.summary.avgEngagement}%</td>
              <td className="px-3 py-2 text-right tabular-nums">{p.summary.peakEngagement}%</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {p.summary.overbookedDays > 0 ? (
                  <span style={{ color: OVER_COLOR }}>⚠ {p.summary.overbookedDays}</span>
                ) : (
                  0
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{p.summary.availableHours}h</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {p.summary.openTasks}
                {p.summary.overdueTasks > 0 && <span className="text-red-500 text-xs"> ({p.summary.overdueTasks} overdue)</span>}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {p.summary.remainingHours}h
                {p.summary.noEstimateTasks > 0 && (
                  <span className="text-amber-500 text-xs"> (+{p.summary.noEstimateTasks} unestimated)</span>
                )}
              </td>
              <td className="px-3 py-2 text-[13px]">
                {p.summary.nextAvailable ? `${fmtDay(p.summary.nextAvailable)} · ${relDay(p.summary.nextAvailable, today)}` : '—'}
              </td>
              <td className="px-3 py-2 text-[13px] text-[color:var(--text-muted)]">
                <FreeText person={p} today={today} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SOURCE_LABEL: Record<EngagementHoursSource, string> = {
  stage: 'stage estimate',
  estimate: 'time estimate',
  points: 'story points',
  default: 'default hours',
  none: 'no estimate',
};

/** Shows where task hours come from, and lets planners tune the fallbacks. */
function EstimateCoverage({
  report,
  canManage,
  token,
  onSaved,
}: {
  report: EngagementReport;
  canManage: boolean;
  token: string | null;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ points: string; fallback: string; pending: boolean }>({
    points: '',
    fallback: '',
    pending: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const total = report.summary.openTasks;
  const counts = report.summary.hoursSources.filter((h) => h.tasks > 0);
  const unestimated = report.summary.noEstimateTasks;

  function edit() {
    const cur: ResourceSettingsRow = report.settings;
    setForm({
      points: cur.hoursPerStoryPoint == null ? '' : String(cur.hoursPerStoryPoint),
      fallback: cur.defaultTaskHours == null ? '' : String(cur.defaultTaskHours),
      pending: cur.includePendingStageEstimates,
    });
    setError('');
    setOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    const res = await resourcesApi.updateSettings(
      {
        hoursPerStoryPoint: form.points === '' ? null : Number(form.points),
        defaultTaskHours: form.fallback === '' ? null : Number(form.fallback),
        includePendingStageEstimates: form.pending,
      },
      token
    );
    setSaving(false);
    if (!res.success) {
      setError((res as { message?: string }).message ?? 'Failed to save');
      return;
    }
    setOpen(false);
    onSaved();
  }

  const fieldCls =
    'w-20 px-2 py-1 rounded-md bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm';

  return (
    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-4 py-2.5 text-xs text-[color:var(--text-muted)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-[color:var(--text-primary)]">Task load is based on {total} open tasks:</span>
        {counts.length === 0 && <span>none assigned in this scope</span>}
        {counts.map((c) => (
          <span key={c.source} className={c.source === 'none' ? 'text-amber-500' : ''}>
            {c.tasks} {SOURCE_LABEL[c.source]}
            {c.source === 'none' ? ' (counted as 0h)' : ''}
          </span>
        ))}
        <span className="opacity-80">· deadlines use due date, then sprint end, then milestone</span>
        {canManage && (
          <button type="button" onClick={() => (open ? setOpen(false) : edit())} className="ml-auto text-[color:var(--accent)] hover:underline">
            {open ? 'Close' : 'Estimate settings'}
          </button>
        )}
      </div>
      {!canManage && unestimated > 0 && report.settings.hoursPerStoryPoint == null && report.settings.defaultTaskHours == null && (
        <p className="mt-1">Ask a resource manager to set story-point or default hours so unestimated tasks are counted.</p>
      )}
      {open && (
        <form onSubmit={save} className="mt-3 pt-3 border-t border-[color:var(--border-subtle)] flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            Hours per story point
            <input type="number" min={0} max={200} step="0.5" className={fieldCls} placeholder="off" value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            Hours for unestimated tasks
            <input type="number" min={0} max={200} step="0.5" className={fieldCls} placeholder="off" value={form.fallback} onChange={(e) => setForm({ ...form, fallback: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 pb-1.5">
            <input type="checkbox" checked={form.pending} onChange={(e) => setForm({ ...form, pending: e.target.checked })} />
            Count stage estimates awaiting approval
          </label>
          <button type="submit" disabled={saving} className="btn-primary px-3 py-1.5 rounded-lg text-sm disabled:opacity-60">
            {saving ? 'Saving…' : 'Save for workspace'}
          </button>
          <span className="basis-full">Leave a field empty to turn it off. Applies to everyone viewing this workspace.</span>
          {error && <span className="basis-full text-red-500">{error}</span>}
        </form>
      )}
    </div>
  );
}
