import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { dashboardApi, projectsApi, type Project } from '../lib/api';
import { formatMinutes } from '../components/issue/WorkLogInput';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { ResponsiveContainer } from '../components/charts/ResponsiveContainer';
import { getChartColor } from '../lib/chartTheme';

export default function Estimates() {
  const { token, user } = useAuth();
  const workspaceKey = user?.activeOrganizationId ?? '';
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [byProject, setByProject] = useState<Array<{ projectId: string; projectName: string; totalMinutes: number }>>([]);
  const [byAssignee, setByAssignee] = useState<Array<{ userId: string; userName: string; totalMinutes: number }>>([]);
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
    dashboardApi.getEstimates(token, selectedProjectId || undefined).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setTotalMinutes(res.data.totalMinutes ?? 0);
        setByProject(res.data.byProject ?? []);
        setByAssignee(res.data.byAssignee ?? []);
      } else {
        setTotalMinutes(0);
        setByProject([]);
        setByAssignee([]);
      }
    });
  }, [token, selectedProjectId, workspaceKey]);

  const projectChartData = byProject.map((p) => ({
    name: p.projectName,
    total: p.totalMinutes,
    formatted: formatMinutes(p.totalMinutes),
  }));

  const assigneeChartData = byAssignee.map((a) => ({
    name: a.userName || 'Unassigned',
    total: a.totalMinutes,
    formatted: formatMinutes(a.totalMinutes),
  }));

  const hasData = totalMinutes > 0 || byProject.length > 0 || byAssignee.length > 0;

  return (
    <div className="p-8 animate-fade-in">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <h1 className="text-xl font-semibold mb-1">Estimates</h1>
        <p className="text-[13px] text-[color:var(--text-muted)] mb-6">
          Total time estimate from all tasks. Add estimates in issue details (e.g. 1h 2m 10s).
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
            Loading estimates…
          </div>
        ) : !hasData ? (
          <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-12 text-center text-[color:var(--text-muted)]">
            No estimates yet. Add time estimates to issues in the Details sidebar (e.g. 1h 2m 10s).
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-5">
              <h3 className="text-sm font-semibold text-[color:var(--text-primary)] mb-2">Total estimate</h3>
              <p className="text-2xl font-semibold text-[color:var(--accent)]">
                {formatMinutes(totalMinutes)}
              </p>
            </div>

            {byProject.length > 0 && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-5">
                <h3 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4">By project</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={projectChartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                      <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" tickFormatter={(v) => `${v}m`} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--bg-elevated)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '8px',
                        }}
                        labelStyle={{ color: 'var(--text-primary)' }}
                        formatter={(value: number | undefined) => [value != null ? formatMinutes(value) : '—', 'Estimate']}
                      />
                      <Bar dataKey="total" name="Estimate" fill={getChartColor(0)} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[color:var(--border-subtle)] text-[color:var(--text-muted)]">
                        <th className="py-2 font-medium">Project</th>
                        <th className="py-2 font-medium text-right">Estimate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[color:var(--border-subtle)]/70">
                      {byProject.map((p) => (
                        <tr key={p.projectId}>
                          <td className="py-2 text-[color:var(--text-primary)]">{p.projectName}</td>
                          <td className="py-2 text-right text-[color:var(--text-primary)] font-medium">
                            {formatMinutes(p.totalMinutes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {byAssignee.length > 0 && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-5">
                <h3 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4">By assignee</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={assigneeChartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                      <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" tickFormatter={(v) => `${v}m`} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--bg-elevated)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '8px',
                        }}
                        labelStyle={{ color: 'var(--text-primary)' }}
                        formatter={(value: number | undefined) => [value != null ? formatMinutes(value) : '—', 'Estimate']}
                      />
                      <Bar dataKey="total" name="Estimate" fill={getChartColor(1)} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[color:var(--border-subtle)] text-[color:var(--text-muted)]">
                        <th className="py-2 font-medium">Assignee</th>
                        <th className="py-2 font-medium text-right">Estimate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[color:var(--border-subtle)]/70">
                      {byAssignee.map((a) => (
                        <tr key={a.userId || 'unassigned'}>
                          <td className="py-2 text-[color:var(--text-primary)]">{a.userName || 'Unassigned'}</td>
                          <td className="py-2 text-right text-[color:var(--text-primary)] font-medium">
                            {formatMinutes(a.totalMinutes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
