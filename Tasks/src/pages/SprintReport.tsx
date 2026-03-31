import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { sprintsApi, projectsApi, type Sprint, type Project } from '../lib/api';

export default function SprintReport() {
  const { projectId, sprintId } = useParams<{ projectId: string; sprintId: string }>();
  const { token } = useAuth();
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [report, setReport] = useState<{
    burndown: { date: string; ideal: number; actual: number }[];
    velocity: { sprintName: string; completedSP: number }[];
    summary: {
      totalIssues: number;
      completedIssues: number;
      remainingIssues: number;
      storyPointsCommitted: number;
      storyPointsCompleted: number;
      storyPointsRemaining: number;
    };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !projectId || !sprintId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      sprintsApi.get(sprintId, token),
      projectsApi.get(projectId, token),
      sprintsApi.getReport(projectId, sprintId, token),
    ]).then(([sprintRes, projectRes, reportRes]) => {
      setLoading(false);
      if (sprintRes.success && sprintRes.data) setSprint(sprintRes.data);
      if (projectRes.success && projectRes.data) setProject(projectRes.data);
      if (reportRes.success && reportRes.data) {
        setReport(reportRes.data);
      } else {
        setReport(null);
        setError(reportRes.message ?? 'Failed to load sprint report');
      }
    });
  }, [token, projectId, sprintId]);

  if (loading) {
    return (
      <div className="p-8 animate-fade-in">
        <div className="text-[color:var(--text-muted)] animate-pulse">Loading report…</div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-8 animate-fade-in">
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6">
          <p className="text-sm text-red-400">{error ?? 'Unable to load sprint report.'}</p>
          <Link to={`/projects/${projectId}/sprints`} className="inline-block mt-3 text-sm text-[color:var(--accent)] hover:underline">
            ← Back to sprints
          </Link>
        </div>
      </div>
    );
  }

  const { burndown, velocity, summary } = report;

  return (
    <div className="p-8 animate-fade-in">
      <div className="mb-6">
        <Link
          to={`/projects/${projectId}/sprints`}
          className="text-sm text-[color:var(--accent)] hover:underline"
        >
          ← Back to sprints
        </Link>
        <h1 className="text-xl font-semibold text-[color:var(--text-primary)] mt-2">
          {sprint?.name ?? 'Sprint'} Report
        </h1>
        <p className="text-sm text-[color:var(--text-muted)] mt-0.5">
          {project?.name}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
          <p className="text-[11px] font-medium text-[color:var(--text-muted)] uppercase tracking-wider">Total issues</p>
          <p className="text-2xl font-semibold text-[color:var(--text-primary)] mt-1">{summary.totalIssues}</p>
        </div>
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
          <p className="text-[11px] font-medium text-[color:var(--text-muted)] uppercase tracking-wider">Completed</p>
          <p className="text-2xl font-semibold text-green-500 mt-1">{summary.completedIssues}</p>
        </div>
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
          <p className="text-[11px] font-medium text-[color:var(--text-muted)] uppercase tracking-wider">Story points committed</p>
          <p className="text-2xl font-semibold text-[color:var(--text-primary)] mt-1">{summary.storyPointsCommitted}</p>
        </div>
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
          <p className="text-[11px] font-medium text-[color:var(--text-muted)] uppercase tracking-wider">Story points completed</p>
          <p className="text-2xl font-semibold text-green-500 mt-1">{summary.storyPointsCompleted}</p>
        </div>
      </div>

      {burndown.length > 0 && (
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 mb-8">
          <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4">Burndown</h2>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={burndown}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="date" stroke="var(--text-muted)" fontSize={11} tickFormatter={(v) => v.slice(5)} />
                <YAxis stroke="var(--text-muted)" fontSize={11} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}
                  labelStyle={{ color: 'var(--text-primary)' }}
                />
                <Legend />
                <Line type="monotone" dataKey="ideal" stroke="var(--text-muted)" strokeDasharray="5 5" name="Ideal" dot={false} />
                <Line type="monotone" dataKey="actual" stroke="var(--accent)" name="Actual" dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {velocity.length > 0 && (
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6">
          <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4">Velocity (last 10 sprints)</h2>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={velocity} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="sprintName" stroke="var(--text-muted)" fontSize={10} tick={{ fill: 'var(--text-muted)' }} />
                <YAxis stroke="var(--text-muted)" fontSize={11} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}
                />
                <Bar dataKey="completedSP" fill="var(--accent)" name="Completed SP" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
