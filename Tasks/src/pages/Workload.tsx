import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { dashboardApi, projectsApi, type Project, type WorkloadEntry } from '../lib/api';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { ResponsiveContainer } from '../components/charts/ResponsiveContainer';

export default function Workload() {
  const { token, user } = useAuth();
  const workspaceKey = user?.activeOrganizationId ?? '';
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [entries, setEntries] = useState<WorkloadEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    projectsApi.list(1, 200, token).then((res) => {
      if (res.success && res.data) setProjects(res.data.data ?? []);
    });
  }, [token, workspaceKey]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    dashboardApi.getWorkload(token, selectedProjectId || undefined).then((res) => {
      setLoading(false);
      if (res.success && res.data) setEntries(res.data.entries ?? []);
    });
  }, [token, selectedProjectId, workspaceKey]);

  const chartData = entries.map((e) => ({
    name: e.userName || 'Unassigned',
    total: e.totalCount,
    open: e.openCount,
    done: e.doneCount,
    storyPoints: e.storyPoints,
  }));

  return (
    <div className="p-8 animate-fade-in">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <h1 className="text-xl font-semibold mb-1">Workload</h1>
        <p className="text-[13px] text-[color:var(--text-muted)] mb-6">
          View issues and story points per assignee.
        </p>

        <div className="mb-6">
          <label className="block text-xs font-medium text-[color:var(--text-muted)] mb-1">Project</label>
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="px-3 py-1.5 rounded-md bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm max-w-xs"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>{p.name} ({p.key})</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-8 text-center text-[color:var(--text-muted)] animate-pulse">
            Loading workload…
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-12 text-center text-[color:var(--text-muted)]">
            No issues to display.
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-5">
              <h3 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4">Issues per assignee</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--bg-elevated)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: '8px',
                      }}
                      labelStyle={{ color: 'var(--text-primary)' }}
                    />
                    <Bar dataKey="total" name="Total" fill="var(--accent)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
              <h3 className="text-sm font-semibold text-[color:var(--text-primary)] p-4 pb-0">Workload table</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)]">
                      <th className="px-4 py-3 font-medium">Assignee</th>
                      <th className="px-4 py-3 font-medium">Total</th>
                      <th className="px-4 py-3 font-medium">Open</th>
                      <th className="px-4 py-3 font-medium">Done</th>
                      <th className="px-4 py-3 font-medium">Story points</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--border-subtle)]/70">
                    {entries.map((e) => (
                      <tr key={e.userId || 'unassigned'} className="bg-[color:var(--bg-surface)]">
                        <td className="px-4 py-3 text-[color:var(--text-primary)]">{e.userName || 'Unassigned'}</td>
                        <td className="px-4 py-3 text-[color:var(--text-primary)]">{e.totalCount}</td>
                        <td className="px-4 py-3 text-[color:var(--text-primary)]">{e.openCount}</td>
                        <td className="px-4 py-3 text-[color:var(--text-primary)]">{e.doneCount}</td>
                        <td className="px-4 py-3 text-[color:var(--text-primary)]">{e.storyPoints}</td>
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
