import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { dashboardApi, projectsApi, type Project } from '../lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { ResponsiveContainer } from '../components/charts/ResponsiveContainer';
import MetricCard from '../components/MetricCard';
import SectionCard from '../components/SectionCard';
import { getChartColor } from '../lib/chartTheme';

interface DefectMetricsData {
  totalBugs: number;
  openBugs: number;
  closedBugs: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  defectDensity?: number;
}

export default function DefectMetrics() {
  const { projectId } = useParams<{ projectId: string }>();
  const { token, user } = useAuth();
  const workspaceKey = user?.activeOrganizationId ?? '';
  const [project, setProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [data, setData] = useState<DefectMetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? '');

  useEffect(() => {
    if (!token) return;
    projectsApi.list(1, 100, token).then((res) => {
      if (res.success && res.data) {
        const d = res.data as { data?: Project[] };
        setProjects(d.data ?? []);
      }
    });
  }, [token, workspaceKey]);

  useEffect(() => {
    if (projectId && token) {
      projectsApi.get(projectId, token).then((res) => {
        if (res.success && res.data) setProject(res.data);
      });
    } else {
      setProject(null);
    }
  }, [projectId, token]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError('');
    dashboardApi
      .getDefectMetrics(token, selectedProjectId || undefined)
      .then((res) => {
        setLoading(false);
        if (res.success && res.data) setData(res.data);
        else setError(res.message ?? 'Failed to load');
      })
      .catch(() => {
        setLoading(false);
        setError('Failed to load');
      });
  }, [token, selectedProjectId, workspaceKey]);

  useEffect(() => {
    if (projectId && !selectedProjectId) setSelectedProjectId(projectId);
  }, [projectId, selectedProjectId]);

  const statusData = data?.byStatus ? Object.entries(data.byStatus).map(([status, count]) => ({ status, count })) : [];
  const priorityData = data?.byPriority ? Object.entries(data.byPriority).map(([priority, count]) => ({ priority, count })) : [];

  return (
    <div className="flex-1 min-h-0 flex flex-col p-6">
      <div className="mb-4 flex shrink-0 flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">
            Defect metrics {project ? `· ${project.name}` : ''}
          </h1>
          <p className="text-xs text-[color:var(--text-muted)] mt-0.5">
            Bugs by status, priority, and defect density.
          </p>
        </div>
        {!projectId && projects.length > 0 && (
          <select
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm min-w-[180px]"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name} ({p.key})
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-8 text-center text-[color:var(--text-muted)] animate-pulse">
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-2xl bg-red-500/10 border border-red-500/30 p-6 text-red-400">{error}</div>
      ) : data ? (
        <div className="space-y-6">
          <SectionCard title="Defect summary" description="Snapshot of bugs and density for this scope.">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard title="Total bugs" value={data.totalBugs} />
              <MetricCard title="Open" value={data.openBugs} />
              <MetricCard title="Closed" value={data.closedBugs} />
              {data.defectDensity != null && (
                <MetricCard
                  title="Defect density"
                  value={data.defectDensity}
                  helperText="Bugs per story point"
                />
              )}
            </div>
          </SectionCard>

          {statusData.length > 0 && (
            <SectionCard title="Bugs by status">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="status" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                    />
                    <Bar dataKey="count" name="Count" fill={getChartColor(0)} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          )}

          {priorityData.length > 0 && (
            <SectionCard title="Bugs by priority">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={priorityData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="priority" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                    <Tooltip
                      contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                    />
                    <Bar dataKey="count" name="Count" fill={getChartColor(1)} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>
          )}

          {data.totalBugs === 0 && (
            <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-8 text-center text-[color:var(--text-muted)]">
              No bugs found for this scope.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
