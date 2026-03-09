import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationsContext';
import { useEffect, useState, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Area, AreaChart } from 'recharts';
import { issuesApi, boardsApi, sprintsApi, projectsApi, dashboardApi, type EstimatesResponse, type ProjectMetricsResponse } from '../lib/api';
import MetricCard from '../components/MetricCard';
import SectionCard from '../components/SectionCard';
import { formatMinutes } from '../components/issue/WorkLogInput';

const DEFAULT_STATUSES = ['Backlog', 'Todo', 'In Progress', 'Done'];
const STATUS_COLORS: string[] = ['#4f46e5', '#06b6d4', '#22c55e', '#f97316', '#e11d48', '#8b5cf6'];
const TYPE_COLORS: string[] = ['#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#6366f1'];

export default function ProjectDashboard() {
  const { projectId } = useParams<{ projectId: string }>();
  const { token } = useAuth();
  const { subscribeProject } = useNotifications();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [counts, setCounts] = useState<{ issues: number; boards: number; sprints: number }>({
    issues: 0,
    boards: 0,
    sprints: 0,
  });
  const [countsLoading, setCountsLoading] = useState(false);
  const [canManageSettings, setCanManageSettings] = useState(false);
  const [statusData, setStatusData] = useState<Array<{ name: string; value: number }>>([]);
  const [statusList, setStatusList] = useState<string[]>(DEFAULT_STATUSES);
  const [statusLoading, setStatusLoading] = useState(false);
  const [estimates, setEstimates] = useState<EstimatesResponse | null>(null);
  const [estimatesLoading, setEstimatesLoading] = useState(false);
  const [metrics, setMetrics] = useState<ProjectMetricsResponse | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    return subscribeProject(projectId, () => setRefreshTrigger((t) => t + 1));
  }, [projectId, subscribeProject]);

  useEffect(() => {
    if (!token || !projectId) return;
    setEstimatesLoading(true);
    dashboardApi.getEstimates(token, projectId).then((res) => {
      setEstimatesLoading(false);
      if (res.success && res.data) setEstimates(res.data);
      else setEstimates(null);
    });
  }, [token, projectId, refreshTrigger]);

  useEffect(() => {
    if (!token || !projectId) return;
    setMetricsLoading(true);
    dashboardApi.getProjectMetrics(token, projectId).then((res) => {
      setMetricsLoading(false);
      if (res.success && res.data) setMetrics(res.data);
      else setMetrics(null);
    });
  }, [token, projectId, refreshTrigger]);

  useEffect(() => {
    if (!token || !projectId) return;
    setCountsLoading(true);
    Promise.all([
      issuesApi.list({ page: 1, limit: 1, token, project: projectId }).then((r) =>
        r.success && r.data ? r.data.total : 0
      ),
      boardsApi.list(1, 1, projectId, token).then((r) =>
        r.success && r.data ? r.data.total : 0
      ),
      sprintsApi.list(1, 1, projectId, undefined, token).then((r) =>
        r.success && r.data ? r.data.total : 0
      ),
    ])
      .then(([issues, boards, sprints]) => setCounts({ issues, boards, sprints }))
      .finally(() => setCountsLoading(false));
  }, [token, projectId, refreshTrigger]);

  useEffect(() => {
    if (!token || !projectId) return;
    projectsApi.getMyPermissions(projectId, token).then((res) => {
      if (res.success && res.data && 'permissions' in res.data) {
        const perms = (res.data as { permissions: string[] }).permissions ?? [];
        setCanManageSettings(perms.includes('settings:manage'));
      }
    });
  }, [token, projectId, refreshTrigger]);

  useEffect(() => {
    if (!token || !projectId) return;
    setStatusLoading(true);

    projectsApi.get(projectId, token).then((projRes) => {
      if (!projRes.success || !projRes.data) {
        setStatusLoading(false);
        return;
      }
      const statuses =
        projRes.data.statuses && projRes.data.statuses.length
          ? projRes.data.statuses.map((s) => s.name)
          : DEFAULT_STATUSES;
      setStatusList(statuses);

      Promise.all(
        statuses.map((statusName) =>
          issuesApi
            .list({ page: 1, limit: 1, token, project: projectId, status: statusName })
            .then((r) => (r.success && r.data ? r.data.total : 0))
        )
      )
        .then((values) => {
          const data = statuses.map((name, idx) => ({ name, value: values[idx] ?? 0 }));
          const nonZero = data.filter((d) => d.value > 0);
          setStatusData(nonZero.length > 0 ? nonZero : data);
        })
        .finally(() => setStatusLoading(false));
    });
  }, [token, projectId, refreshTrigger]);

  if (!projectId) return null;

  const totalIssuesFromChart = statusData.reduce((sum, d) => sum + d.value, 0);
  const doneCount =
    statusData.find((d) => d.name.toLowerCase() === 'done')?.value ?? 0;
  const openCount = totalIssuesFromChart - doneCount;
  const base = `/projects/${projectId}`;
  const openStatuses = statusList.filter((s) => s.toLowerCase() !== 'done').map(encodeURIComponent).join(',');
  const cardLinkClass =
    'block rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] hover:border-[color:var(--border-subtle)] transition hover-elevated';

  const activityChartData = useMemo(() => {
    if (!metrics) return [];
    const statuses = metrics.projectStatuses ?? [];
    const dateMap = new Map<string, Record<string, string | number>>();
    const initRow = (date: string) => {
      if (!dateMap.has(date)) {
        const row: Record<string, string | number> = { date };
        statuses.forEach((s) => (row[s] = 0));
        row.bugsCreated = 0;
        dateMap.set(date, row);
      }
      return dateMap.get(date)!;
    };
    metrics.movedToStatusByDate.forEach((d) => {
      const row = initRow(d.date);
      if (statuses.includes(d.status)) row[d.status] = d.count;
    });
    metrics.bugsCreatedByDate.forEach((d) => {
      initRow(d.date).bugsCreated = d.count;
    });
    return Array.from(dateMap.values())
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .slice(-90);
  }, [metrics]);

  const estimatedVsLoggedData = useMemo(() => {
    if (!metrics) return [];
    const totalEst = metrics.totalEstimatedMinutes;
    let cumulative = 0;
    const points = metrics.loggedTimeByDate
      .map((d) => {
        cumulative += d.minutes;
        return { date: d.date, loggedCumulative: cumulative, totalEstimated: totalEst };
      })
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-90);
    if (points.length === 0 && totalEst > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const d = new Date();
      d.setDate(d.getDate() - 30);
      const past = d.toISOString().slice(0, 10);
      return [
        { date: past, loggedCumulative: 0, totalEstimated: totalEst },
        { date: today, loggedCumulative: 0, totalEstimated: totalEst },
      ];
    }
    return points;
  }, [metrics]);

  const typeVsStatusPivot = useMemo(() => {
    if (!metrics?.typeVsStatus?.length) return null;
    const statusOrder = statusList.length ? statusList : [...new Set(metrics.typeVsStatus.map((r) => r.status))].sort();
    const types = [...new Set(metrics.typeVsStatus.map((r) => r.type))].sort();
    const statuses = [...new Set(metrics.typeVsStatus.map((r) => r.status))].sort((a, b) => {
      const i = statusOrder.indexOf(a);
      const j = statusOrder.indexOf(b);
      if (i !== -1 && j !== -1) return i - j;
      if (i !== -1) return -1;
      if (j !== -1) return 1;
      return a.localeCompare(b);
    });
    const map = new Map<string, number>();
    const rowTotals = new Map<string, number>();
    const colTotals = new Map<string, number>();
    let grandTotal = 0;
    metrics.typeVsStatus.forEach((r) => {
      map.set(`${r.type}|${r.status}`, r.count);
      rowTotals.set(r.type, (rowTotals.get(r.type) ?? 0) + r.count);
      colTotals.set(r.status, (colTotals.get(r.status) ?? 0) + r.count);
      grandTotal += r.count;
    });
    return { types, statuses, map, rowTotals, colTotals, grandTotal };
  }, [metrics, statusList]);
  return (
    <div className="p-8 animate-fade-in">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <h1 className="text-xl font-semibold mb-1">Project dashboard</h1>
        <p className="text-[13px] text-[color:var(--text-muted)] mb-6">
          Overview and quick links for this project.
        </p>

        <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)]">
          <SectionCard
            title="Summary"
            description="High-level snapshot of this project."
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <Link to={`${base}/issues`} className={cardLinkClass}>
                <MetricCard
                  title="Issues"
                  value={counts.issues || totalIssuesFromChart}
                  loading={countsLoading}
                />
              </Link>
              <Link to={`${base}/boards`} className={cardLinkClass}>
                <MetricCard title="Boards" value={counts.boards} loading={countsLoading} />
              </Link>
              <Link to={`${base}/sprints`} className={cardLinkClass}>
                <MetricCard title="Sprints" value={counts.sprints} loading={countsLoading} />
              </Link>
              <Link
                to={openStatuses ? `${base}/issues?status=${openStatuses}` : `${base}/issues`}
                className={cardLinkClass}
              >
                <MetricCard
                  title="Open"
                  value={openCount}
                  helperText="Not yet done"
                  loading={countsLoading}
                />
              </Link>
              <Link to={`${base}/issues?status=Done`} className={cardLinkClass}>
                <MetricCard
                  title="Done"
                  value={doneCount}
                  helperText="Completed issues"
                  loading={countsLoading}
                />
              </Link>
              <Link to={`${base}/issues?hasEstimate=true`} className={cardLinkClass}>
                <MetricCard
                  title="Total estimate"
                  value={estimates ? formatMinutes(estimates.totalMinutes) : '—'}
                  loading={estimatesLoading}
                />
              </Link>
              <Link to={`${base}/issues?hasEstimate=true`} className={cardLinkClass}>
                <MetricCard
                  title="Expected delivery"
                  value={
                    estimates?.expectedDeliveryDate
                      ? new Date(estimates.expectedDeliveryDate + 'T12:00:00').toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })
                      : '—'
                  }
                  helperText={
                    !estimatesLoading && estimates
                      ? estimates.expectedDeliveryDate
                        ? estimates.usedDefaultBurnRate
                          ? 'Based on 8h/day (log time on completed tasks for a more accurate date)'
                          : undefined
                        : 'Log time on completed tasks to see estimate'
                      : undefined
                  }
                  loading={estimatesLoading}
                />
              </Link>
              <Link
                to={`${base}/issues?hasEstimate=false`}
                className={`${cardLinkClass} px-4 py-3`}
              >
                <p className="text-[11px] text-[color:var(--text-muted)] mb-1 uppercase tracking-wide">
                  No estimate
                </p>
                {estimatesLoading ? (
                  <div className="mt-1 h-5 w-16 rounded-full skeleton" />
                ) : (
                  <p className="text-lg font-semibold text-[color:var(--text-primary)]">
                    {estimates?.unestimatedIssuesCount ?? '—'}
                  </p>
                )}
                <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">
                  Issues without time estimate
                </p>
              </Link>
            </div>
          </SectionCard>

          <SectionCard
            title="Issues by status"
            description="Distribution of issues in this project by status."
          >
            <div className="h-56">
              {statusLoading ? (
                <div className="h-full flex items-center justify-center text-[color:var(--text-muted)] text-sm animate-pulse">
                  Loading chart…
                </div>
              ) : statusData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-[color:var(--text-muted)] text-sm">
                  No issues yet for this project.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      label={({ name, value }) => `${name}: ${value}`}
                      labelLine={false}
                    >
                      {statusData.map((entry, index) => (
                        <Cell
                          key={entry.name}
                          fill={STATUS_COLORS[index % STATUS_COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </SectionCard>
        </div>

        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <SectionCard
            title="Issues by type"
            description="Distribution of issues in this project by type."
          >
            <div className="h-56">
              {metricsLoading ? (
                <div className="h-full flex items-center justify-center text-[color:var(--text-muted)] text-sm animate-pulse">
                  Loading chart…
                </div>
              ) : !metrics?.issuesByType?.length ? (
                <div className="h-full flex items-center justify-center text-[color:var(--text-muted)] text-sm">
                  No issues yet for this project.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={metrics.issuesByType}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      label={({ name, value }) => `${name}: ${value}`}
                      labelLine={false}
                    >
                      {metrics.issuesByType.map((entry, index) => (
                        <Cell key={entry.name} fill={TYPE_COLORS[index % TYPE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="Type vs status"
            description="Issues by type and status. Click a count to open the filtered issues list."
          >
            <div className="overflow-x-auto overflow-y-auto max-h-80">
              {metricsLoading ? (
                <div className="h-32 flex items-center justify-center text-[color:var(--text-muted)] text-sm animate-pulse">
                  Loading…
                </div>
              ) : !typeVsStatusPivot ? (
                <div className="h-32 flex items-center justify-center text-[color:var(--text-muted)] text-sm">
                  No data.
                </div>
              ) : (
                <table className="w-full text-sm text-left border-collapse min-w-[320px]">
                  <thead>
                    <tr className="border-b border-[color:var(--border-subtle)]">
                      <th className="py-2.5 pr-3 font-semibold text-[color:var(--text-muted)] bg-[color:var(--bg-surface)] sticky left-0 z-10 whitespace-nowrap">
                        Type
                      </th>
                      {typeVsStatusPivot.statuses.map((status) => (
                        <th
                          key={status}
                          className="py-2.5 px-2 font-semibold text-[color:var(--text-muted)] text-center min-w-[3rem]"
                        >
                          {status}
                        </th>
                      ))}
                      <th className="py-2.5 pl-2 font-semibold text-[color:var(--text-muted)] text-center min-w-[3.5rem]">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {typeVsStatusPivot.types.map((type) => (
                      <tr key={type} className="border-b border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)]/50">
                        <td className="py-2 pr-3 font-medium text-[color:var(--text-primary)] sticky left-0 bg-[color:var(--bg-surface)] z-10 whitespace-nowrap">
                          {type}
                        </td>
                        {typeVsStatusPivot.statuses.map((status) => {
                          const count = typeVsStatusPivot.map.get(`${type}|${status}`) ?? 0;
                          const url = `${base}/issues?type=${encodeURIComponent(type)}&status=${encodeURIComponent(status)}`;
                          return (
                            <td key={status} className="py-2 px-2 text-center">
                              {count > 0 ? (
                                <Link
                                  to={url}
                                  className="text-[color:var(--accent)] hover:underline font-medium"
                                  title={`View ${count} issue(s)`}
                                >
                                  {count}
                                </Link>
                              ) : (
                                <span className="text-[color:var(--text-muted)]">0</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="py-2 pl-2 text-center font-medium text-[color:var(--text-primary)]">
                          {typeVsStatusPivot.rowTotals.get(type) ?? 0}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]/30 font-medium">
                      <td className="py-2.5 pr-3 text-[color:var(--text-primary)] sticky left-0 bg-[color:var(--bg-elevated)]/30 z-10">
                        Total
                      </td>
                      {typeVsStatusPivot.statuses.map((status) => (
                        <td key={status} className="py-2.5 px-2 text-center text-[color:var(--text-primary)]">
                          {typeVsStatusPivot.colTotals.get(status) ?? 0}
                        </td>
                      ))}
                      <td className="py-2.5 pl-2 text-center text-[color:var(--text-primary)]">
                        {typeVsStatusPivot.grandTotal}
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </SectionCard>
        </div>

        <div className="mb-6">
          <SectionCard
            title="Activity over time"
            description="Issues moved to each status by date (distinct count) and bugs created. Only project statuses are shown."
          >
            <div className="h-64">
              {metricsLoading ? (
                <div className="h-full flex items-center justify-center text-[color:var(--text-muted)] text-sm animate-pulse">
                  Loading chart…
                </div>
              ) : activityChartData.length === 0 && !(metrics?.projectStatuses?.length) ? (
                <div className="h-full flex items-center justify-center text-[color:var(--text-muted)] text-sm">
                  No activity data yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={activityChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                      labelStyle={{ color: 'var(--text-primary)' }}
                    />
                    <Legend />
                    {(metrics?.projectStatuses ?? []).map((statusName, index) => (
                      <Line
                        key={statusName}
                        type="monotone"
                        dataKey={statusName}
                        name={statusName}
                        stroke={STATUS_COLORS[index % STATUS_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    ))}
                    <Line type="monotone" dataKey="bugsCreated" name="Bugs created" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </SectionCard>
        </div>

        <div className="mb-6">
          <SectionCard
            title="Estimated vs logged time"
            description="Cumulative logged time over time vs total estimated (current)."
          >
            <div className="h-64">
              {metricsLoading ? (
                <div className="h-full flex items-center justify-center text-[color:var(--text-muted)] text-sm animate-pulse">
                  Loading chart…
                </div>
              ) : estimatedVsLoggedData.length === 0 && !metrics?.totalEstimatedMinutes ? (
                <div className="h-full flex items-center justify-center text-[color:var(--text-muted)] text-sm">
                  Log time to see progress. Add estimates for comparison.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={estimatedVsLoggedData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" unit=" min" />
                    <Tooltip
                      contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                      formatter={(value: number | undefined) => [value != null ? formatMinutes(value) : '—', '']}
                      labelFormatter={(label) => `Date: ${label}`}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="loggedCumulative" name="Logged (cumulative)" stroke="#06b6d4" fill="#06b6d433" strokeWidth={2} />
                    <Line type="monotone" dataKey="totalEstimated" name="Total estimate" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </SectionCard>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            to={`${base}/issues`}
            className="block p-5 rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] transition animate-slide-in-right"
          >
            <h2 className="text-sm font-semibold">Issues</h2>
            <p className="text-[13px] text-[color:var(--text-muted)] mt-1">
              {counts.issues} issue(s)
            </p>
          </Link>
          <Link
            to={`${base}/boards`}
            className="block p-5 rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] transition animate-slide-in-right animation-delay-100"
          >
            <h2 className="text-sm font-semibold">Boards</h2>
            <p className="text-[13px] text-[color:var(--text-muted)] mt-1">
              {counts.boards} board(s)
            </p>
          </Link>
          <Link
            to={`${base}/sprints`}
            className="block p-5 rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] transition animate-slide-in-right animation-delay-200"
          >
            <h2 className="text-sm font-semibold">Sprints</h2>
            <p className="text-[13px] text-[color:var(--text-muted)] mt-1">
              {counts.sprints} sprint(s)
            </p>
          </Link>
          {canManageSettings && (
            <Link
              to={`${base}/settings`}
              className="block p-5 rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] transition animate-slide-in-right animation-delay-300"
            >
              <h2 className="text-sm font-semibold">Settings</h2>
              <p className="text-[13px] text-[color:var(--text-muted)] mt-1">
                Project name, key, lead
              </p>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
