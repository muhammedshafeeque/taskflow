import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, type StageEstimate } from '../lib/api';

export default function EstimateApprovals() {
  const { projectId: routeProjectId } = useParams<{ projectId: string }>();
  const { token } = useAuth();
  const [projectId, setProjectId] = useState(routeProjectId ?? '');
  const [items, setItems] = useState<StageEstimate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (routeProjectId) setProjectId(routeProjectId);
  }, [routeProjectId]);

  useEffect(() => {
    if (!token || !projectId) return;
    setLoading(true);
    setError('');
    projectsApi.getEstimateApprovals(projectId, token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setItems(Array.isArray(res.data) ? res.data : []);
      else setError(res.message ?? 'Failed to load');
    });
  }, [token, projectId]);

  return (
    <div className="p-8 animate-fade-in max-w-3xl">
      <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">Estimate approvals</h1>
      <p className="text-sm text-[color:var(--text-muted)] mt-1">
        Pending stage estimates awaiting approval for this project.
      </p>
      {!routeProjectId && (
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            placeholder="Project ID"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="flex-1 px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-sm"
          />
        </div>
      )}
      {error && <p className="text-sm text-red-500 mt-2">{error}</p>}
      {loading ? (
        <p className="text-sm text-[color:var(--text-muted)] mt-4">Loading…</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.length === 0 ? (
            <li className="text-sm text-[color:var(--text-muted)]">No pending approvals.</li>
          ) : (
            items.map((e) => {
              const issue = e.issue as unknown as { _id?: string; key?: string; title?: string };
              const issueKey = issue.key ?? issue._id;
              const issuePath = projectId && issueKey
                ? `/projects/${projectId}/issues/${encodeURIComponent(String(issueKey))}`
                : '#';
              return (
                <li key={e._id} className="p-3 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]">
                  <Link to={issuePath} className="text-sm font-medium text-[color:var(--accent)] hover:underline">
                    {issueKey}
                  </Link>
                  {issue.title && (
                    <span className="text-xs text-[color:var(--text-muted)] ml-2">{issue.title}</span>
                  )}
                  <span className="text-xs text-[color:var(--text-muted)] ml-2">
                    {e.laneId} · {e.minutes}m · pending
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
