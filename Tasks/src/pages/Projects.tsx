import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FiGrid, FiList, FiPlus, FiSearch, FiStar, FiUser, FiX } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import { dashboardApi, projectsApi, type Project, type ProjectHealth } from '../lib/api';
import ConfirmModal from '../components/ConfirmModal';
import ProjectFormModal from '../components/projects/ProjectFormModal';
import { ProjectCard, ProjectListRow, type ProjectMetrics, type ProjectRow } from '../components/projects/projectCards';
import { HEALTH } from '../components/dashboard/pmFormat';

type Sort = 'attention' | 'activity' | 'open' | 'progress' | 'name';
type HealthFilter = ProjectHealth | 'all';

const SORTS: Array<{ id: Sort; label: string }> = [
  { id: 'attention', label: 'Needs attention' },
  { id: 'activity', label: 'Recently active' },
  { id: 'open', label: 'Most open work' },
  { id: 'progress', label: 'Progress' },
  { id: 'name', label: 'Name' },
];
const HEALTH_ORDER: ProjectHealth[] = ['off_track', 'at_risk', 'on_track', 'idle'];
const HEALTH_RANK: Record<ProjectHealth, number> = { off_track: 0, at_risk: 1, on_track: 2, idle: 3 };
const STAR_KEY = 'atrium.projects.starred';
const PAGE_SIZE = 100;

function readStars(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(STAR_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** Every project the user can list, all pages. */
async function loadAllProjects(token: string): Promise<Project[]> {
  const out: Project[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const res = await projectsApi.list(page, PAGE_SIZE, token);
    if (!res.success || !res.data) break;
    out.push(...res.data.data);
    if (page >= res.data.totalPages) break;
  }
  return out;
}

export default function Projects() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [metrics, setMetrics] = useState<Map<string, ProjectMetrics>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [stars, setStars] = useState<Set<string>>(readStars);
  const [form, setForm] = useState<{ project: Project | null } | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [reload, setReload] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const q = params.get('q') ?? '';
  const view = params.get('view') === 'list' ? 'list' : 'grid';
  const sort = (SORTS.some((s) => s.id === params.get('sort')) ? params.get('sort') : 'attention') as Sort;
  const health = (params.get('health') ?? 'all') as HealthFilter;
  const mine = params.get('mine') === '1';
  const starredOnly = params.get('starred') === '1';
  const canCreate = Array.isArray(user?.permissions) && user.permissions.includes('project.project.create');

  const setParam = useCallback(
    (key: string, value: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          return next;
        },
        { replace: true }
      ),
    [setParams]
  );

  useEffect(() => {
    if (!token) return;
    let live = true;
    void Promise.all([loadAllProjects(token), dashboardApi.getOverview(token)]).then(([list, overview]) => {
      if (!live) return;
      setProjects(list);
      // Delivery data is best-effort: without it cards still list every project.
      if (overview.success && overview.data) setMetrics(new Map(overview.data.projects.map((m) => [m.id, m])));
    });
    return () => {
      live = false;
    };
  }, [token, reload]);

  // "/" focuses search, "n" opens New project — unless typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'n' && canCreate && !form) {
        e.preventDefault();
        setForm({ project: null });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canCreate, form]);

  const toggleStar = (id: string) =>
    setStars((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(STAR_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable — stars last for this visit */
      }
      return next;
    });

  const rows: ProjectRow[] = useMemo(
    () => (projects ?? []).map((p) => ({ project: p, metrics: metrics.get(p._id) ?? null, starred: stars.has(p._id) })),
    [projects, metrics, stars]
  );

  const counts = useMemo(() => {
    const c: Record<HealthFilter, number> = { all: rows.length, off_track: 0, at_risk: 0, on_track: 0, idle: 0 };
    for (const r of rows) if (r.metrics) c[r.metrics.health] += 1;
    return c;
  }, [rows]);
  const totals = useMemo(
    () =>
      rows.reduce(
        (t, r) => ({ open: t.open + (r.metrics?.open ?? 0), overdue: t.overdue + (r.metrics?.overdue ?? 0), sprints: t.sprints + (r.metrics?.activeSprint ? 1 : 0) }),
        { open: 0, overdue: 0, sprints: 0 }
      ),
    [rows]
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      const p = r.project;
      if (health !== 'all' && r.metrics?.health !== health) return false;
      if (mine && p.lead?._id !== user?.id) return false;
      if (starredOnly && !r.starred) return false;
      if (!needle) return true;
      return [p.name, p.key, p.description, p.lead?.name].some((v) => v?.toLowerCase().includes(needle));
    });
    const by: Record<Sort, (a: ProjectRow, b: ProjectRow) => number> = {
      attention: (a, b) =>
        (a.metrics ? HEALTH_RANK[a.metrics.health] : 9) - (b.metrics ? HEALTH_RANK[b.metrics.health] : 9) ||
        (b.metrics?.overdue ?? 0) - (a.metrics?.overdue ?? 0) ||
        (b.metrics?.open ?? 0) - (a.metrics?.open ?? 0),
      activity: (a, b) => (b.metrics?.lastActivity ?? '').localeCompare(a.metrics?.lastActivity ?? ''),
      open: (a, b) => (b.metrics?.open ?? -1) - (a.metrics?.open ?? -1),
      progress: (a, b) => (b.metrics?.progressPct ?? -1) - (a.metrics?.progressPct ?? -1),
      name: (a, b) => a.project.name.localeCompare(b.project.name),
    };
    // Starred projects lead, then the chosen order.
    return filtered.sort((a, b) => Number(b.starred) - Number(a.starred) || by[sort](a, b) || a.project.name.localeCompare(b.project.name));
  }, [rows, q, health, mine, starredOnly, sort, user?.id]);

  const filtersOn = Boolean(q || health !== 'all' || mine || starredOnly);
  const clearFilters = () =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        ['q', 'health', 'mine', 'starred'].forEach((k) => next.delete(k));
        return next;
      },
      { replace: true }
    );

  async function confirmDelete() {
    if (!token || !deleting) return;
    const res = await projectsApi.delete(deleting._id, token);
    if (res.success) {
      setProjects((prev) => (prev ?? []).filter((p) => p._id !== deleting._id));
      setDeleting(null);
    } else setError(res.message ?? 'Could not delete the project');
  }

  const attention = counts.off_track + counts.at_risk;
  const actions = { onStar: toggleStar, onEdit: (p: Project) => setForm({ project: p }), onDelete: setDeleting };

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-8 animate-fade-in">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-[color:var(--text-muted)]">
            {projects == null
              ? 'Loading…'
              : `${rows.length} project${rows.length === 1 ? '' : 's'} · ${totals.open} open issues · ${totals.sprints} active sprint${totals.sprints === 1 ? '' : 's'}`}
            {attention > 0 && <span className="font-medium text-amber-600 dark:text-amber-400"> · {attention} need attention</span>}
          </p>
        </div>
        {canCreate && (
          <button type="button" onClick={() => setForm({ project: null })} className="btn-primary inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm shadow-sm" title="New project (n)">
            <FiPlus /> New project
          </button>
        )}
      </header>

      {/* Health filters */}
      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <HealthTile active={health === 'all'} label="All projects" count={counts.all} hint={`${totals.overdue} overdue issues`} onClick={() => setParam('health', null)} />
        {HEALTH_ORDER.map((h) => (
          <HealthTile
            key={h}
            active={health === h}
            label={HEALTH[h].label}
            count={counts[h]}
            dot={HEALTH[h].dot}
            hint={HEALTH[h].hint}
            onClick={() => setParam('health', health === h ? null : h)}
          />
        ))}
      </div>

      {/* Toolbar */}
      <div className="sticky top-0 z-20 -mx-4 mt-4 flex flex-wrap items-center gap-2 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <label className="relative min-w-[12rem] flex-1 sm:max-w-sm">
          <FiSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
          <input
            ref={searchRef}
            value={q}
            onChange={(e) => setParam('q', e.target.value || null)}
            placeholder="Search name, key, lead…"
            className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] py-2 pl-9 pr-8 text-sm outline-none transition focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20"
          />
          {q ? (
            <button type="button" onClick={() => setParam('q', null)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]" aria-label="Clear search">
              <FiX />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-[color:var(--border-subtle)] px-1.5 text-[10px] text-[color:var(--text-muted)] sm:block">/</kbd>
          )}
        </label>

        <Toggle active={mine} onClick={() => setParam('mine', mine ? null : '1')} icon={<FiUser />} label="I lead" />
        <Toggle active={starredOnly} onClick={() => setParam('starred', starredOnly ? null : '1')} icon={<FiStar />} label="Starred" />

        <div className="ml-auto flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setParam('sort', e.target.value === 'attention' ? null : e.target.value)}
            className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2.5 py-2 text-sm outline-none focus:border-[color:var(--accent)]"
            aria-label="Sort projects"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                Sort: {s.label}
              </option>
            ))}
          </select>
          <div className="flex rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-0.5" role="group" aria-label="Layout">
            {(['grid', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setParam('view', v === 'grid' ? null : v)}
                aria-pressed={view === v}
                title={v === 'grid' ? 'Cards' : 'List'}
                className={`rounded-md p-1.5 transition ${view === v ? 'bg-[color:var(--accent)]/15 text-[color:var(--accent)]' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'}`}
              >
                {v === 'grid' ? <FiGrid /> : <FiList />}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}

      {/* Content */}
      <div className="mt-5">
        {projects == null ? (
          <Skeleton view={view} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No projects yet"
            body={canCreate ? 'Create a project to start tracking issues, sprints and docs.' : 'Ask a project lead to add you to a project.'}
            action={canCreate ? <button type="button" onClick={() => setForm({ project: null })} className="btn-primary rounded-lg px-4 py-2 text-sm">Create your first project</button> : undefined}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No projects match"
            body="Try another search or clear the filters."
            action={<button type="button" onClick={clearFilters} className="rounded-lg border border-[color:var(--border-subtle)] px-4 py-2 text-sm hover:border-[color:var(--accent)]/40">Clear filters</button>}
          />
        ) : view === 'grid' ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visible.map((r) => (
              <ProjectCard key={r.project._id} row={r} {...actions} />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow">
            <table className="w-full min-w-[640px] text-left">
              <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
                <tr>
                  <th className="w-8 py-2.5 pl-3" />
                  <th className="py-2.5 pr-3 font-medium">Project</th>
                  <th className="px-3 py-2.5 font-medium">Health</th>
                  <th className="px-3 py-2.5 font-medium">Progress</th>
                  <th className="px-3 py-2.5 text-right font-medium">Open</th>
                  <th className="px-3 py-2.5 text-right font-medium">Overdue</th>
                  <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Sprint</th>
                  <th className="hidden px-3 py-2.5 font-medium md:table-cell">Lead</th>
                  <th className="hidden px-3 py-2.5 font-medium xl:table-cell">Active</th>
                  <th className="w-10 pr-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <ProjectListRow key={r.project._id} row={r} {...actions} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {filtersOn && visible.length > 0 && (
          <p className="mt-4 text-center text-xs text-[color:var(--text-muted)]">
            Showing {visible.length} of {rows.length} ·{' '}
            <button type="button" onClick={clearFilters} className="text-[color:var(--accent)] hover:underline">
              clear filters
            </button>
          </p>
        )}
      </div>

      {form && (
        <ProjectFormModal
          project={form.project}
          onClose={() => setForm(null)}
          onSaved={(saved) => {
            const created = !form.project;
            setForm(null);
            setReload((n) => n + 1);
            if (created && saved?._id) navigate(`/projects/${saved._id}/dashboard`);
          }}
        />
      )}

      <ConfirmModal
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? 'project'}?`}
        message={`This permanently deletes ${deleting?.key ?? 'the project'} and cannot be undone.`}
        confirmLabel="Delete project"
        variant="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

function HealthTile({ active, label, count, dot, hint, onClick }: { active: boolean; label: string; count: number; dot?: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={active}
      className={`rounded-xl border px-4 py-3 text-left transition ${
        active
          ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/[0.08] ring-1 ring-[color:var(--accent)]/25'
          : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] hover:border-[color:var(--accent)]/40'
      }`}
    >
      <span className="flex items-center gap-1.5 text-xs text-[color:var(--text-muted)]">
        {dot && <span className="h-2 w-2 rounded-full" style={{ background: dot }} />}
        {label}
      </span>
      <span className="mt-0.5 block text-2xl font-bold tabular-nums">{count}</span>
    </button>
  );
}

function Toggle({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition ${
        active
          ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/10 text-[color:var(--accent)]'
          : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function Skeleton({ view }: { view: 'grid' | 'list' }) {
  if (view === 'list') {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-12 rounded-xl skeleton" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-72 rounded-2xl skeleton" />
      ))}
    </div>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-[color:var(--border-subtle)] px-6 py-16 text-center">
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[color:var(--accent)]/10 text-[color:var(--accent)]">
        <FiGrid className="h-5 w-5" />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-[color:var(--text-muted)]">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
