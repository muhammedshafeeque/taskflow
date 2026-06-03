import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { dashboardApi, type PortfolioTimelineLane } from '../lib/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

function dayMs(d: string): number {
  return new Date(d.slice(0, 10)).getTime();
}

function portfolioBarStyle(lane: PortfolioTimelineLane, globalStart: string, globalEnd: string) {
  if (!lane.startDate || !lane.endDate) return null;
  const s = dayMs(globalStart);
  const e = dayMs(globalEnd);
  if (e <= s) return null;
  const left = Math.max(0, ((dayMs(lane.startDate) - s) / (e - s)) * 100);
  const right = Math.min(100, ((dayMs(lane.endDate) - s) / (e - s)) * 100);
  return { left: `${left}%`, width: `${Math.max(1, right - left)}%` };
}

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
  const [timelineLanes, setTimelineLanes] = useState<PortfolioTimelineLane[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyDated, setOnlyDated] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([dashboardApi.getPortfolio(token), dashboardApi.getPortfolioTimeline(token)]).then(
      ([portRes, tlRes]) => {
        setLoading(false);
        if (portRes.success && portRes.data) setEntries(Array.isArray(portRes.data) ? portRes.data : []);
        if (tlRes.success && tlRes.data) setTimelineLanes(Array.isArray(tlRes.data) ? tlRes.data : []);
      }
    );
  }, [token, workspaceKey]);

  const chartData = entries.map((e) => ({
    name: e.projectKey || e.projectName,
    total: e.totalIssues,
    done: e.doneCount,
    open: e.openCount,
    progress: e.progressPercent,
  }));

  const datedLanes = timelineLanes.filter((l) => l.startDate && l.endDate);
  const displayLanes = onlyDated ? datedLanes : timelineLanes;
  const globalStart =
    datedLanes.length > 0
      ? datedLanes.map((l) => l.startDate!).sort()[0]
      : new Date().toISOString().slice(0, 10);
  const globalEnd =
    datedLanes.length > 0
      ? datedLanes.map((l) => l.endDate!).sort().reverse()[0]
      : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  return (
    <div className="p-8 animate-fade-in">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <h1 className="text-xl font-semibold mb-1">Portfolio</h1>
        <p className="text-[13px] text-[color:var(--text-muted)] mb-6">
          Overview of projects in your current workspace with progress and timeline spans.
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
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">Portfolio timeline</h3>
                <label className="text-xs text-[color:var(--text-muted)] flex items-center gap-1.5">
                  <input type="checkbox" checked={onlyDated} onChange={(e) => setOnlyDated(e.target.checked)} />
                  Only projects with dated work
                </label>
              </div>
              <div className="text-[10px] text-[color:var(--text-muted)] flex justify-between mb-2 px-1">
                <span>{globalStart}</span>
                <span>{globalEnd}</span>
              </div>
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {displayLanes.map((lane) => {
                  const style = portfolioBarStyle(lane, globalStart, globalEnd);
                  return (
                    <div key={lane.projectId} className="grid grid-cols-[180px_1fr] gap-2 items-center min-h-[36px]">
                      <Link
                        to={`/projects/${lane.projectId}/gantt`}
                        className="text-xs font-medium text-[color:var(--accent)] hover:underline truncate"
                        title={lane.projectName}
                      >
                        {lane.projectKey} · {lane.projectName}
                      </Link>
                      <div className="relative h-7 bg-[color:var(--bg-page)] rounded">
                        {style && (
                          <div
                            className="absolute top-1 bottom-1 rounded bg-[color:var(--accent)]/50 border border-[color:var(--accent)]"
                            style={style}
                          />
                        )}
                        {lane.nextRelease && (
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-amber-400"
                            style={{
                              left: `${Math.max(0, Math.min(100, ((dayMs(lane.nextRelease.releaseDate) - dayMs(globalStart)) / (dayMs(globalEnd) - dayMs(globalStart))) * 100))}%`,
                            }}
                            title={`${lane.nextRelease.name} ${lane.nextRelease.releaseDate}`}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-[color:var(--text-muted)] mt-3">
                Click a project to open its Gantt. Amber tick = next planned release.
              </p>
            </div>

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
                      <th className="text-right px-4 py-2 text-[color:var(--text-muted)] font-medium">Dated issues</th>
                      <th className="text-right px-4 py-2 text-[color:var(--text-muted)] font-medium">Progress</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => {
                      const tl = timelineLanes.find((l) => l.projectId === e.projectId);
                      return (
                        <tr
                          key={e.projectId}
                          className="border-b border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-page)]"
                        >
                          <td className="px-4 py-2">
                            <Link
                              to={`/projects/${e.projectId}/gantt`}
                              className="text-[color:var(--accent)] hover:underline font-medium"
                            >
                              {e.projectName} ({e.projectKey})
                            </Link>
                          </td>
                          <td className="text-right px-4 py-2 text-[color:var(--text-primary)]">{e.totalIssues}</td>
                          <td className="text-right px-4 py-2 text-[color:var(--text-muted)] text-xs">
                            {tl?.datedIssueCount ?? '—'} · {tl?.epicCount ?? 0} epics
                          </td>
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
                      );
                    })}
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
