import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { dashboardApi } from '../lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function Portfolio() {
  const { token, user } = useAuth();
  const workspaceKey = user?.activeOrganizationId ?? '';
  const [entries, setEntries] = useState<Array<{
    projectId: string;
    projectName: string;
    projectKey: string;
    totalIssues: number;
    doneCount: number;
    openCount: number;
    progressPercent: number;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    dashboardApi.getPortfolio(token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setEntries(Array.isArray(res.data) ? res.data : []);
    });
  }, [token, workspaceKey]);

  const chartData = entries.map((e) => ({
    name: e.projectKey || e.projectName,
    total: e.totalIssues,
    done: e.doneCount,
    open: e.openCount,
    progress: e.progressPercent,
  }));

  return (
    <div className="p-8 animate-fade-in">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <h1 className="text-xl font-semibold mb-1">Portfolio</h1>
        <p className="text-[13px] text-[color:var(--text-muted)] mb-6">
          Overview of projects in your current workspace with progress and health indicators.
        </p>

        {loading ? (
          <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-8 text-center text-[color:var(--text-muted)] animate-pulse">
            Loading portfolio…
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-12 text-center text-[color:var(--text-muted)]">
            No projects yet. Join a project to see it here.
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-5">
              <h3 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4">Issues by project</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                      labelStyle={{ color: 'var(--text-primary)' }}
                    />
                    <Bar dataKey="done" name="Done" fill="var(--accent)" />
                    <Bar dataKey="open" name="Open" fill="var(--text-muted)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
              <h3 className="text-sm font-semibold text-[color:var(--text-primary)] p-4 border-b border-[color:var(--border-subtle)]">
                Project summary
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[color:var(--border-subtle)]">
                      <th className="text-left px-4 py-2 text-[color:var(--text-muted)] font-medium">Project</th>
                      <th className="text-right px-4 py-2 text-[color:var(--text-muted)] font-medium">Total</th>
                      <th className="text-right px-4 py-2 text-[color:var(--text-muted)] font-medium">Done</th>
                      <th className="text-right px-4 py-2 text-[color:var(--text-muted)] font-medium">Open</th>
                      <th className="text-right px-4 py-2 text-[color:var(--text-muted)] font-medium">Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.projectId} className="border-b border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-page)]">
                        <td className="px-4 py-2">
                          <Link
                            to={`/projects/${e.projectId}/dashboard`}
                            className="text-[color:var(--accent)] hover:underline font-medium"
                          >
                            {e.projectName} ({e.projectKey})
                          </Link>
                        </td>
                        <td className="text-right px-4 py-2 text-[color:var(--text-primary)]">{e.totalIssues}</td>
                        <td className="text-right px-4 py-2 text-[color:var(--text-primary)]">{e.doneCount}</td>
                        <td className="text-right px-4 py-2 text-[color:var(--text-primary)]">{e.openCount}</td>
                        <td className="text-right px-4 py-2">
                          <span className="inline-flex items-center gap-1">
                            <span className="w-16 h-1.5 rounded-full bg-[color:var(--bg-page)] overflow-hidden">
                              <span
                                className="block h-full bg-[color:var(--accent)] rounded-full"
                                style={{ width: `${e.progressPercent}%` }}
                              />
                            </span>
                            <span className="text-[color:var(--text-muted)] text-xs">{e.progressPercent}%</span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
