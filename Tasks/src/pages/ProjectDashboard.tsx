import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { issuesApi, boardsApi, sprintsApi, projectsApi, dashboardApi, type EstimatesResponse } from '../lib/api';
import MetricCard from '../components/MetricCard';
import SectionCard from '../components/SectionCard';
import { formatMinutes } from '../components/issue/WorkLogInput';

const DEFAULT_STATUSES = ['Backlog', 'Todo', 'In Progress', 'Done'];
const STATUS_COLORS: string[] = ['#4f46e5', '#06b6d4', '#22c55e', '#f97316', '#e11d48', '#8b5cf6'];

export default function ProjectDashboard() {
  const { projectId } = useParams<{ projectId: string }>();
  const { token } = useAuth();
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

  useEffect(() => {
    if (!token || !projectId) return;
    setEstimatesLoading(true);
    dashboardApi.getEstimates(token, projectId).then((res) => {
      setEstimatesLoading(false);
      if (res.success && res.data) setEstimates(res.data);
      else setEstimates(null);
    });
  }, [token, projectId]);

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
  }, [token, projectId]);

  useEffect(() => {
    if (!token || !projectId) return;
    projectsApi.getMyPermissions(projectId, token).then((res) => {
      if (res.success && res.data && 'permissions' in res.data) {
        const perms = (res.data as { permissions: string[] }).permissions ?? [];
        setCanManageSettings(perms.includes('settings:manage'));
      }
    });
  }, [token, projectId]);

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
  }, [token, projectId]);

  if (!projectId) return null;

  const totalIssuesFromChart = statusData.reduce((sum, d) => sum + d.value, 0);
  const doneCount =
    statusData.find((d) => d.name.toLowerCase() === 'done')?.value ?? 0;
  const openCount = totalIssuesFromChart - doneCount;
  const base = `/projects/${projectId}`;
  const openStatuses = statusList.filter((s) => s.toLowerCase() !== 'done').map(encodeURIComponent).join(',');
  const cardLinkClass =
    'block rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] hover:border-[color:var(--border-subtle)] transition hover-elevated';
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
                    !estimatesLoading && estimates && !estimates.expectedDeliveryDate
                      ? 'Log time on completed tasks to see estimate'
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
