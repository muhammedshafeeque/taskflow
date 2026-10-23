import { Fragment, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import {
  FiAlertTriangle,
  FiCheck,
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiEdit2,
  FiGrid,
  FiHash,
  FiLayers,
  FiList,
  FiPlus,
  FiSearch,
  FiTrash2,
  FiUsers,
  FiX,
} from 'react-icons/fi';
import ConfirmModal from '../../components/ConfirmModal';
import {
  Chip,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  PageShell,
  Segmented,
  TeamChip,
  Toast,
  btnPrimary,
  btnSecondary,
  errorOf,
  inputCls as kitInputCls,
  teamColor,
} from './resourceKit';
import {
  resourcesApi,
  type EngagementEntryRow,
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
  if (d === -1) return 'yesterday';
  if (d > 1) return `in ${d} days`;
  return `${-d} days ago`;
}

function weekday(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

const PRESETS: Array<{ id: string; label: string; range: (today: string) => [string, string] }> = [
  {
    id: 'week',
    label: 'This week',
    range: (t) => {
      const monday = addDays(t, -((weekday(t) + 6) % 7));
      return [monday, addDays(monday, 6)];
    },
  },
  { id: '2w', label: '2 weeks', range: (t) => [t, addDays(t, 13)] },
  { id: '4w', label: '4 weeks', range: (t) => [t, addDays(t, 27)] },
  { id: 'q', label: 'Quarter', range: (t) => [t, addDays(t, 90)] },
];

/* ─── View preferences (per viewer, best effort) ─────────────────────────── */

type SortKey = 'busiest' | 'freeSoonest' | 'name';
type Prefs = { view: 'heatmap' | 'table'; sort: SortKey; threshold: number; showValues: boolean; groupByTeam: boolean };
const PREFS_KEY = 'taskflow.resources.engagement.prefs';
const DEFAULT_PREFS: Prefs = { view: 'heatmap', sort: 'busiest', threshold: 20, showValues: false, groupByTeam: false };

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

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

type Status = 'free' | 'partial' | 'busy' | 'over' | 'away';
const STATUS_ORDER: Status[] = ['free', 'partial', 'busy', 'over', 'away'];
const STATUS_LABEL: Record<Status, string> = {
  free: 'Available',
  partial: 'Partial',
  busy: 'Busy',
  over: 'Over-booked',
  away: 'Away',
};

function statusOf(d: EngagementDay | undefined): Status | null {
  if (!d) return null;
  return d.level === 'off' ? 'away' : d.level;
}

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

const STATUS_STYLE: Record<Status, React.CSSProperties> = {
  free: cellStyle({ kind: 'work', level: 'free', pct: 5, pending: false }),
  partial: cellStyle({ kind: 'work', level: 'partial', pct: 50, pending: false }),
  busy: cellStyle({ kind: 'work', level: 'busy', pct: 95, pending: false }),
  over: cellStyle({ kind: 'work', level: 'over', pct: 120, pending: false }),
  away: cellStyle({ kind: 'leave', level: 'off', pct: 0, pending: false }),
};

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

/** The team-average row, shaped like a person's days so it shares the cell renderer. */
function teamDays(report: EngagementReport): EngagementDay[] {
  return averageDays(report, report.team.map((t) => (t.working ? t.avgEngagement : null)));
}

/** Average engagement of a group of people per day (working days only). */
function groupDays(report: EngagementReport, members: EngagementPerson[]): EngagementDay[] {
  return averageDays(
    report,
    report.team.map((t, i) => {
      const rows = members.map((p) => p.days[i]).filter((d) => d && d.level !== 'off');
      return t.working && rows.length ? Math.round(rows.reduce((s, d) => s + d.engagementPct, 0) / rows.length) : null;
    })
  );
}

function averageDays(report: EngagementReport, pcts: Array<number | null>): EngagementDay[] {
  return report.team.map((t, i) => ({
    date: t.date,
    kind: t.working ? 'work' : t.holiday ? 'holiday' : 'weekend',
    capacityHours: 0,
    allocatedPct: 0,
    softPct: 0,
    taskHours: 0,
    overdueHours: 0,
    taskCount: 0,
    taskPct: 0,
    loggedHours: 0,
    manualHours: 0,
    meetingHours: 0,
    meetingCount: 0,
    workHours: 0,
    workPct: 0,
    engagementPct: pcts[i] ?? 0,
    level: pcts[i] == null ? 'off' : levelFromPct(pcts[i]!, report.threshold, report.busyPct),
    note: t.holiday,
  }));
}

/** Month labels spanning the heatmap columns. */
function monthSpans(cells: Cell[]): Array<{ key: string; label: string; span: number }> {
  const spans: Array<{ key: string; label: string; span: number }> = [];
  for (const c of cells) {
    const m = c.key.slice(0, 7);
    const last = spans[spans.length - 1];
    if (last && last.key === m) last.span += 1;
    else spans.push({ key: m, label: fmtDay(c.key, { month: 'long', year: 'numeric' }), span: 1 });
  }
  return spans;
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function ResourcesEngagement() {
  const { token, user } = useAuth();
  const workspaceKey = user?.activeOrganizationId ?? '';
  const today = localTodayKey();
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const { view, sort, threshold, showValues, groupByTeam } = prefs;
  const [params, setParams] = useSearchParams();
  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 27));
  // Team and project filters live in the URL so team and project pages can deep-link here.
  const projectId = params.get('project') ?? '';
  const teamIds = useMemo(() => (params.get('teams') ?? '').split(',').filter(Boolean), [params]);
  function setFilterParam(key: 'project' | 'teams', value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true }
    );
  }
  const setProjectId = (v: string) => setFilterParam('project', v);
  const setTeamIds = (ids: string[]) => setFilterParam('teams', ids.join(','));
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Status | 'all'>('all');
  const [focusDate, setFocusDate] = useState(today);
  const [openPersonId, setOpenPersonId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; key: string }>>([]);
  const [data, setData] = useState<EngagementReport | null>(null);
  const [loadedKey, setLoadedKey] = useState('');
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const canManageSettings = canAny(user, 'taskflow.resources.settings.manage', 'taskflow.resources.allocation.manage');
  const [tip, setTip] = useState<{ x: number; y: number; person: EngagementPerson; cell: Cell } | null>(null);
  const canManageOthers = canAny(user, 'taskflow.resources.engagement.manage', 'taskflow.resources.allocation.manage');
  const [entryDraft, setEntryDraft] = useState<EntryDraft | null>(null);
  const [toast, setToast] = useState('');
  const reload = () => setReloadTick((n) => n + 1);
  const entryPeople = useMemo(
    () => (data?.people ?? []).filter((p) => canManageOthers || p.userId === user?.id).map((p) => ({ id: p.userId, name: p.name })),
    [data, canManageOthers, user?.id]
  );

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable — preferences just won't persist */
    }
  }, [prefs]);

  useEffect(() => {
    if (!token) return;
    resourcesApi.options(token).then((res) => {
      if (res.success && res.data) setProjects(res.data.projects);
    });
  }, [token, workspaceKey]);

  const teamsParam = teamIds.join(',');
  const requestKey = [from, to, projectId, teamsParam, threshold, workspaceKey, reloadTick].join('|');
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    if (!token) return;
    let stale = false;
    resourcesApi
      .engagement(token, { from, to, projectId, teamIds: teamsParam, threshold: String(threshold) })
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
  }, [token, from, to, projectId, teamsParam, threshold, requestKey]);

  function applyRange(f: string, t: string) {
    setFrom(f);
    setTo(t);
    if (focusDate < f || focusDate > t) setFocusDate(f <= today && today <= t ? today : f);
  }

  const span = diffDays(from, to) + 1;
  const weekly = span > WEEKLY_AFTER_DAYS;

  function shiftRange(dir: 1 | -1) {
    applyRange(addDays(from, dir * span), addDays(to, dir * span));
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

  // ← / → step the selected date (a week at a time in weekly view).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (entryDraft || openPersonId || e.altKey || e.metaKey || e.ctrlKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName))) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      pickFocusDate(addDays(focusDate, (e.key === 'ArrowRight' ? 1 : -1) * (weekly ? 7 : 1)));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const searched = useMemo(() => {
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
    const groups: Record<Status, Array<{ p: EngagementPerson; d: EngagementDay }>> = {
      over: [],
      busy: [],
      partial: [],
      free: [],
      away: [],
    };
    for (const p of searched) {
      const d = p.days[focusIdx];
      const s = statusOf(d);
      if (s) groups[s].push({ p, d });
    }
    for (const g of Object.values(groups)) g.sort((a, b) => b.d.engagementPct - a.d.engagementPct);
    return { team: data.team[focusIdx], groups };
  }, [data, focusIdx, searched]);

  const people = useMemo(
    () => (status === 'all' || focusIdx < 0 ? searched : searched.filter((p) => statusOf(p.days[focusIdx]) === status)),
    [searched, status, focusIdx]
  );

  const openPerson = data?.people.find((p) => p.userId === openPersonId) ?? null;
  const filtersActive = Boolean(search || projectId || teamIds.length || status !== 'all');
  function clearFilters() {
    setSearch('');
    setParams(new URLSearchParams(), { replace: true });
    setStatus('all');
  }

  const allTeams = data?.teams ?? [];
  const projectTeams = projectId ? allTeams.filter((t) => t.projectIds.includes(projectId)) : [];
  const toggleTeam = (id: string) => setTeamIds(teamIds.includes(id) ? teamIds.filter((t) => t !== id) : [...teamIds, id]);

  /** Heatmap sections: one per team when grouping (people in several teams appear in each), else one. */
  const groups = useMemo(() => {
    if (!groupByTeam || !data) return [{ key: 'all', team: null as EngagementReport['teams'][number] | null, people }];
    const visible = teamIds.length ? data.teams.filter((t) => teamIds.includes(t.id)) : data.teams;
    const out = visible
      .map((t) => ({ key: t.id, team: t as EngagementReport['teams'][number] | null, people: people.filter((p) => t.memberIds.includes(p.userId)) }))
      .filter((g) => g.people.length > 0);
    const none = people.filter((p) => p.teams.length === 0);
    if (none.length) out.push({ key: 'none', team: null, people: none });
    return out;
  }, [groupByTeam, data, teamIds, people]);

  const activePreset = PRESETS.find((p) => {
    const [f, t] = p.range(today);
    return f === from && t === to;
  });
  const focusLabel = focusDate === today ? 'today' : fmtDay(focusDate, { weekday: 'short', day: 'numeric', month: 'short' });

  const inputCls =
    'h-8 px-2.5 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs focus:outline-none focus:border-[color:var(--accent)]';

  const teamCells = data ? buildCells(teamDays(data), weekly, data.today, data.threshold, data.busyPct) : [];
  const isFocusCell = (c: Cell) => (weekly ? c.days.some((d) => d.date === focusDate) : c.key === focusDate);
  const weekBreak = (c: Cell, i: number) => !weekly && i > 0 && weekday(c.key) === 1;
  const cellW = weekly ? 'w-12' : showValues ? 'w-8' : 'w-7';

  return (
    <PageShell
      title="Team engagement"
      description="How busy each person is on any date — from allocations, assigned tasks and their estimates, logged time, meetings and manual entries — and when they free up."
      actions={
        entryPeople.length > 0 && (
          <button
            type="button"
            className={btnPrimary}
            onClick={() => setEntryDraft(blankEntry(canManageOthers ? '' : (user?.id ?? ''), focusDate))}
          >
            <FiPlus /> Record engagement
          </button>
        )
      }
    >
      {/* Toolbar: range on the left, filters on the right */}
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]">
            <button type="button" className="h-8 w-8 grid place-items-center text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]" onClick={() => shiftRange(-1)} aria-label="Previous period" title="Previous period">
              <FiChevronLeft />
            </button>
            <span className="px-1 text-xs font-semibold tabular-nums whitespace-nowrap">
              {fmtDay(from)} – {fmtDay(to, { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <button type="button" className="h-8 w-8 grid place-items-center text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]" onClick={() => shiftRange(1)} aria-label="Next period" title="Next period">
              <FiChevronRight />
            </button>
          </div>
          <Segmented
            value={activePreset?.id ?? 'custom'}
            onChange={(id) => {
              const p = PRESETS.find((x) => x.id === id);
              if (p) applyRange(...p.range(today));
            }}
            options={[...PRESETS.map((p) => ({ value: p.id, label: p.label })), ...(activePreset ? [] : [{ value: 'custom', label: `${span} days` }])]}
          />
          <details className="relative">
            <summary className="list-none cursor-pointer h-8 px-2.5 inline-flex items-center rounded-lg border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]">
              Custom…
            </summary>
            <div className="absolute z-30 mt-1 left-0 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] shadow-xl p-3 flex gap-2">
              <label className="text-[11px] text-[color:var(--text-muted)] flex flex-col gap-1">
                From
                <input type="date" className={inputCls} value={from} onChange={(e) => e.target.value && applyRange(e.target.value, to < e.target.value ? e.target.value : to)} />
              </label>
              <label className="text-[11px] text-[color:var(--text-muted)] flex flex-col gap-1">
                To
                <input type="date" className={inputCls} value={to} min={from} onChange={(e) => e.target.value && applyRange(from, e.target.value)} />
              </label>
            </div>
          </details>
        </div>

        <div className="flex flex-wrap items-center gap-2 ml-auto">
          <div className="relative">
            <FiSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] text-xs" />
            <input type="search" placeholder="Search people, departments…" className={`${inputCls} pl-7 w-52`} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <TeamFilter teams={allTeams} selected={teamIds} onToggle={toggleTeam} onClear={() => setTeamIds([])} inputCls={inputCls} />
          <select className={`${inputCls} max-w-[12rem]`} value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} · {p.name}
              </option>
            ))}
          </select>
          <select className={inputCls} value={sort} onChange={(e) => setPref('sort', e.target.value as SortKey)} aria-label="Sort">
            <option value="busiest">Busiest first</option>
            <option value="freeSoonest">Free soonest</option>
            <option value="name">Name A–Z</option>
          </select>
          <select
            className={inputCls}
            value={threshold}
            onChange={(e) => setPref('threshold', Number(e.target.value))}
            aria-label="Available threshold"
            title="A person counts as available below this load"
          >
            {[10, 20, 30, 50].map((v) => (
              <option key={v} value={v}>
                Available &lt; {v}%
              </option>
            ))}
          </select>
        </div>
      </div>

      {(teamIds.length > 0 || projectId) && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] -mt-2">
          <span className="text-[color:var(--text-muted)]">Showing</span>
          {teamIds.length > 0 ? (
            allTeams
              .filter((t) => teamIds.includes(t.id))
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTeam(t.id)}
                  className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border-subtle)] pl-1.5 pr-1 py-0.5 hover:border-[color:var(--accent)]"
                  title="Remove team filter"
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: teamColor(t.color) }} />
                  {t.name}
                  <FiX className="opacity-60" />
                </button>
              ))
          ) : (
            <span className="font-medium">everyone</span>
          )}
          {projectId && (
            <>
              <span className="text-[color:var(--text-muted)]">on</span>
              <button
                type="button"
                onClick={() => setProjectId('')}
                className="inline-flex items-center gap-1 rounded-full border border-[color:var(--border-subtle)] px-1.5 py-0.5 hover:border-[color:var(--accent)]"
                title="Remove project filter"
              >
                {projects.find((p) => p.id === projectId)?.key ?? 'project'}
                <FiX className="opacity-60" />
              </button>
              <span className="text-[color:var(--text-muted)] ml-2">
                {projectTeams.length === 0 ? 'No team is assigned to this project.' : 'Teams on this project:'}
              </span>
              {projectTeams.map((t) => (
                <TeamChip key={t.id} name={t.name} color={t.color} active={teamIds.includes(t.id)} onClick={() => toggleTeam(t.id)} />
              ))}
            </>
          )}
          <button type="button" className="ml-1 text-[color:var(--accent)] hover:underline" onClick={clearFilters}>
            Clear all
          </button>
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={reload} />}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi
          label="Avg engagement"
          value={`${data?.summary.avgEngagement ?? 0}%`}
          hint={`${data?.summary.people ?? 0} people · ${span} days`}
          loading={!data}
          spark={data?.team}
        />
        <Kpi
          label={`Available ${focusLabel}`}
          value={snapshot ? `${snapshot.groups.free.length}` : '—'}
          suffix={snapshot ? ` / ${searched.length}` : ''}
          hint={status === 'free' ? 'Showing only them · click to clear' : `Below ${threshold}% · click to filter`}
          loading={!data}
          tone="good"
          active={status === 'free'}
          onClick={() => setStatus(status === 'free' ? 'all' : 'free')}
        />
        <Kpi
          label="Over-booked people"
          value={data?.summary.overbookedPeople ?? 0}
          hint="Over 100% on at least one day"
          loading={!data}
          tone={(data?.summary.overbookedPeople ?? 0) > 0 ? 'bad' : undefined}
        />
        <Kpi label="Spare capacity" value={`${Math.round(data?.summary.availableHours ?? 0)}h`} hint="Unbooked hours in range" loading={!data} />
        <Kpi
          label="Overdue · undated"
          value={`${data?.summary.overdueTasks ?? 0} · ${data?.summary.unscheduledTasks ?? 0}`}
          hint="Tasks not placed on the calendar"
          loading={!data}
          tone={(data?.summary.overdueTasks ?? 0) > 0 ? 'warn' : undefined}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_21rem] gap-5 items-start">
        <div className="space-y-4 min-w-0">
          <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow">
            <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3">
              <div className="min-w-0 mr-auto">
                <h2 className="text-sm font-semibold">{view === 'heatmap' ? (weekly ? 'Weekly engagement' : 'Daily engagement') : 'Engagement summary'}</h2>
                <p className="text-[11px] text-[color:var(--text-muted)]">
                  {view === 'heatmap'
                    ? `Click a column to see who's free · click a name for detail · ← → to move the date`
                    : 'Per-person totals for the selected range · click a row for detail'}
                </p>
              </div>
              {view === 'heatmap' && (
                <button
                  type="button"
                  onClick={() => setPref('showValues', !showValues)}
                  aria-pressed={showValues}
                  className={`h-7 px-2 inline-flex items-center gap-1 rounded-lg border text-[11px] font-medium transition ${
                    showValues
                      ? 'border-[color:var(--accent)]/50 bg-[color:var(--accent-subtle)] text-[color:var(--accent)]'
                      : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
                  }`}
                  title="Show the percentage inside each cell"
                >
                  <FiHash /> Values
                </button>
              )}
              {view === 'heatmap' && allTeams.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPref('groupByTeam', !groupByTeam)}
                  aria-pressed={groupByTeam}
                  className={`h-7 px-2 inline-flex items-center gap-1 rounded-lg border text-[11px] font-medium transition ${
                    groupByTeam
                      ? 'border-[color:var(--accent)]/50 bg-[color:var(--accent-subtle)] text-[color:var(--accent)]'
                      : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
                  }`}
                  title="Show one section per team"
                >
                  <FiLayers /> Group by team
                </button>
              )}
              <Segmented
                value={view}
                onChange={(v) => setPref('view', v)}
                options={[
                  { value: 'heatmap', label: <span className="inline-flex items-center gap-1"><FiGrid /> Heatmap</span> },
                  { value: 'table', label: <span className="inline-flex items-center gap-1"><FiList /> Table</span> },
                ]}
              />
            </div>

            {/* Status filter for the selected date */}
            {snapshot && snapshot.team.working && (
              <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 text-[11px]">
                <span className="text-[color:var(--text-muted)] mr-1">On {focusLabel}:</span>
                <StatusPill label="Everyone" count={searched.length} active={status === 'all'} onClick={() => setStatus('all')} />
                {STATUS_ORDER.map((s) => (
                  <StatusPill
                    key={s}
                    label={STATUS_LABEL[s]}
                    count={snapshot.groups[s].length}
                    swatch={STATUS_STYLE[s]}
                    active={status === s}
                    onClick={() => setStatus(status === s ? 'all' : s)}
                  />
                ))}
              </div>
            )}

            <div className="px-4 pb-4">
              {!data && !error ? (
                <div className="h-72 rounded-xl skeleton" />
              ) : !data ? null : people.length === 0 ? (
                <EmptyState title={searched.length === 0 && !filtersActive ? 'No one in this workspace yet' : 'No people match these filters'}>
                  {filtersActive && (
                    <button type="button" className="text-[color:var(--accent)] hover:underline" onClick={clearFilters}>
                      Clear filters
                    </button>
                  )}
                </EmptyState>
              ) : view === 'table' ? (
                <SummaryTable people={people} today={data.today} onOpen={setOpenPersonId} />
              ) : (
                <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
                  <div className="overflow-auto max-h-[70vh] -mx-1 px-1 rounded-lg">
                    <table className="border-separate" style={{ borderSpacing: 2 }}>
                      <thead className="sticky top-0 z-20 bg-[color:var(--bg-surface)]">
                        <tr>
                          <th className="sticky left-0 z-10 bg-[color:var(--bg-surface)]" />
                          {monthSpans(teamCells).map((m, i) => (
                            <th key={m.key} colSpan={m.span} className="text-left font-semibold text-[10px] uppercase tracking-wider text-[color:var(--text-muted)] px-1 pt-1">
                              <span className={i > 0 ? 'border-l border-[color:var(--border-subtle)] pl-1.5' : ''}>{m.label}</span>
                            </th>
                          ))}
                        </tr>
                        <tr>
                          <th className="sticky left-0 z-10 bg-[color:var(--bg-surface)] min-w-[15rem] text-left align-bottom pb-1">
                            <span className="text-[10px] font-medium text-[color:var(--text-muted)]">
                              {people.length} {people.length === 1 ? 'person' : 'people'}
                              {status !== 'all' && ` · ${STATUS_LABEL[status].toLowerCase()} ${focusLabel}`}
                            </span>
                          </th>
                          {teamCells.map((c, i) => {
                            const selected = isFocusCell(c);
                            const holiday = !weekly ? data.team[i]?.holiday : undefined;
                            return (
                              <th key={c.key} className="p-0 font-normal" style={weekBreak(c, i) ? { paddingLeft: 6 } : undefined}>
                                <button
                                  type="button"
                                  title={holiday ? `${fmtDay(c.key, { dateStyle: 'full' })} · ${holiday}` : fmtDay(c.key, { dateStyle: 'full' })}
                                  onClick={() => setFocusDate(weekly ? (c.days.find((d) => d.kind === 'work')?.date ?? c.key) : c.key)}
                                  className={`relative flex flex-col items-center justify-center rounded-md leading-tight ${cellW} h-9 text-[10px] transition-colors ${
                                    selected
                                      ? 'bg-[color:var(--accent)] text-white shadow-sm'
                                      : c.isToday
                                        ? 'text-[color:var(--accent)] font-semibold bg-[color:var(--accent-subtle)]'
                                        : c.level === 'off'
                                          ? 'text-[color:var(--text-muted)] opacity-60 hover:bg-[color:var(--bg-elevated)]'
                                          : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]'
                                  }`}
                                >
                                  <span>{c.label}</span>
                                  <span className="font-semibold">{c.sub}</span>
                                  {holiday && <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-amber-400" />}
                                </button>
                              </th>
                            );
                          })}
                        </tr>
                        <tr>
                          <td className="sticky left-0 z-10 bg-[color:var(--bg-surface)] pr-3 pb-1.5">
                            <span className="flex items-center gap-2 px-1 text-[12px] font-semibold text-[color:var(--text-muted)]">
                              <span className="w-7 h-7 rounded-full border border-dashed border-[color:var(--border-subtle)] grid place-items-center text-[10px]">Σ</span>
                              Team average
                            </span>
                          </td>
                          {teamCells.map((c, i) => (
                            <td key={c.key} className="p-0 pb-1.5" style={weekBreak(c, i) ? { paddingLeft: 6 } : undefined}>
                              <HeatCell cell={c} width={cellW} showValue={showValues} focused={isFocusCell(c)} onClick={() => setFocusDate(c.key)} title={c.level === 'off' ? 'Non-working' : `Team average ${c.pct}%`} />
                            </td>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {groups.map((g) => {
                          const collapsed = collapsedGroups.has(g.key);
                          const groupCells = g.key === 'all' ? [] : buildCells(groupDays(data, g.people), weekly, data.today, data.threshold, data.busyPct);
                          return (
                            <Fragment key={g.key}>
                              {g.key !== 'all' && (
                                <tr>
                                  <td className="sticky left-0 z-10 bg-[color:var(--bg-surface)] pr-3 pt-3 pb-1">
                                    <button
                                      type="button"
                                      aria-expanded={!collapsed}
                                      onClick={() =>
                                        setCollapsedGroups((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(g.key)) next.delete(g.key);
                                          else next.add(g.key);
                                          return next;
                                        })
                                      }
                                      className="w-full flex items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-[color:var(--bg-elevated)]"
                                    >
                                      <FiChevronDown className={`shrink-0 text-[color:var(--text-muted)] transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.team ? teamColor(g.team.color) : 'var(--border-subtle)' }} />
                                      <span className="truncate text-[12px] font-semibold">{g.team?.name ?? 'No team'}</span>
                                      <span className="ml-auto text-[10px] text-[color:var(--text-muted)] tabular-nums">{g.people.length}</span>
                                    </button>
                                  </td>
                                  {groupCells.map((c, i) => (
                                    <td key={c.key} className="p-0 pt-3 pb-1" style={weekBreak(c, i) ? { paddingLeft: 6 } : undefined}>
                                      <HeatCell
                                        cell={c}
                                        width={cellW}
                                        showValue={showValues}
                                        focused={isFocusCell(c)}
                                        onClick={() => setFocusDate(c.key)}
                                        title={c.level === 'off' ? 'Non-working' : `${g.team?.name ?? 'No team'} average ${c.pct}%`}
                                      />
                                    </td>
                                  ))}
                                </tr>
                              )}
                              {!collapsed &&
                                g.people.map((p) => {
                          const cells = buildCells(p.days, weekly, data.today, data.threshold, data.busyPct);
                          return (
                            <tr key={p.userId} className="group">
                              <td className="sticky left-0 z-10 bg-[color:var(--bg-surface)] pr-3 py-0.5">
                                <button
                                  type="button"
                                  onClick={() => setOpenPersonId(p.userId)}
                                  className={`w-full text-left flex items-center gap-2 rounded-lg px-1 py-0.5 transition-colors group-hover:bg-[color:var(--bg-elevated)] ${
                                    openPersonId === p.userId ? 'bg-[color:var(--accent-subtle)]' : ''
                                  }`}
                                >
                                  <Avatar name={p.name} />
                                  <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5">
                                      <span className="truncate text-[13px] font-medium text-[color:var(--text-primary)]">{p.name}</span>
                                      {p.teams.length > 0 && (
                                        <span className="shrink-0 flex items-center gap-0.5" title={`Teams: ${p.teams.map((t) => t.name).join(', ')}`}>
                                          {p.teams.slice(0, 4).map((t) => (
                                            <span key={t.id} className="w-1.5 h-1.5 rounded-full" style={{ background: teamColor(t.color) }} />
                                          ))}
                                        </span>
                                      )}
                                      {p.summary.overbookedDays > 0 && <FiAlertTriangle className="shrink-0 text-[11px]" style={{ color: OVER_COLOR }} title={`${p.summary.overbookedDays} over-booked days`} />}
                                    </span>
                                    <span className="flex items-center gap-1.5 text-[11px] text-[color:var(--text-muted)]">
                                      <MiniBar pct={p.summary.avgEngagement} />
                                      <span className="tabular-nums">{p.summary.avgEngagement}%</span>
                                      <span>·</span>
                                      <span className="truncate">
                                        <FreeText person={p} today={data.today} short />
                                      </span>
                                    </span>
                                  </span>
                                </button>
                              </td>
                              {cells.map((c, i) => (
                                <td key={c.key} className="p-0" style={weekBreak(c, i) ? { paddingLeft: 6 } : undefined}>
                                  <HeatCell
                                    cell={c}
                                    width={cellW}
                                    showValue={showValues}
                                    focused={isFocusCell(c)}
                                    ariaLabel={`${p.name}, ${fmtDay(c.key)}: ${c.level === 'off' ? 'off' : `${c.pct}% ${LEVEL_LABEL[c.level]}`}`}
                                    onClick={() => setFocusDate(c.key)}
                                    onHover={(e) => setTip(e ? { x: e.clientX, y: e.clientY, person: p, cell: c } : null)}
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                                })}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Legend threshold={data.threshold} busy={data.busyPct} />
                </div>
              )}
            </div>
          </section>

          {data && <EstimateCoverage report={data} canManage={canManageSettings} token={token} onSaved={reload} />}
        </div>

        {/* Snapshot for a single date */}
        <aside className="xl:sticky xl:top-4 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow p-4 space-y-4">
          <div className="flex items-center gap-2">
            <button type="button" className="h-7 w-7 grid place-items-center rounded-md border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]" onClick={() => pickFocusDate(addDays(focusDate, -1))} aria-label="Previous day">
              <FiChevronLeft />
            </button>
            <div className="flex-1 min-w-0 text-center">
              <div className="text-sm font-semibold">{fmtDay(focusDate, { weekday: 'long', day: 'numeric', month: 'short' })}</div>
              <div className="text-[11px] text-[color:var(--text-muted)] capitalize">{relDay(focusDate, today)}</div>
            </div>
            <button type="button" className="h-7 w-7 grid place-items-center rounded-md border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]" onClick={() => pickFocusDate(addDays(focusDate, 1))} aria-label="Next day">
              <FiChevronRight />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input type="date" className={`${inputCls} flex-1`} value={focusDate} onChange={(e) => pickFocusDate(e.target.value)} aria-label="Pick a date" />
            {focusDate !== today && (
              <button type="button" className={`${btnSecondary} h-8 text-xs`} onClick={() => pickFocusDate(today)}>
                Today
              </button>
            )}
          </div>

          {!snapshot ? (
            <div className="h-40 rounded-xl skeleton" />
          ) : !snapshot.team.working ? (
            <EmptyState title="Non-working day">{snapshot.team.holiday ?? 'Weekend'}</EmptyState>
          ) : (
            <>
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="text-3xl font-bold tabular-nums">{snapshot.team.avgEngagement}%</span>
                  <span className="text-[11px] text-[color:var(--text-muted)]">team average</span>
                </div>
                <Composition groups={snapshot.groups} />
              </div>
              <div className="space-y-3 max-h-[55vh] overflow-y-auto -mr-2 pr-2">
                {(['free', 'partial', 'busy', 'over', 'away'] as Status[]).map((s) => (
                  <SnapshotGroup
                    key={s}
                    status={s}
                    hint={s === 'free' ? `below ${data?.threshold}%` : s === 'busy' ? `${data?.busyPct}%+` : s === 'over' ? 'over 100%' : undefined}
                    rows={snapshot.groups[s]}
                    onOpen={setOpenPersonId}
                    defaultOpen={s !== 'away'}
                  />
                ))}
              </div>
            </>
          )}
        </aside>
      </div>

      {tip && <CellTooltip {...tip} />}
      {openPerson && data && (
        <PersonDrawer
          person={openPerson}
          report={data}
          focusDate={focusDate}
          canEditEntries={canManageOthers || openPerson.userId === user?.id}
          onClose={() => setOpenPersonId(null)}
          onPickDate={setFocusDate}
          onAddEntry={() => setEntryDraft(blankEntry(openPerson.userId, focusDate))}
          onEditEntry={(e) => setEntryDraft(draftFromEntry(openPerson.userId, e))}
          onChanged={(m) => {
            setToast(m);
            reload();
          }}
          token={token}
        />
      )}
      {token && (
        <EntryModal
          draft={entryDraft}
          people={entryPeople}
          projects={projects}
          lockPerson={!canManageOthers}
          token={token}
          onClose={() => setEntryDraft(null)}
          onSaved={(m) => {
            setEntryDraft(null);
            setToast(m);
            reload();
          }}
        />
      )}
      <Toast message={toast} onDone={() => setToast('')} />
    </PageShell>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────────────── */

function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'lg' }) {
  const initials = (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span
      className={`shrink-0 rounded-full bg-[color:var(--accent-subtle)] text-[color:var(--accent)] font-semibold flex items-center justify-center ${
        size === 'lg' ? 'w-11 h-11 text-sm' : 'w-7 h-7 text-[11px]'
      }`}
    >
      {initials}
    </span>
  );
}

function MiniBar({ pct, className = 'w-10' }: { pct: number; className?: string }) {
  return (
    <span className={`shrink-0 h-1.5 rounded-full bg-[color:var(--bg-elevated)] overflow-hidden ${className}`}>
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.min(100, pct)}%`, background: pct > 100 ? OVER_COLOR : 'var(--accent)' }}
      />
    </span>
  );
}

function HeatCell({
  cell,
  width,
  showValue,
  focused,
  ariaLabel,
  title,
  onClick,
  onHover,
}: {
  cell: Cell;
  width: string;
  showValue: boolean;
  focused: boolean;
  ariaLabel?: string;
  title?: string;
  onClick: () => void;
  onHover?: (e: React.MouseEvent | null) => void;
}) {
  const glyph = cellGlyph(cell);
  const text = showValue && cell.level !== 'off' ? String(cell.pct) : glyph;
  return (
    <div
      role="img"
      aria-label={ariaLabel ?? title}
      title={title}
      onMouseEnter={onHover}
      onMouseMove={onHover}
      onMouseLeave={onHover && (() => onHover(null))}
      onClick={onClick}
      className={`${width} h-7 rounded-[5px] flex items-center justify-center font-bold tabular-nums cursor-pointer transition-transform hover:scale-110 hover:z-10 relative ${
        showValue ? 'text-[9px]' : 'text-[10px]'
      } ${cell.level === 'over' || cell.pct >= 70 ? 'text-white' : 'text-[color:var(--text-muted)]'} ${
        focused
          ? 'ring-2 ring-[color:var(--accent)] ring-offset-1 ring-offset-[color:var(--bg-surface)]'
          : cell.isToday
            ? 'ring-1 ring-[color:var(--accent)]/60'
            : ''
      }`}
      style={cellStyle(cell)}
    >
      {text}
    </div>
  );
}

function StatusPill({
  label,
  count,
  swatch,
  active,
  onClick,
}: {
  label: string;
  count: number;
  swatch?: React.CSSProperties;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={!active && count === 0}
      className={`inline-flex items-center gap-1.5 h-6 px-2 rounded-full border font-medium transition disabled:opacity-40 ${
        active
          ? 'border-[color:var(--accent)] bg-[color:var(--accent-subtle)] text-[color:var(--accent)]'
          : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
      }`}
    >
      {swatch && <span className="w-2.5 h-2.5 rounded-[3px]" style={swatch} />}
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

function Kpi({
  label,
  value,
  suffix,
  hint,
  loading,
  tone,
  active,
  spark,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  suffix?: string;
  hint?: string;
  loading?: boolean;
  tone?: 'good' | 'warn' | 'bad';
  active?: boolean;
  spark?: EngagementReport['team'];
  onClick?: () => void;
}) {
  const toneCls =
    tone === 'bad' ? 'text-red-400' : tone === 'warn' ? 'text-amber-400' : tone === 'good' ? 'text-emerald-400' : 'text-[color:var(--text-primary)]';
  const working = spark?.filter((t) => t.working) ?? [];
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`text-left h-full rounded-xl border bg-[color:var(--bg-surface)] px-4 py-3.5 card-shadow transition ${
        active ? 'border-[color:var(--accent)] ring-1 ring-[color:var(--accent)]/40' : 'border-[color:var(--border-subtle)]'
      } ${onClick ? 'hover-elevated cursor-pointer' : ''}`}
    >
      <p className="text-[11px] font-medium uppercase tracking-wider text-[color:var(--text-muted)] truncate">{label}</p>
      {loading ? (
        <div className="mt-2 h-7 w-16 rounded-full skeleton" />
      ) : (
        <div className="flex items-end justify-between gap-2">
          <p className={`text-2xl font-bold mt-1 tabular-nums ${toneCls}`}>
            {value}
            {suffix && <span className="text-sm font-medium text-[color:var(--text-muted)]">{suffix}</span>}
          </p>
          {working.length > 1 && (
            <span className="flex items-end gap-px h-7 mb-1" aria-hidden>
              {working.slice(-30).map((t) => (
                <span
                  key={t.date}
                  className="w-1 rounded-sm"
                  style={{
                    height: `${Math.max(8, Math.min(100, t.avgEngagement))}%`,
                    background: t.avgEngagement > 100 ? OVER_COLOR : 'color-mix(in srgb, var(--accent) 70%, transparent)',
                  }}
                />
              ))}
            </span>
          )}
        </div>
      )}
      {hint && <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5 truncate">{hint}</p>}
    </Tag>
  );
}

function Composition({ groups }: { groups: Record<Status, unknown[]> }) {
  const total = STATUS_ORDER.reduce((s, k) => s + groups[k].length, 0);
  if (!total) return null;
  return (
    <div className="mt-2">
      <div className="flex h-2.5 rounded-full overflow-hidden gap-px bg-[color:var(--bg-elevated)]">
        {STATUS_ORDER.filter((k) => groups[k].length).map((k) => (
          <span key={k} title={`${STATUS_LABEL[k]}: ${groups[k].length}`} style={{ ...STATUS_STYLE[k], width: `${(groups[k].length / total) * 100}%` }} />
        ))}
      </div>
    </div>
  );
}

function FreeText({ person, today, short = false }: { person: EngagementPerson; today: string; short?: boolean }) {
  const s = person.summary;
  if (s.freeFrom && s.freeFrom <= today) return <span className="text-emerald-500">free now</span>;
  if (s.freeFrom) return <span>free from {fmtDay(s.freeFrom)}</span>;
  if (s.busyThroughRangeEnd) {
    if (s.openEndedAllocation) return <span>{short ? 'busy, no end date' : 'Busy with an open-ended allocation'}</span>;
    if (s.commitmentsEnd) return <span>busy until {fmtDay(s.commitmentsEnd, { day: 'numeric', month: 'short', year: 'numeric' })}</span>;
    return <span>busy past range</span>;
  }
  return <span>—</span>;
}

function TeamFilter({
  teams,
  selected,
  onToggle,
  onClear,
  inputCls,
}: {
  teams: EngagementReport['teams'];
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  inputCls: string;
}) {
  const [q, setQ] = useState('');
  const label =
    selected.length === 0
      ? 'All teams'
      : selected.length === 1
        ? (teams.find((t) => t.id === selected[0])?.name ?? '1 team')
        : `${selected.length} teams`;
  const shown = teams.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <details className="relative">
      <summary className={`${inputCls} list-none cursor-pointer inline-flex items-center gap-1.5 ${selected.length ? 'border-[color:var(--accent)] text-[color:var(--accent)]' : ''}`}>
        <FiUsers /> <span className="max-w-[9rem] truncate">{label}</span> <FiChevronDown className="opacity-60" />
      </summary>
      <div className="absolute z-30 mt-1 right-0 w-64 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] shadow-xl p-2">
        {teams.length === 0 ? (
          <p className="p-2 text-xs text-[color:var(--text-muted)]">
            No teams yet.{' '}
            <Link to="/resources/teams" className="text-[color:var(--accent)] hover:underline">
              Create one
            </Link>
          </p>
        ) : (
          <>
            {teams.length > 6 && (
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a team…" className={`${inputCls} w-full mb-1`} />
            )}
            <ul className="max-h-64 overflow-y-auto">
              {shown.map((t) => {
                const on = selected.includes(t.id);
                return (
                  <li key={t.id}>
                    <button type="button" onClick={() => onToggle(t.id)} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-left hover:bg-[color:var(--bg-elevated)]">
                      <span className={`w-4 h-4 rounded grid place-items-center border ${on ? 'bg-[color:var(--accent)] border-[color:var(--accent)] text-white' : 'border-[color:var(--border-subtle)]'}`}>
                        {on && <FiCheck className="text-[10px]" />}
                      </span>
                      <span className="w-2 h-2 rounded-full" style={{ background: teamColor(t.color) }} />
                      <span className="flex-1 truncate">{t.name}</span>
                      <span className="text-[10px] text-[color:var(--text-muted)] tabular-nums">
                        {t.memberIds.length} · {t.projectIds.length}p
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between border-t border-[color:var(--border-subtle)] mt-1 pt-1.5 px-1 text-[11px]">
              <button type="button" className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] disabled:opacity-40" disabled={!selected.length} onClick={onClear}>
                Clear
              </button>
              <Link to="/resources/teams" className="text-[color:var(--accent)] hover:underline">
                Manage teams →
              </Link>
            </div>
          </>
        )}
      </div>
    </details>
  );
}

function Legend({ threshold, busy }: { threshold: number; busy: number }) {
  const items: Array<{ label: string; style: React.CSSProperties; glyph?: string }> = [
    { label: `Available (<${threshold}%)`, style: STATUS_STYLE.free },
    { label: 'Partial', style: STATUS_STYLE.partial },
    { label: `Busy (${busy}–100%)`, style: STATUS_STYLE.busy },
    { label: 'Over-booked', style: STATUS_STYLE.over, glyph: '!' },
    { label: 'Leave / holiday', style: STATUS_STYLE.away },
    { label: 'Weekend', style: cellStyle({ kind: 'weekend', level: 'off', pct: 0, pending: false }) },
    { label: 'Leave pending', style: cellStyle({ kind: 'work', level: 'free', pct: 0, pending: true }) },
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-[color:var(--border-subtle)] text-[11px] text-[color:var(--text-muted)]">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-[3px] flex items-center justify-center text-[8px] font-bold text-white" style={i.style}>
            {i.glyph ?? ''}
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
              {single.date >= localTodayKey() && <Row k="Tasks planned" v={`${single.taskCount} · ${single.taskHours}h`} />}
              {single.loggedHours > 0 && <Row k="Logged" v={`${single.loggedHours}h`} />}
              {single.meetingHours > 0 && <Row k="Meetings" v={`${single.meetingCount} · ${single.meetingHours}h`} />}
              {single.manualHours > 0 && <Row k="Manual entries" v={`${single.manualHours}h`} />}
              <Row k="Counted" v={`${single.workHours}h of ${single.capacityHours}h (${single.workPct}%)`} />
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
  status,
  hint,
  rows,
  onOpen,
  defaultOpen,
}: {
  status: Status;
  hint?: string;
  rows: Array<{ p: EngagementPerson; d: EngagementDay }>;
  onOpen: (userId: string) => void;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (rows.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)] mb-1.5 hover:text-[color:var(--text-primary)]"
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-[3px]" style={STATUS_STYLE[status]} />
          {STATUS_LABEL[status]} {hint && <span className="normal-case font-normal tracking-normal">· {hint}</span>}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="tabular-nums">{rows.length}</span>
          <FiChevronRight className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        </span>
      </button>
      {open && (
        <ul className="space-y-0.5">
          {rows.map(({ p, d }) => (
            <li key={p.userId}>
              <button
                type="button"
                onClick={() => onOpen(p.userId)}
                className="w-full flex items-center gap-2 text-[13px] rounded-lg px-1 py-1 hover:bg-[color:var(--bg-elevated)] text-left"
              >
                <Avatar name={p.name} />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-[color:var(--text-primary)]">{p.name}</span>
                  {p.department && <span className="block truncate text-[10px] text-[color:var(--text-muted)]">{p.department}</span>}
                </span>
                {d.level === 'off' ? (
                  <span className="text-xs text-[color:var(--text-muted)]">{d.kind === 'leave' ? 'Leave' : d.kind === 'holiday' ? 'Holiday' : 'Off'}</span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <MiniBar pct={d.engagementPct} className="w-12" />
                    <span className="w-9 text-right text-xs tabular-nums text-[color:var(--text-muted)]">{d.engagementPct}%</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Day-by-day bars for one person across the loaded range. */
function DayBars({ days, focusDate, onPick }: { days: EngagementDay[]; focusDate: string; onPick: (d: string) => void }) {
  const max = Math.max(100, ...days.map((d) => d.engagementPct));
  return (
    <div>
      <div className="relative h-24 flex items-end gap-[2px]">
        <div className="absolute inset-x-0 border-t border-dashed border-[color:var(--border-subtle)]" style={{ bottom: `${(100 / max) * 100}%` }}>
          <span className="absolute -top-3.5 right-0 text-[9px] text-[color:var(--text-muted)]">100%</span>
        </div>
        {days.map((d) => (
          <button
            key={d.date}
            type="button"
            title={`${fmtDay(d.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${d.level === 'off' ? 'off' : `${d.engagementPct}%`}`}
            onClick={() => onPick(d.date)}
            className={`flex-1 min-w-[3px] rounded-t-sm transition-opacity hover:opacity-80 ${d.date === focusDate ? 'ring-2 ring-[color:var(--accent)] ring-offset-1 ring-offset-[color:var(--bg-modal)]' : ''}`}
            style={{
              height: d.level === 'off' ? '100%' : `${Math.max(3, (d.engagementPct / max) * 100)}%`,
              ...cellStyle({ kind: d.kind, level: d.level, pct: Math.max(d.engagementPct, 30), pending: false }),
              ...(d.level === 'off' ? { opacity: 0.5 } : {}),
            }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-[color:var(--text-muted)] mt-1">
        <span>{fmtDay(days[0]?.date)}</span>
        <span>{fmtDay(days[days.length - 1]?.date)}</span>
      </div>
    </div>
  );
}

type DrawerTab = 'tasks' | 'allocations' | 'entries';

function PersonDrawer({
  person,
  report,
  focusDate,
  canEditEntries,
  onClose,
  onPickDate,
  onAddEntry,
  onEditEntry,
  onChanged,
  token,
}: {
  person: EngagementPerson;
  report: EngagementReport;
  focusDate: string;
  canEditEntries: boolean;
  onClose: () => void;
  onPickDate: (d: string) => void;
  onAddEntry: () => void;
  onEditEntry: (e: EngagementEntryRow) => void;
  onChanged: (message: string) => void;
  token: string | null;
}) {
  const s = person.summary;
  const today = report.today;
  const [tab, setTab] = useState<DrawerTab>('tasks');
  const [confirm, setConfirm] = useState<EngagementEntryRow | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Let open modals handle Escape first.
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function remove(e: EngagementEntryRow) {
    setConfirm(null);
    if (!token) return;
    const res = await resourcesApi.deleteEngagementEntry(e._id, token);
    onChanged(res.success ? 'Entry removed.' : errorOf(res, 'Delete failed'));
  }

  const focusDay = person.days[diffDays(report.from, focusDate)];
  const stats: Array<[string, string, string?]> = [
    ['Avg / peak', `${s.avgEngagement}% / ${s.peakEngagement}%`],
    ['Next available', s.nextAvailable ? fmtDay(s.nextAvailable) : 'Not in range', s.nextAvailable ? relDay(s.nextAvailable, today) : undefined],
    ['Work remaining', `${s.remainingHours}h`, s.noEstimateTasks ? `${s.noEstimateTasks} unestimated` : undefined],
    ['Spare hours', `${s.availableHours}h`, `${s.freeDays} free · ${s.busyDays} busy days`],
    [
      'Tasks clear by',
      s.unplacedHours > 0 ? 'After range' : s.tasksClearOn ? fmtDay(s.tasksClearOn, { day: 'numeric', month: 'short', year: 'numeric' }) : 'No dated work',
    ],
    [
      'Commitments end',
      s.openEndedAllocation ? 'Open-ended' : s.unplacedHours > 0 ? 'After range' : s.commitmentsEnd ? fmtDay(s.commitmentsEnd, { day: 'numeric', month: 'short', year: 'numeric' }) : 'None',
    ],
    ['Logged in range', `${s.loggedHours}h`],
    ['Meetings / manual', `${s.meetingHours}h / ${s.manualHours}h`, s.leaveDays ? `${s.leaveDays} leave days` : undefined],
  ];
  const scheduleTone: Record<string, string> = {
    overdue: 'text-red-500',
    scheduled: 'text-[color:var(--text-muted)]',
    unscheduled: 'text-amber-500',
  };

  return createPortal(
    <>
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] animate-fade-in" />
      <aside
        className="relative h-full w-full max-w-xl bg-[color:var(--bg-modal)] border-l border-[color:var(--border-subtle)] shadow-2xl flex flex-col animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
        aria-label={`${person.name} engagement`}
      >
        <header className="px-5 pt-5 pb-4 border-b border-[color:var(--border-subtle)]">
          <div className="flex items-start gap-3">
            <Avatar name={person.name} size="lg" />
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold truncate">{person.name}</h2>
              <p className="text-xs text-[color:var(--text-muted)] truncate">
                {[person.department, person.email, `${person.capacityHoursPerWeek}h/week`].filter(Boolean).join(' · ')}
              </p>
              {person.teams.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {person.teams.map((t) => (
                    <TeamChip key={t.id} name={t.name} color={t.color} />
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Chip tone={s.freeFrom && s.freeFrom <= today ? 'good' : 'neutral'}>
                  <FreeText person={person} today={today} />
                </Chip>
                {s.overbookedDays > 0 && <Chip tone="bad">{s.overbookedDays} over-booked days</Chip>}
                {s.overdueTasks > 0 && <Chip tone="warn">{s.overdueTasks} overdue tasks</Chip>}
              </div>
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-md text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)]" aria-label="Close">
              <FiX />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <section>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-xs font-semibold">Engagement over the range</h3>
              {focusDay && (
                <span className="text-[11px] text-[color:var(--text-muted)]">
                  {fmtDay(focusDate, { weekday: 'short', day: 'numeric', month: 'short' })}:{' '}
                  <span className="font-semibold text-[color:var(--text-primary)]">
                    {focusDay.level === 'off' ? (focusDay.kind === 'leave' ? 'on leave' : 'off') : `${focusDay.engagementPct}% · ${focusDay.workHours}h of ${focusDay.capacityHours}h`}
                  </span>
                </span>
              )}
            </div>
            <DayBars days={person.days} focusDate={focusDate} onPick={onPickDate} />
          </section>

          <section className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {stats.map(([k, v, sub]) => (
              <div key={k} className="rounded-lg bg-[color:var(--bg-elevated)] px-3 py-2">
                <div className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">{k}</div>
                <div className="text-[13px] font-semibold tabular-nums">{v}</div>
                {sub && <div className="text-[10px] text-[color:var(--text-muted)] truncate">{sub}</div>}
              </div>
            ))}
          </section>

          <section>
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'tasks', label: 'Open tasks', count: person.tasks.length },
                { value: 'allocations', label: 'Allocations', count: person.allocations.length },
                { value: 'entries', label: 'Manual entries', count: person.entries.length },
              ]}
            />
            <div className="mt-3">
              {tab === 'tasks' &&
                (person.tasks.length === 0 ? (
                  <p className="text-xs text-[color:var(--text-muted)]">No open assigned issues.</p>
                ) : (
                  <>
                    <ul className="divide-y divide-[color:var(--border-subtle)]">
                      {person.tasks.map((t) => {
                        const done = t.estimateHours > 0 ? Math.min(100, Math.round(((t.estimateHours - t.remainingHours) / t.estimateHours) * 100)) : 0;
                        return (
                          <li key={`${t.issueId}|${t.lane ?? ''}`} className="py-2 text-xs">
                            <div className="flex items-start justify-between gap-2">
                              <Link
                                to={t.project ? `/projects/${t.project.id}/issues/${t.key ?? t.issueId}` : '/issues'}
                                className="min-w-0 text-[color:var(--text-primary)] hover:text-[color:var(--accent)]"
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
                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[color:var(--text-muted)]">
                              {t.lane && <Chip tone="accent">{t.lane} stage</Chip>}
                              <span>{t.status}</span>
                              {t.hoursSource === 'none' ? (
                                <span className="text-amber-500">· no estimate</span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 tabular-nums">
                                  · <MiniBar pct={done} className="w-12" /> {t.remainingHours}h left of {t.estimateHours}h
                                  <span className="opacity-70">({SOURCE_LABEL[t.hoursSource]})</span>
                                </span>
                              )}
                              {t.overEstimate && <span className="text-amber-500">· over estimate ({t.loggedHours}h logged)</span>}
                              {t.unplacedHours > 0 && <span className="text-red-500">· {t.unplacedHours}h beyond range</span>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {(s.overdueHours > 0 || s.unscheduledHours > 0) && (
                      <p className="mt-2 text-[11px] text-[color:var(--text-muted)]">
                        {s.overdueHours > 0 && <>{s.overdueHours}h overdue work is scheduled into spare time from today. </>}
                        {s.unscheduledHours > 0 && <>{s.unscheduledHours}h of work has no due date, sprint or milestone, so it isn't on the calendar.</>}
                      </p>
                    )}
                  </>
                ))}

              {tab === 'allocations' &&
                (person.allocations.length === 0 ? (
                  <p className="text-xs text-[color:var(--text-muted)]">No project allocations in this range.</p>
                ) : (
                  <ul className="space-y-2">
                    {person.allocations.map((a) => (
                      <li key={a.allocationId} className="rounded-lg border border-[color:var(--border-subtle)] px-3 py-2 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate">
                            <span className="font-medium">{a.key ?? a.name}</span>
                            {a.key && a.name && <span className="text-[color:var(--text-muted)]"> · {a.name}</span>}
                          </span>
                          <span className="font-semibold tabular-nums">{a.percent}%</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-[color:var(--text-muted)]">
                          <MiniBar pct={a.percent} className="w-16" />
                          <span>
                            {fmtDay(a.startDate)} → {a.endDate ? fmtDay(a.endDate) : 'open-ended'}
                          </span>
                          {a.roleLabel && <span>· {a.roleLabel}</span>}
                          {a.softBooked && <Chip>soft</Chip>}
                        </div>
                      </li>
                    ))}
                  </ul>
                ))}

              {tab === 'entries' &&
                (person.entries.length === 0 ? (
                  <p className="text-xs text-[color:var(--text-muted)]">
                    None. Use manual entries for work that isn't a task or meeting — support duty, pre-sales, training, internal work.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {person.entries.map((e) => (
                      <li key={e._id} className="group rounded-lg border border-[color:var(--border-subtle)] px-3 py-2 text-xs flex items-center gap-2">
                        <span className="flex-1 min-w-0">
                          <span className="block truncate">
                            <span className="font-medium">{e.title}</span>
                            {e.category && <span className="text-[color:var(--text-muted)]"> · {e.category}</span>}
                            {e.project && <span className="text-[color:var(--text-muted)]"> · {e.project.key ?? e.project.name}</span>}
                          </span>
                          <span className="block text-[11px] text-[color:var(--text-muted)] tabular-nums">
                            {e.mode === 'hours' ? `${e.value}h/day` : `${e.value}% of day`} · {fmtDay(e.startDate)}
                            {e.endDate !== e.startDate ? ` → ${fmtDay(e.endDate)}` : ''}
                          </span>
                        </span>
                        {canEditEntries && (
                          <span className="flex items-center text-[color:var(--text-muted)]">
                            <button type="button" className="p-1.5 rounded hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)]" title="Edit" aria-label="Edit entry" onClick={() => onEditEntry(e)}>
                              <FiEdit2 />
                            </button>
                            <button type="button" className="p-1.5 rounded hover:text-red-400 hover:bg-[color:var(--bg-elevated)]" title="Delete" aria-label="Delete entry" onClick={() => setConfirm(e)}>
                              <FiTrash2 />
                            </button>
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ))}
            </div>
          </section>
        </div>

        {canEditEntries && (
          <footer className="px-5 py-3 border-t border-[color:var(--border-subtle)] flex justify-end">
            <button type="button" className={btnPrimary} onClick={onAddEntry}>
              <FiPlus /> Record engagement
            </button>
          </footer>
        )}
      </aside>
    </div>
      <ConfirmModal
        open={!!confirm}
        title="Remove engagement entry?"
        message={confirm ? `“${confirm.title}” will no longer count toward ${person.name}'s engagement.` : ''}
        confirmLabel="Remove"
        onConfirm={() => confirm && void remove(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </>,
    document.body
  );
}

function SummaryTable({ people, today, onOpen }: { people: EngagementPerson[]; today: string; onOpen: (userId: string) => void }) {
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
            <th className="px-3 py-2 font-medium text-right">Logged</th>
            <th className="px-3 py-2 font-medium">Next available</th>
            <th className="px-3 py-2 font-medium">Free</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--border-subtle)]">
          {people.map((p) => (
            <tr key={p.userId} onClick={() => onOpen(p.userId)} className="cursor-pointer hover:bg-[color:var(--bg-elevated)] transition-colors">
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <Avatar name={p.name} />
                  <div className="min-w-0">
                    <div className="text-[color:var(--text-primary)] font-medium truncate">{p.name}</div>
                    {p.department && <div className="text-[11px] text-[color:var(--text-muted)] truncate">{p.department}</div>}
                    {p.teams.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {p.teams.map((t) => (
                          <TeamChip key={t.id} name={t.name} color={t.color} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                <span className="inline-flex items-center gap-2">
                  <MiniBar pct={p.summary.avgEngagement} className="w-14" />
                  {p.summary.avgEngagement}%
                </span>
              </td>
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
              <td className="px-3 py-2 text-right tabular-nums">{p.summary.loggedHours}h</td>
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
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-4 py-3 text-xs text-[color:var(--text-muted)]">
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
        <span>
          · also counted: {report.settings.includeLoggedTime ? `${report.summary.loggedHours}h logged` : 'logged time off'},{' '}
          {report.settings.includeCalendarEvents ? `${report.summary.meetingHours}h meetings` : 'meetings off'},{' '}
          {report.summary.manualHours}h from {report.summary.manualEntries} manual entr{report.summary.manualEntries === 1 ? 'y' : 'ies'}
        </span>
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

/* ─── Manual engagement entries ──────────────────────────────────────────── */

interface EntryDraft {
  id?: string;
  userId: string;
  title: string;
  category: string;
  startDate: string;
  endDate: string;
  mode: 'hours' | 'percent';
  value: number;
  projectId: string;
  notes: string;
}

function blankEntry(userId: string, date: string): EntryDraft {
  return { userId, title: '', category: '', startDate: date, endDate: date, mode: 'hours', value: 2, projectId: '', notes: '' };
}

function draftFromEntry(userId: string, e: EngagementEntryRow): EntryDraft {
  return {
    id: e._id,
    userId,
    title: e.title,
    category: e.category ?? '',
    startDate: e.startDate,
    endDate: e.endDate,
    mode: e.mode,
    value: e.value,
    projectId: e.project?.id ?? '',
    notes: e.notes ?? '',
  };
}

function EntryModal({
  draft,
  people,
  projects,
  lockPerson,
  token,
  onClose,
  onSaved,
}: {
  draft: EntryDraft | null;
  people: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string; key: string }>;
  lockPerson: boolean;
  token: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [form, setForm] = useState<EntryDraft>(draft ?? blankEntry('', localTodayKey()));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (draft) {
      setForm(draft);
      setError('');
    }
  }, [draft]);

  const set = <K extends keyof EntryDraft>(k: K, v: EntryDraft[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.endDate < form.startDate) {
      setError('End must be on or after the start.');
      return;
    }
    setSaving(true);
    setError('');
    const body = {
      userId: form.userId,
      title: form.title,
      category: form.category,
      startDate: form.startDate,
      endDate: form.endDate,
      mode: form.mode,
      value: Number(form.value),
      projectId: form.projectId || null,
      notes: form.notes,
    };
    const res = form.id ? await resourcesApi.updateEngagementEntry(form.id, body, token) : await resourcesApi.createEngagementEntry(body, token);
    setSaving(false);
    if (!res.success) {
      setError(errorOf(res, 'Failed to save entry'));
      return;
    }
    onSaved(form.id ? 'Entry updated.' : 'Engagement recorded.');
  }

  return (
    <Modal
      open={!!draft}
      onClose={onClose}
      title={form.id ? 'Edit engagement entry' : 'Record engagement'}
      subtitle="Work that isn't a task or a meeting. Counted on every working day in the range."
    >
      <form onSubmit={submit} className="space-y-3">
        {error && <ErrorBanner message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Person">
            <select required disabled={lockPerson && !!form.userId} value={form.userId} onChange={(e) => set('userId', e.target.value)} className={kitInputCls}>
              <option value="">Select…</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category" hint="Free text, e.g. Support, Pre-sales, Training.">
            <input value={form.category} onChange={(e) => set('category', e.target.value)} className={kitInputCls} />
          </Field>
        </div>
        <Field label="What">
          <input required value={form.title} onChange={(e) => set('title', e.target.value)} className={kitInputCls} placeholder="e.g. L2 support rota" />
        </Field>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Field label="From">
            <input type="date" required value={form.startDate} onChange={(e) => set('startDate', e.target.value)} className={kitInputCls} />
          </Field>
          <Field label="To">
            <input type="date" required min={form.startDate} value={form.endDate} onChange={(e) => set('endDate', e.target.value)} className={kitInputCls} />
          </Field>
          <Field label="Measure">
            <select value={form.mode} onChange={(e) => set('mode', e.target.value as EntryDraft['mode'])} className={kitInputCls}>
              <option value="hours">Hours / day</option>
              <option value="percent">% of day</option>
            </select>
          </Field>
          <Field label={form.mode === 'hours' ? 'Hours' : 'Percent'}>
            <input
              type="number"
              required
              min={0.25}
              max={form.mode === 'hours' ? 24 : 200}
              step={form.mode === 'hours' ? 0.25 : 5}
              value={form.value}
              onChange={(e) => set('value', Number(e.target.value))}
              className={kitInputCls}
            />
          </Field>
        </div>
        <Field label="Project (optional)">
          <select value={form.projectId} onChange={(e) => set('projectId', e.target.value)} className={kitInputCls}>
            <option value="">None</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.key} · {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={kitInputCls} />
        </Field>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving} className={`${btnPrimary} px-4 py-2`}>
            {saving ? 'Saving…' : form.id ? 'Save changes' : 'Record'}
          </button>
          <button type="button" className={`${btnSecondary} px-4 py-2`} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
