import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { dashboardApi, crmApi } from '../lib/api';
import { canAny } from '../utils/moduleAccess';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function ExecutiveDashboard() {
  const { token, user } = useAuth();
  const canView = canAny(user, 'taskflow.platform.executive.read');
  const [data, setData] = useState<{
    totalIssues: number;
    totalProjects: number;
    issuesByStatus: Record<string, number>;
    recentIssues: Array<{ _id: string; key?: string; title: string; status: string; project: string; projectName?: string }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [crmMetrics, setCrmMetrics] = useState<{
    wonDeals: number;
    activeContracts: number;
    ticketsByStatus: Record<string, number>;
  } | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    dashboardApi.getExecutive(token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setData(res.data);
      else setError(res.message ?? 'Failed to load');
    });
    crmApi.executiveMetrics(token).then((res) => {
      if (res.success && res.data) setCrmMetrics(res.data as typeof crmMetrics);
    });
  }, [token]);

  if (!canView) {
    return (
      <div className="p-8">
        <p className="text-[color:var(--text-muted)]">Access denied. Insufficient permissions.</p>
      </div>
    );
  }

  const chartData = data?.issuesByStatus
    ? Object.entries(data.issuesByStatus).map(([status, count]) => ({ status, count }))
    : [];

  return (
    <div className="p-8 animate-fade-in">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <h1 className="text-xl font-semibold mb-1">Executive Dashboard</h1>
        <p className="text-[13px] text-[color:var(--text-muted)] mb-6">
          Cross-project KPIs and overview.
        </p>

        {loading ? (
          <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-8 text-center text-[color:var(--text-muted)] animate-pulse">
            Loading…
          </div>
        ) : error ? (
          <div className="rounded-2xl bg-red-500/10 border border-red-500/30 p-6 text-red-400">{error}</div>
        ) : data ? (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-5">
                <p className="text-[12px] text-[color:var(--text-muted)] uppercase tracking-wider">Total projects</p>
                <p className="text-2xl font-semibold text-[color:var(--text-primary)] mt-1">{data.totalProjects}</p>
              </div>
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-5">
                <p className="text-[12px] text-[color:var(--text-muted)] uppercase tracking-wider">Total issues</p>
                <p className="text-2xl font-semibold text-[color:var(--text-primary)] mt-1">{data.totalIssues}</p>
              </div>
              {crmMetrics && (
                <>
                  <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-5">
                    <p className="text-[12px] text-[color:var(--text-muted)] uppercase tracking-wider">Won deals</p>
                    <p className="text-2xl font-semibold text-[color:var(--text-primary)] mt-1">{crmMetrics.wonDeals}</p>
                  </div>
                  <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-5">
                    <p className="text-[12px] text-[color:var(--text-muted)] uppercase tracking-wider">Active contracts</p>
                    <p className="text-2xl font-semibold text-[color:var(--text-primary)] mt-1">{crmMetrics.activeContracts}</p>
                  </div>
                </>
              )}
            </div>

            {chartData.length > 0 && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-5">
                <h3 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4">Issues by status</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis dataKey="status" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                      <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                      <Tooltip
                        contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                      />
                      <Bar dataKey="count" name="Count" fill="var(--accent)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {data.recentIssues?.length > 0 && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-5">
                <h3 className="text-sm font-semibold text-[color:var(--text-primary)] mb-3">Recent issues</h3>
                <ul className="space-y-2">
                  {data.recentIssues.slice(0, 10).map((issue) => (
                    <li key={issue._id} className="text-sm">
                      <a
                        href={`/projects/${issue.project}/issues/${encodeURIComponent(issue.key ?? issue._id)}`}
                        className="text-[color:var(--accent)] hover:underline"
                      >
                        {issue.key ?? issue._id}
                      </a>
                      {' — '}
                      <span className="text-[color:var(--text-primary)]">{issue.title}</span>
                      {issue.projectName && (
                        <span className="text-[color:var(--text-muted)] ml-1">({issue.projectName})</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
