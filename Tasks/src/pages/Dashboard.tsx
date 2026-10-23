import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FiAlertTriangle,
  FiCalendar,
  FiCheckCircle,
  FiChevronDown,
  FiClock,
  FiFlag,
  FiFolder,
  FiGrid,
  FiInbox,
  FiList,
  FiPlus,
  FiRefreshCw,
  FiUserX,
  FiUsers,
  FiZap,
} from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import { buildPmNav } from '../components/moduleNavigation';
import { dashboardApi, type DashboardOverview, type OverviewIssueRef, type ProjectHealth } from '../lib/api';
import { HEALTH, addDays, useDismiss } from '../components/dashboard/pmFormat';
import {
  ActivityFeed,
  AttentionList,
  Avatar,
  BarList,
  Card,
  Empty,
  FilterPill,
  HoursChart,
  IssueTable,
  Kpi,
  FlowVerdict,
  MilestoneList,
  ProjectRows,
  SprintList,
  StatusBreakdown,
  TrendChart,
} from '../components/dashboard/PmWidgets';

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const MENU_HINTS: Record<string, string> = {
  '/projects': 'Browse and create projects',
  '/issues': 'Search issues across projects',
  '/timesheet': 'Log and review time',
  '/project-templates': 'Reusable project setups',
  '/estimates': 'Estimate vs actual',
  '/workload': 'Open work per person',
  '/portfolio': 'Progress across projects',
  '/performance-report': 'Who did what, and how long',
  '/analytics': 'Charts and trends',
  '/reports': 'Saved and custom reports',
  '/defect-metrics': 'Bugs by status and priority',
  '/executive': 'Leadership summary',
  '/audit-logs': 'Who changed what',
};

type Tab = 'overview' | 'mine' | 'projects' | 'delivery' | 'team';

const TABS: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <FiGrid /> },
  { id: 'mine', label: 'My work', icon: <FiInbox /> },
  { id: 'projects', label: 'Projects', icon: <FiFolder /> },
  { id: 'delivery', label: 'Sprints & milestones', icon: <FiFlag /> },
  { id: 'team', label: 'Team', icon: <FiUsers /> },
];

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function Dashboard() {
  const { token, user } = useAuth();
  const workspaceKey = user?.activeOrganizationId ?? '';
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview') as Tab;
  const projectId = params.get('project') ?? '';
  const [weeks, setWeeks] = useState(8);
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [projectList, setProjectList] = useState<DashboardOverview['projects']>([]);
  const [error, setError] = useState('');
  const [loadedKey, setLoadedKey] = useState('');
  const [tick, setTick] = useState(0);
  const requestKey = [projectId, weeks, workspaceKey, tick].join('|');
  const loading = loadedKey !== requestKey;

  function setParam(k: string, v: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v && !(k === 'tab' && v === 'overview')) next.set(k, v);
        else next.delete(k);
        return next;
      },
      { replace: true }
    );
  }

  useEffect(() => {
    if (!token) return;
    let stale = false;
    dashboardApi.getOverview(token, { projectId: projectId || undefined, weeks }).then((res) => {
      if (stale) return;
      setLoadedKey(requestKey);
      if (res.success && res.data) {
        setData(res.data);
        setError('');
        // Keep the full project list for the picker while a single project is selected.
        if (!projectId) setProjectList(res.data.projects);
      } else setError((res as { message?: string }).message ?? 'Failed to load the dashboard');
    });
    return () => {
      stale = true;
    };
  }, [token, projectId, weeks, requestKey]);

  const menu = useMemo(() => buildPmNav(user).filter((n) => n.to !== '/dashboard'), [user]);
  const firstName = (user?.name ?? '').split(/\s+/)[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const pickerProjects = projectList.length ? projectList : (data?.projects ?? []);

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in w-full space-y-5">
      {/* Header */}
      <header className="relative overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-5 py-5 sm:px-7">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 100% at 0% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 55%), radial-gradient(ellipse 50% 80% at 100% 100%, color-mix(in srgb, #0ea5e9 10%, transparent), transparent 45%)',
          }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">Project management</p>
            <h1 className="text-2xl font-bold tracking-tight mt-1">
              {greeting}
              {firstName ? `, ${firstName}` : ''}
            </h1>
            <p className="text-[13px] text-[color:var(--text-muted)] mt-1">
              {data
                ? `${data.kpis.openIssues} open issues across ${data.scope.projects} project${data.scope.projects === 1 ? '' : 's'} · ${data.kpis.overdue} overdue · ${data.kpis.dueThisWeek} due in the next 7 days`
                : 'Loading your workspace…'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={projectId}
              onChange={(e) => setParam('project', e.target.value)}
              className="h-9 px-3 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm max-w-[14rem]"
              aria-label="Project"
            >
              <option value="">All my projects</option>
              {pickerProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key} · {p.name}
                </option>
              ))}
            </select>
            <select
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              className="h-9 px-3 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm"
              aria-label="Trend period"
            >
              {[4, 8, 12, 26].map((w) => (
                <option key={w} value={w}>
                  Last {w} weeks
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setTick((t) => t + 1)}
              className="h-9 w-9 grid place-items-center rounded-lg border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
              title="Refresh"
              aria-label="Refresh"
            >
              <FiRefreshCw className={loading ? 'animate-spin' : ''} />
            </button>
            <CreateMenu projects={pickerProjects} />
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex gap-1 overflow-x-auto border-b border-[color:var(--border-subtle)]" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setParam('tab', t.id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'border-[color:var(--accent)] text-[color:var(--text-primary)]'
                : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
            }`}
          >
            {t.icon}
            {t.label}
            {t.id === 'mine' && data && data.myWork.overdue > 0 && (
              <span className="ml-0.5 rounded-full bg-red-500/15 text-red-500 text-[10px] px-1.5 tabular-nums">{data.myWork.overdue}</span>
            )}
          </button>
        ))}
      </nav>

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-center justify-between">
          {error}
          <button type="button" className="text-xs underline" onClick={() => setTick((t) => t + 1)}>
            Retry
          </button>
        </div>
      )}

      {!data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-24 rounded-xl skeleton" />
            ))}
          </div>
          <div className="h-72 rounded-2xl skeleton" />
        </div>
      ) : data.scope.projects === 0 ? (
        <Empty
          title="No projects yet"
          body="You aren't a member of any project in this workspace. Create one, or ask a project lead to add you."
          action={
            <Link to="/projects" className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm">
              <FiPlus /> Go to projects
            </Link>
          }
        />
      ) : (
        <div className={loading ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
          {tab === 'overview' && <OverviewTab data={data} menu={menu} onTab={(t) => setParam('tab', t)} />}
          {tab === 'mine' && <MyWorkTab data={data} />}
          {tab === 'projects' && <ProjectsTab data={data} />}
          {tab === 'delivery' && <DeliveryTab data={data} />}
          {tab === 'team' && <TeamTab data={data} />}
        </div>
      )}
    </div>
  );
}

/* ─── Tabs ───────────────────────────────────────────────────────────────── */

function OverviewTab({ data, menu, onTab }: { data: DashboardOverview; menu: ReturnType<typeof buildPmNav>; onTab: (t: Tab) => void }) {
  const k = data.kpis;
  const riskProjects = data.projects.filter((p) => p.health === 'off_track' || p.health === 'at_risk');
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={<FiList />} label="Open issues" value={k.openIssues} hint={`${k.completionPct}% of ${k.totalIssues} done`} progress={k.completionPct} />
        <Kpi icon={<FiCheckCircle />} label="Completed this week" value={k.completedThisWeek} delta={k.completedThisWeek - k.completedLastWeek} hint={`${k.completedLastWeek} last week`} />
        <Kpi icon={<FiZap />} label="Created this week" value={k.createdThisWeek} delta={k.createdThisWeek - k.createdLastWeek} deltaGoodWhenDown hint={`${k.createdLastWeek} last week`} />
        <Kpi icon={<FiAlertTriangle />} label="Overdue" value={k.overdue} tone={k.overdue ? 'bad' : 'good'} hint={`${k.dueThisWeek} due in 7 days`} />
        <Kpi icon={<FiUserX />} label="Unassigned" value={k.unassigned} tone={k.unassigned ? 'warn' : undefined} hint="Open issues with no owner" />
        <Kpi
          icon={<FiClock />}
          label="Logged this week"
          value={`${k.loggedHoursThisWeek}h`}
          delta={Math.round((k.loggedHoursThisWeek - k.loggedHoursLastWeek) * 10) / 10}
          deltaSuffix="h"
          hint={k.medianCycleDays != null ? `Median cycle ${k.medianCycleDays}d` : `${k.loggedHoursLastWeek}h last week`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card
          title="Flow"
          subtitle={`Issues created vs completed per week · last ${data.trend.length} weeks`}
          actions={<FlowVerdict trend={data.trend} />}
        >
          <TrendChart trend={data.trend} />
        </Card>
        <Card title="Needs attention" subtitle="Overdue work and unowned work due soon">
          <AttentionList data={data} onMore={() => onTab('projects')} moreLabel="see by project" />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Status" subtitle={`${k.totalIssues} issues by workflow status`}>
          <StatusBreakdown rows={data.byStatus} />
        </Card>
        <Card title="Open work by type">
          <BarList rows={data.byType} />
        </Card>
        <Card title="Open work by priority">
          <BarList rows={data.byPriority} />
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card
          title="Project health"
          subtitle={riskProjects.length ? `${riskProjects.length} of ${data.projects.length} projects need attention` : 'All projects on track'}
          actions={
            <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => onTab('projects')}>
              All projects →
            </button>
          }
        >
          <ProjectRows projects={data.projects.slice(0, 6)} compact />
        </Card>
        <Card title="Recent activity">
          <ActivityFeed items={data.activity.slice(0, 8)} />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Active sprints"
          subtitle={`${k.activeSprints} running`}
          actions={
            <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => onTab('delivery')}>
              Sprints & milestones →
            </button>
          }
        >
          <SprintList sprints={data.sprints.filter((s) => s.status === 'active').slice(0, 4)} />
        </Card>
        <Card title="Upcoming milestones" subtitle={k.lateMilestones ? `${k.lateMilestones} late` : undefined}>
          <MilestoneList milestones={data.milestones.slice(0, 5)} />
        </Card>
      </div>

      <Card title="Workspace menu" subtitle="Everything in project management you have access to">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {menu.map((m) => (
            <Link
              key={m.to}
              to={m.to}
              className="group flex items-start gap-3 rounded-xl border border-[color:var(--border-subtle)] px-3 py-2.5 hover:border-[color:var(--accent)]/50 hover:bg-[color:var(--bg-elevated)] transition-colors"
            >
              <span className="mt-0.5 w-8 h-8 shrink-0 rounded-lg grid place-items-center bg-[color:var(--accent-subtle)] text-[color:var(--accent)] [&_svg]:w-4 [&_svg]:h-4">{m.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium group-hover:text-[color:var(--accent)]">{m.label}</span>
                <span className="block text-[11px] text-[color:var(--text-muted)] truncate">{MENU_HINTS[m.to] ?? 'Open'}</span>
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}

function MyWorkTab({ data }: { data: DashboardOverview }) {
  const m = data.myWork;
  const groups: Array<{ title: string; items: OverviewIssueRef[]; tone?: string }> = [
    { title: 'Overdue', items: m.items.filter((i) => i.dueDate && i.dueDate < data.today), tone: 'text-red-500' },
    {
      title: 'Due in the next 7 days',
      items: m.items.filter((i) => i.dueDate && i.dueDate >= data.today && i.dueDate < addDays(data.today, 7)),
    },
    { title: 'Later', items: m.items.filter((i) => i.dueDate && i.dueDate >= addDays(data.today, 7)) },
    { title: 'No due date', items: m.items.filter((i) => !i.dueDate) },
  ];
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi icon={<FiInbox />} label="Assigned to me" value={m.open} hint="Open issues" />
        <Kpi icon={<FiAlertTriangle />} label="Overdue" value={m.overdue} tone={m.overdue ? 'bad' : 'good'} />
        <Kpi icon={<FiCalendar />} label="Due in 7 days" value={m.dueThisWeek} tone={m.dueThisWeek ? 'warn' : undefined} />
        <Kpi icon={<FiCheckCircle />} label="Completed this week" value={m.completedThisWeek} />
        <Kpi icon={<FiClock />} label="Logged this week" value={`${m.loggedHoursThisWeek}h`} hint={<Link to="/timesheet" className="text-[color:var(--accent)] hover:underline">Open timesheet</Link>} />
      </div>
      {m.items.length === 0 ? (
        <Empty title="Nothing assigned to you" body="Open issues assigned to you will show up here, soonest due first." />
      ) : (
        <Card
          title="My open issues"
          subtitle={m.open > m.items.length ? `Showing the ${m.items.length} due soonest of ${m.open}` : undefined}
          actions={
            <Link to="/issues" className="text-xs text-[color:var(--accent)] hover:underline">
              All issues →
            </Link>
          }
        >
          <div className="space-y-4">
            {groups
              .filter((g) => g.items.length)
              .map((g) => (
                <div key={g.title}>
                  <h4 className={`text-[11px] font-semibold uppercase tracking-wider mb-1 ${g.tone ?? 'text-[color:var(--text-muted)]'}`}>
                    {g.title} · {g.items.length}
                  </h4>
                  <IssueTable items={g.items} today={data.today} hideAssignee />
                </div>
              ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ProjectsTab({ data }: { data: DashboardOverview }) {
  const [health, setHealth] = useState<ProjectHealth | 'all'>('all');
  const counts = data.projects.reduce<Record<string, number>>((acc, p) => ({ ...acc, [p.health]: (acc[p.health] ?? 0) + 1 }), {});
  const shown = health === 'all' ? data.projects : data.projects.filter((p) => p.health === health);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5 text-xs">
        <FilterPill active={health === 'all'} onClick={() => setHealth('all')} label="All" count={data.projects.length} />
        {(Object.keys(HEALTH) as ProjectHealth[]).map((h) => (
          <FilterPill key={h} active={health === h} onClick={() => setHealth(h)} label={HEALTH[h].label} count={counts[h] ?? 0} dot={HEALTH[h].dot} />
        ))}
      </div>
      <Card title="Projects" subtitle="Sorted by health, then open work. Hover a status for how it's worked out.">
        <ProjectRows projects={shown} />
      </Card>
    </div>
  );
}

function DeliveryTab({ data }: { data: DashboardOverview }) {
  const active = data.sprints.filter((s) => s.status === 'active');
  const planned = data.sprints.filter((s) => s.status === 'planned');
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title="Active sprints" subtitle="Done vs time elapsed — work behind the time marker is at risk">
        <SprintList sprints={active} />
      </Card>
      <Card title="Milestones" subtitle="Open milestones, soonest first">
        <MilestoneList milestones={data.milestones} />
      </Card>
      {planned.length > 0 && (
        <Card title="Planned sprints">
          <SprintList sprints={planned} />
        </Card>
      )}
    </div>
  );
}

function TeamTab({ data }: { data: DashboardOverview }) {
  const max = Math.max(1, ...data.team.map((t) => t.open));
  return (
    <div className="space-y-5">
      <Card
        title="Team load"
        subtitle="Open assigned work per person, with what they completed in the last 14 days"
        actions={
          <Link to="/workload" className="text-xs text-[color:var(--accent)] hover:underline">
            Workload →
          </Link>
        }
      >
        {data.team.length === 0 ? (
          <p className="text-sm text-[color:var(--text-muted)]">No assigned work yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)]">
                  <th className="py-2 pr-3 font-medium">Person</th>
                  <th className="py-2 px-3 font-medium w-[40%]">Open work</th>
                  <th className="py-2 px-3 font-medium text-right">Overdue</th>
                  <th className="py-2 px-3 font-medium text-right">Due in 7d</th>
                  <th className="py-2 px-3 font-medium text-right">Points</th>
                  <th className="py-2 px-3 font-medium text-right">Done 14d</th>
                  <th className="py-2 pl-3 font-medium text-right">Logged wk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border-subtle)]">
                {data.team.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        <Avatar name={t.name} />
                        <span className="truncate">{t.name}</span>
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <span className="flex items-center gap-2">
                        <span className="flex-1 h-2 rounded-full bg-[color:var(--bg-elevated)] overflow-hidden flex gap-px">
                          <span className="h-full rounded-l-full bg-red-500" style={{ width: `${(t.overdue / max) * 100}%` }} title={`${t.overdue} overdue`} />
                          <span className="h-full bg-[color:var(--accent)]" style={{ width: `${((t.open - t.overdue) / max) * 100}%` }} title={`${t.open - t.overdue} on time`} />
                        </span>
                        <span className="w-8 text-right tabular-nums">{t.open}</span>
                      </span>
                    </td>
                    <td className={`py-2 px-3 text-right tabular-nums ${t.overdue ? 'text-red-500' : ''}`}>{t.overdue}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{t.dueSoon}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{t.points}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{t.completed14}</td>
                    <td className="py-2 pl-3 text-right tabular-nums">{t.loggedHoursThisWeek}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Hours logged per week">
          <HoursChart trend={data.trend} />
        </Card>
        <Card title="Recent activity">
          <ActivityFeed items={data.activity} />
        </Card>
      </div>
    </div>
  );
}

/* ─── Pieces ─────────────────────────────────────────────────────────────── */

function CreateMenu({ projects }: { projects: DashboardOverview['projects'] }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} className="btn-primary h-9 inline-flex items-center gap-1.5 px-3 rounded-lg text-sm">
        <FiPlus /> Create <FiChevronDown className="opacity-70" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] shadow-xl py-1">
          <Link role="menuitem" to="/projects" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[color:var(--bg-elevated)]">
            <FiFolder /> New project
          </Link>
          <Link role="menuitem" to="/timesheet" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-[color:var(--bg-elevated)]">
            <FiClock /> Log time
          </Link>
          {projects.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-[color:var(--text-muted)] border-t border-[color:var(--border-subtle)] mt-1">New issue in…</div>
              <div className="max-h-56 overflow-y-auto">
                {projects.map((p) => (
                  <Link key={p.id} role="menuitem" to={`/projects/${p.id}/issues?create=1`} onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-[color:var(--bg-elevated)]">
                    <span className="font-mono text-[11px] text-[color:var(--text-muted)] w-12 truncate">{p.key}</span>
                    <span className="truncate">{p.name}</span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
