import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  FiAlertTriangle,
  FiBarChart2,
  FiCalendar,
  FiCheckCircle,
  FiClock,
  FiColumns,
  FiFlag,
  FiGrid,
  FiLayers,
  FiList,
  FiMap,
  FiPlus,
  FiRefreshCw,
  FiSettings,
  FiTarget,
  FiUserX,
  FiUsers,
  FiZap,
} from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationsContext';
import {
  dashboardApi,
  projectsApi,
  type DashboardOverview,
  type EstimatesResponse,
  type Project,
  type ProjectMetricsResponse,
} from '../lib/api';
import { formatMinutes } from '../components/issue/WorkLogInput';
import { userHasPermission } from '../utils/permissions';
import { PROJECT_PERMISSIONS } from '@shared/constants/permissions';
import { RelatedRecords } from '../components/RelatedRecords';
import { chartTooltipProps } from '../lib/chartTheme';
import { HEALTH, SERIES, fmtDate } from '../components/dashboard/pmFormat';
import {
  ActivityFeed,
  AttentionList,
  Avatar,
  BarList,
  Card,
  Empty,
  FlowVerdict,
  HoursChart,
  Kpi,
  MilestoneList,
  SprintList,
  StatusBreakdown,
  TrendChart,
} from '../components/dashboard/PmWidgets';

type Tab = 'overview' | 'delivery' | 'breakdown' | 'team';
const TABS: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <FiGrid /> },
  { id: 'delivery', label: 'Delivery', icon: <FiFlag /> },
  { id: 'breakdown', label: 'Breakdown', icon: <FiBarChart2 /> },
  { id: 'team', label: 'Team & activity', icon: <FiUsers /> },
];

export default function ProjectDashboard() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const { token } = useAuth();
  const { subscribeProject } = useNotifications();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview') as Tab;
  const [weeks, setWeeks] = useState(8);
  const [tick, setTick] = useState(0);
  const [project, setProject] = useState<Project | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [metrics, setMetrics] = useState<ProjectMetricsResponse | null>(null);
  const [estimates, setEstimates] = useState<EstimatesResponse | null>(null);
  const [canManageSettings, setCanManageSettings] = useState(false);
  const [error, setError] = useState('');
  const [loadedKey, setLoadedKey] = useState('');
  const requestKey = [projectId, weeks, tick].join('|');
  const loading = loadedKey !== requestKey;

  // Live updates from issue changes in this project.
  useEffect(() => {
    if (!projectId) return;
    return subscribeProject(projectId, () => setTick((t) => t + 1));
  }, [projectId, subscribeProject]);

  useEffect(() => {
    if (!token || !projectId) return;
    let stale = false;
    Promise.all([
      projectsApi.get(projectId, token),
      dashboardApi.getOverview(token, { projectId, weeks }),
      dashboardApi.getProjectMetrics(token, projectId),
      dashboardApi.getEstimates(token, projectId),
      projectsApi.getMyPermissions(projectId, token),
    ]).then(([proj, ov, met, est, perms]) => {
      if (stale) return;
      setLoadedKey(requestKey);
      if (proj.success && proj.data) setProject(proj.data);
      if (ov.success && ov.data) {
        setOverview(ov.data);
        setError('');
      } else setError((ov as { message?: string }).message ?? 'Failed to load the project dashboard');
      setMetrics(met.success && met.data ? met.data : null);
      setEstimates(est.success && est.data ? est.data : null);
      if (perms.success && perms.data && 'permissions' in perms.data) {
        const list = (perms.data as { permissions: string[] }).permissions ?? [];
        setCanManageSettings(userHasPermission(list, PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE));
      }
    });
    return () => {
      stale = true;
    };
  }, [token, projectId, weeks, requestKey]);

  function setTab(t: Tab) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (t === 'overview') next.delete('tab');
        else next.set('tab', t);
        return next;
      },
      { replace: true }
    );
  }

  const base = `/projects/${projectId}`;
  const health = overview?.projects[0];
  const k = overview?.kpis;

  const quickLinks: Array<{ to: string; label: string; icon: ReactNode; primary?: boolean }> = [
    { to: `${base}/issues?create=1`, label: 'New issue', icon: <FiPlus />, primary: true },
    { to: `${base}/issues`, label: 'Issues', icon: <FiList /> },
    { to: `${base}/boards`, label: 'Board', icon: <FiColumns /> },
    { to: `${base}/backlog`, label: 'Backlog', icon: <FiLayers /> },
    { to: `${base}/sprints`, label: 'Sprints', icon: <FiZap /> },
    { to: `${base}/roadmap`, label: 'Roadmap', icon: <FiMap /> },
    { to: `${base}/timesheet`, label: 'Log time', icon: <FiClock /> },
    ...(canManageSettings ? [{ to: `${base}/settings`, label: 'Settings', icon: <FiSettings /> }] : []),
  ];

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
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              {project && <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)]">{project.key}</span>}
              {health && (
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${HEALTH[health.health].cls}`} title={HEALTH[health.health].hint}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: HEALTH[health.health].dot }} />
                  {HEALTH[health.health].label}
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight mt-1.5 truncate">{project?.name ?? 'Project dashboard'}</h1>
            {project?.description ? (
              <p className="text-[13px] text-[color:var(--text-muted)] mt-1 line-clamp-2">{project.description}</p>
            ) : null}
            <p className="text-[12px] text-[color:var(--text-muted)] mt-1.5">
              {project?.lead && <>Lead: <span className="text-[color:var(--text-primary)]">{project.lead.name}</span> · </>}
              {k ? `${k.openIssues} open · ${k.overdue} overdue · ${k.completionPct}% complete` : 'Loading…'}
              {health?.lastActivity && <> · updated {fmtDate(health.lastActivity)}</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
          </div>
        </div>

        {/* Quick actions */}
        <div className="relative mt-4 flex flex-wrap gap-1.5">
          {quickLinks.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className={
                l.primary
                  ? 'btn-primary inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium'
                  : 'inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-medium border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/60 text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:border-[color:var(--accent)]/50'
              }
            >
              {l.icon}
              {l.label}
            </Link>
          ))}
        </div>
      </header>

      {project && (project.crmAccountId || project.orgId) && (
        <RelatedRecords
          items={[
            ...(project.crmAccountId ? [{ label: 'CRM account', text: 'Open account', to: `/crm/accounts/${project.crmAccountId}` }] : []),
            ...(project.orgId ? [{ label: 'Customer portal', text: 'Organisation', to: `/admin/customer-orgs/${project.orgId}` }] : []),
            { label: 'Billing', text: 'Invoices', to: '/billing/invoices' },
            { label: 'Service Desk', text: 'Tickets', to: '/service/tickets' },
            { label: 'Resources', text: 'Engagement', to: `/resources/engagement?project=${projectId}` },
          ]}
        />
      )}

      <nav className="flex gap-1 overflow-x-auto border-b border-[color:var(--border-subtle)]" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === t.id
                ? 'border-[color:var(--accent)] text-[color:var(--text-primary)]'
                : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
            }`}
          >
            {t.icon}
            {t.label}
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

      {!overview ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-24 rounded-xl skeleton" />
            ))}
          </div>
          <div className="h-72 rounded-2xl skeleton" />
        </div>
      ) : overview.scope.projects === 0 ? (
        <Empty title="Insights are for project members" body="Ask the project lead to add you to this project to see its delivery insights." />
      ) : overview.kpis.totalIssues === 0 ? (
        <Empty
          title="No issues yet"
          body="Create the first issue, or import existing work, to see delivery insights here."
          action={
            <div className="flex justify-center gap-2">
              <Link to={`${base}/issues?create=1`} className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm">
                <FiPlus /> New issue
              </Link>
              <Link to={`${base}/import`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-[color:var(--border-subtle)]">
                Import
              </Link>
            </div>
          }
        />
      ) : (
        <div className={loading ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
          {tab === 'overview' && <OverviewTab data={overview} estimates={estimates} base={base} onTab={setTab} />}
          {tab === 'delivery' && <DeliveryTab data={overview} metrics={metrics} estimates={estimates} base={base} />}
          {tab === 'breakdown' && <BreakdownTab data={overview} metrics={metrics} project={project} base={base} />}
          {tab === 'team' && <TeamTab data={overview} base={base} />}
        </div>
      )}
    </div>
  );
}

/* ─── Tabs ───────────────────────────────────────────────────────────────── */

function OverviewTab({ data, estimates, base, onTab }: { data: DashboardOverview; estimates: EstimatesResponse | null; base: string; onTab: (t: Tab) => void }) {
  const navigate = useNavigate();
  const k = data.kpis;
  const sprint = data.sprints.find((s) => s.status === 'active');
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <LinkKpi to={`${base}/issues`}>
          <Kpi icon={<FiList />} label="Open issues" value={k.openIssues} hint={`${k.completionPct}% of ${k.totalIssues} done`} progress={k.completionPct} />
        </LinkKpi>
        <Kpi icon={<FiCheckCircle />} label="Completed this week" value={k.completedThisWeek} delta={k.completedThisWeek - k.completedLastWeek} hint={`${k.completedLastWeek} last week`} />
        <Kpi icon={<FiAlertTriangle />} label="Overdue" value={k.overdue} tone={k.overdue ? 'bad' : 'good'} hint={`${k.dueThisWeek} due in 7 days`} />
        <Kpi icon={<FiUserX />} label="Unassigned" value={k.unassigned} tone={k.unassigned ? 'warn' : undefined} hint="Open, no owner" />
        <LinkKpi to={`${base}/issues?hasEstimate=false`}>
          <Kpi
            icon={<FiTarget />}
            label="Expected delivery"
            value={estimates?.expectedDeliveryDate ? fmtDate(estimates.expectedDeliveryDate, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
            hint={
              estimates?.expectedDeliveryDate
                ? estimates.usedDefaultBurnRate
                  ? 'At a default burn rate'
                  : `${estimates.unestimatedIssuesCount ?? 0} unestimated`
                : 'Log time on done work to forecast'
            }
          />
        </LinkKpi>
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
        <Card title="Flow" subtitle={`Issues created vs completed per week · last ${data.trend.length} weeks`} actions={<FlowVerdict trend={data.trend} />}>
          <TrendChart trend={data.trend} />
        </Card>
        <Card title="Needs attention" subtitle="Overdue work and unowned work due soon">
          <AttentionList data={data} onMore={() => navigate(`${base}/issues`)} moreLabel="open issues" />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card
          title="Current sprint"
          subtitle={sprint ? undefined : 'No sprint running'}
          actions={
            sprint && (
              <Link to={`${base}/sprints/${sprint.id}/report`} className="text-xs text-[color:var(--accent)] hover:underline">
                Sprint report →
              </Link>
            )
          }
        >
          {sprint ? (
            <SprintList sprints={[sprint]} />
          ) : (
            <Link to={`${base}/sprints`} className="text-sm text-[color:var(--accent)] hover:underline">
              Plan a sprint →
            </Link>
          )}
        </Card>
        <Card title="Status" subtitle={`${k.totalIssues} issues`}>
          <StatusBreakdown rows={data.byStatus} />
        </Card>
        <Card
          title="Next milestones"
          subtitle={k.lateMilestones ? `${k.lateMilestones} late` : undefined}
          actions={
            <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => onTab('delivery')}>
              Delivery →
            </button>
          }
        >
          <MilestoneList milestones={data.milestones.slice(0, 4)} />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Who's on it" subtitle="Open work per person">
          <TeamBars team={data.team.slice(0, 6)} />
        </Card>
        <Card
          title="Recent activity"
          actions={
            <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => onTab('team')}>
              More →
            </button>
          }
        >
          <ActivityFeed items={data.activity.slice(0, 6)} />
        </Card>
      </div>
    </div>
  );
}

function DeliveryTab({ data, metrics, estimates, base }: { data: DashboardOverview; metrics: ProjectMetricsResponse | null; estimates: EstimatesResponse | null; base: string }) {
  const active = data.sprints.filter((s) => s.status === 'active');
  const planned = data.sprints.filter((s) => s.status === 'planned');
  const est = estimates;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<FiClock />} label="Total estimate" value={est ? formatMinutes(est.totalMinutes) : '—'} />
        <Kpi icon={<FiLayers />} label="Remaining estimate" value={est?.remainingEstimateMinutes != null ? formatMinutes(est.remainingEstimateMinutes) : '—'} />
        <Kpi
          icon={<FiCalendar />}
          label="Expected delivery"
          value={est?.expectedDeliveryDate ? fmtDate(est.expectedDeliveryDate, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
          hint={est?.burnRatePerDay ? `Burn ${formatMinutes(Math.round(est.burnRatePerDay))}/day${est.usedDefaultBurnRate ? ' (default)' : ''}` : undefined}
        />
        <LinkKpi to={`${base}/issues?hasEstimate=false`}>
          <Kpi icon={<FiAlertTriangle />} label="No estimate" value={est?.unestimatedIssuesCount ?? '—'} tone={est?.unestimatedIssuesCount ? 'warn' : undefined} hint="Issues without a time estimate" />
        </LinkKpi>
      </div>

      <Card title="Estimated vs logged time" subtitle="Cumulative time logged against the current total estimate">
        <EstimateChart metrics={metrics} />
      </Card>

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
    </div>
  );
}

function BreakdownTab({ data, metrics, project, base }: { data: DashboardOverview; metrics: ProjectMetricsResponse | null; project: Project | null; base: string }) {
  const statusColor = (name: string) => project?.statuses?.find((s) => s.name === name)?.color;
  const typeColor = (name: string) => project?.issueTypes?.find((t) => t.name === name)?.color;
  const pivot = useMemo(() => {
    if (!metrics?.typeVsStatus?.length) return null;
    const order = metrics.projectStatuses ?? [];
    const statuses = [...new Set(metrics.typeVsStatus.map((r) => r.status))].sort((a, b) => {
      const i = order.indexOf(a);
      const j = order.indexOf(b);
      return (i === -1 ? 999 : i) - (j === -1 ? 999 : j) || a.localeCompare(b);
    });
    const types = [...new Set(metrics.typeVsStatus.map((r) => r.type))].sort();
    const cell = new Map(metrics.typeVsStatus.map((r) => [`${r.type}|${r.status}`, r.count]));
    const max = Math.max(...metrics.typeVsStatus.map((r) => r.count));
    return { statuses, types, cell, max };
  }, [metrics]);

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Open work by type">
          <BarList rows={data.byType} />
        </Card>
        <Card title="Open work by priority">
          <BarList rows={data.byPriority} />
        </Card>
        <Card title="Age of open work" subtitle="Days since each open issue was created">
          <BarList rows={data.aging.map((a) => ({ name: a.label, count: a.count }))} keepOrder />
        </Card>
      </div>

      <Card title="Type × status" subtitle="Darker cells hold more issues. Click a count to open those issues.">
        {!pivot ? (
          <p className="text-sm text-[color:var(--text-muted)]">No data.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm border-separate" style={{ borderSpacing: 3 }}>
              <thead>
                <tr>
                  <th className="sticky left-0 bg-[color:var(--bg-surface)]" />
                  {pivot.statuses.map((s) => (
                    <th key={s} className="px-2 pb-1 text-[11px] font-medium text-[color:var(--text-muted)] whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        {statusColor(s) && <span className="w-2 h-2 rounded-full" style={{ background: statusColor(s) }} />}
                        {s}
                      </span>
                    </th>
                  ))}
                  <th className="px-2 pb-1 text-[11px] font-medium text-[color:var(--text-muted)]">Total</th>
                </tr>
              </thead>
              <tbody>
                {pivot.types.map((t) => {
                  const total = pivot.statuses.reduce((s, st) => s + (pivot.cell.get(`${t}|${st}`) ?? 0), 0);
                  return (
                    <tr key={t}>
                      <td className="sticky left-0 bg-[color:var(--bg-surface)] pr-3 text-[13px] font-medium whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ background: typeColor(t) ?? 'var(--text-muted)' }} />
                          {t}
                        </span>
                      </td>
                      {pivot.statuses.map((s) => {
                        const n = pivot.cell.get(`${t}|${s}`) ?? 0;
                        const strength = n ? Math.round(12 + (n / pivot.max) * 70) : 0;
                        return (
                          <td key={s} className="p-0">
                            {n ? (
                              <Link
                                to={`${base}/issues?type=${encodeURIComponent(t)}&status=${encodeURIComponent(s)}`}
                                className={`block min-w-[3rem] rounded-md px-2 py-1.5 text-center text-xs font-semibold tabular-nums hover:ring-1 hover:ring-[color:var(--accent)] ${strength > 55 ? 'text-white' : 'text-[color:var(--text-primary)]'}`}
                                style={{ background: `color-mix(in srgb, var(--accent) ${strength}%, var(--bg-surface))` }}
                                title={`${n} ${t} in ${s}`}
                              >
                                {n}
                              </Link>
                            ) : (
                              <span className="block min-w-[3rem] rounded-md px-2 py-1.5 text-center text-xs text-[color:var(--text-muted)] bg-[color:var(--bg-elevated)]/40">·</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-2 text-center text-xs font-semibold tabular-nums">{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Status" subtitle={`${data.kpis.totalIssues} issues by workflow status`}>
        <StatusBreakdown rows={data.byStatus} />
      </Card>
    </div>
  );
}

function TeamTab({ data, base }: { data: DashboardOverview; base: string }) {
  return (
    <div className="space-y-5">
      <Card
        title="Team load"
        subtitle="Open assigned work per person, with what they completed in the last 14 days"
        actions={
          <Link to={`/resources/engagement?project=${base.split('/').pop()}`} className="text-xs text-[color:var(--accent)] hover:underline">
            Engagement →
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
                  <th className="py-2 px-3 font-medium text-right">Open</th>
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
                        {t.name}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{t.open}</td>
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

function LinkKpi({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="block rounded-xl transition hover:-translate-y-0.5 hover:[&>div]:border-[color:var(--accent)]/50">
      {children}
    </Link>
  );
}

function TeamBars({ team }: { team: DashboardOverview['team'] }) {
  if (!team.length) return <p className="text-sm text-[color:var(--text-muted)]">No assigned work yet.</p>;
  const max = Math.max(1, ...team.map((t) => t.open));
  return (
    <ul className="space-y-2.5">
      {team.map((t) => (
        <li key={t.id} className="flex items-center gap-2.5 text-xs">
          <Avatar name={t.name} />
          <span className="w-28 truncate">{t.name}</span>
          <span className="flex-1 h-2 rounded-full bg-[color:var(--bg-elevated)] overflow-hidden flex gap-px">
            <span className="h-full bg-red-500" style={{ width: `${(t.overdue / max) * 100}%` }} title={`${t.overdue} overdue`} />
            <span className="h-full bg-[color:var(--accent)]" style={{ width: `${((t.open - t.overdue) / max) * 100}%` }} title={`${t.open - t.overdue} on time`} />
          </span>
          <span className="w-16 text-right tabular-nums text-[color:var(--text-muted)]">
            {t.open}
            {t.overdue > 0 && <span className="text-red-500"> · {t.overdue}!</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function EstimateChart({ metrics }: { metrics: ProjectMetricsResponse | null }) {
  const rows = useMemo(() => {
    if (!metrics) return [];
    let cumulative = 0;
    return [...metrics.loggedTimeByDate]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => {
        cumulative += d.minutes;
        return { date: d.date, label: fmtDate(d.date), logged: Math.round((cumulative / 60) * 10) / 10, estimate: Math.round((metrics.totalEstimatedMinutes / 60) * 10) / 10 };
      })
      .slice(-90);
  }, [metrics]);
  if (!metrics || (!rows.length && !metrics.totalEstimatedMinutes)) {
    return <p className="text-sm text-[color:var(--text-muted)]">Log time and add estimates to compare progress.</p>;
  }
  const last = rows[rows.length - 1];
  const pct = last && last.estimate ? Math.round((last.logged / last.estimate) * 100) : null;
  return (
    <div>
      <div className="flex flex-wrap gap-4 text-xs mb-2 text-[color:var(--text-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-0.5 rounded-full" style={{ background: SERIES.completed }} /> Logged
          <span className="font-semibold text-[color:var(--text-primary)] tabular-nums">{last?.logged ?? 0}h</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 border-t-2 border-dashed" style={{ borderColor: SERIES.created }} /> Total estimate
          <span className="font-semibold text-[color:var(--text-primary)] tabular-nums">{Math.round((metrics.totalEstimatedMinutes / 60) * 10) / 10}h</span>
        </span>
        {pct != null && <span className={pct > 100 ? 'text-red-500 font-medium' : ''}>{pct}% of estimate used</span>}
      </div>
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} unit="h" />
            <Tooltip {...chartTooltipProps} formatter={(v, n) => [`${v}h`, n === 'logged' ? 'Logged' : 'Estimate']} />
            <Area type="monotone" dataKey="logged" stroke={SERIES.completed} fill={`${SERIES.completed}22`} strokeWidth={2} />
            <Line type="monotone" dataKey="estimate" stroke={SERIES.created} strokeDasharray="5 4" strokeWidth={2} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
