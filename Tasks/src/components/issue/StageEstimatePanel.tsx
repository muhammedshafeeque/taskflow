import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  issuesApi,
  workLogsApi,
  type EstimateSummary,
  type Project,
  type StageEstimate,
} from '../../lib/api';
import { PROJECT_PERMISSIONS } from '@shared/constants/permissions';

interface StageEstimatePanelProps {
  issueId: string;
  project: Project | null;
  projectPermissions: string[];
  hasChildren?: boolean;
}

function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

export default function StageEstimatePanel({
  issueId,
  project,
  projectPermissions,
  hasChildren,
}: StageEstimatePanelProps) {
  const { token } = useAuth();
  const [summary, setSummary] = useState<EstimateSummary | null>(null);
  const [estimates, setEstimates] = useState<StageEstimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [laneRows, setLaneRows] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [logLane, setLogLane] = useState('');
  const [logMinutes, setLogMinutes] = useState('');
  const [overrunReason, setOverrunReason] = useState('');
  const [error, setError] = useState('');

  const lanes = useMemo(() => {
    const set = new Set<string>();
    for (const s of project?.statuses ?? []) {
      if (s.userInLane) set.add(s.userInLane);
    }
    return [...set];
  }, [project?.statuses]);

  const canSubmit = projectPermissions.includes(PROJECT_PERMISSIONS.ISSUE.ESTIMATE.SUBMIT);
  const canApprove = projectPermissions.includes(PROJECT_PERMISSIONS.ISSUE.ESTIMATE.APPROVE);
  const canLog = projectPermissions.includes(PROJECT_PERMISSIONS.WORK_LOG.WORK_LOG.CREATE);
  const enabled = project?.estimateApprovalEnabled;

  async function reload() {
    if (!token || !enabled) return;
    setLoading(true);
    const [sumRes, listRes] = await Promise.all([
      issuesApi.getEstimateSummary(issueId, token),
      issuesApi.getStageEstimates(issueId, token),
    ]);
    setLoading(false);
    if (sumRes.success && sumRes.data) setSummary(sumRes.data as EstimateSummary);
    if (listRes.success && listRes.data) setEstimates(Array.isArray(listRes.data) ? listRes.data : []);
  }

  useEffect(() => {
    if (!token || !enabled) {
      setLoading(false);
      return;
    }
    reload();
  }, [token, issueId, enabled]);

  if (!enabled) return null;

  async function handleSubmit() {
    if (!token) return;
    const payload = lanes
      .map((lane) => ({ laneId: lane, minutes: Number(laneRows[lane] || 0) }))
      .filter((r) => r.minutes > 0);
    if (!payload.length) return;
    setSubmitting(true);
    setError('');
    const res = await issuesApi.submitStageEstimates(issueId, payload, token);
    setSubmitting(false);
    if (res.success) {
      setLaneRows({});
      reload();
    } else setError(res.message ?? 'Submit failed');
  }

  async function handleApprove(estId: string) {
    if (!token) return;
    const res = await issuesApi.approveStageEstimate(issueId, estId, token);
    if (res.success) reload();
    else setError(res.message ?? 'Approve failed');
  }

  async function handleReject(estId: string) {
    if (!token) return;
    const note = window.prompt('Reason for rejection:');
    if (!note?.trim()) return;
    const res = await issuesApi.rejectStageEstimate(issueId, estId, note.trim(), token);
    if (res.success) reload();
    else setError(res.message ?? 'Reject failed');
  }

  async function handleLogTime() {
    if (!token || !logMinutes) return;
    setError('');
    const res = await workLogsApi.create(
      issueId,
      {
        minutesSpent: Number(logMinutes),
        date: new Date().toISOString().slice(0, 10),
        laneId: logLane || undefined,
        overrunReason: overrunReason || undefined,
      },
      token
    );
    if (res.success) {
      setLogMinutes('');
      setOverrunReason('');
      reload();
    } else setError(res.message ?? 'Log failed');
  }

  return (
    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">Stage estimates</h3>
        {project?._id && (
          <Link
            to={`/projects/${project._id}/settings`}
            className="text-[11px] text-[color:var(--accent)] hover:underline"
          >
            Configure
          </Link>
        )}
      </div>
      {loading ? (
        <p className="text-xs text-[color:var(--text-muted)]">Loading…</p>
      ) : (
        <>
          {summary?.rollup && (
            <div className="text-xs text-[color:var(--text-muted)] space-y-1">
              <p>
                Approved total: <strong className="text-[color:var(--text-primary)]">{formatMinutes(summary.rollup.totalApprovedMinutes)}</strong>
                {summary.rollup.fromChildren ? ' (from children)' : ''}
              </p>
              {Object.entries(summary.rollup.byLane).map(([lane, min]) => (
                <p key={lane}>
                  {lane}: {formatMinutes(Number(min))} approved
                </p>
              ))}
            </div>
          )}
          {hasChildren ? (
            <p className="text-xs text-[color:var(--text-muted)]">Estimates are entered on child issues; totals roll up here.</p>
          ) : canSubmit && lanes.length > 0 ? (
            <div className="space-y-2">
              {lanes.map((lane) => (
                <div key={lane} className="flex items-center gap-2">
                  <span className="text-xs w-16 text-[color:var(--text-muted)]">{lane}</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="minutes"
                    value={laneRows[lane] ?? ''}
                    onChange={(e) => setLaneRows((prev) => ({ ...prev, [lane]: e.target.value }))}
                    className="flex-1 px-2 py-1 rounded border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs"
                  />
                </div>
              ))}
              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmit}
                className="text-xs px-3 py-1.5 rounded border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-page)] disabled:opacity-50"
              >
                {submitting ? 'Submitting…' : 'Submit for approval'}
              </button>
            </div>
          ) : null}
          {estimates.length > 0 && (
            <ul className="space-y-1 text-xs">
              {estimates.slice(0, 8).map((e) => (
                <li key={e._id} className="flex items-center justify-between gap-2 py-1 border-t border-[color:var(--border-subtle)]/50">
                  <span>
                    <span className="font-medium">{e.laneId}</span> · {formatMinutes(e.minutes)}
                    <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${
                      e.state === 'approved' ? 'bg-green-500/15 text-green-600' :
                      e.state === 'rejected' ? 'bg-red-500/15 text-red-500' :
                      'bg-amber-500/15 text-amber-600'
                    }`}>{e.state}</span>
                  </span>
                  {e.state === 'pending' && canApprove && (
                    <span className="flex gap-1">
                      <button type="button" onClick={() => handleApprove(e._id)} className="text-[color:var(--accent)]">Approve</button>
                      <button type="button" onClick={() => handleReject(e._id)} className="text-red-500">Reject</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canLog && !hasChildren && (
            <div className="pt-2 border-t border-[color:var(--border-subtle)] space-y-2">
              <p className="text-[11px] text-[color:var(--text-muted)]">Log time</p>
              <div className="flex flex-wrap gap-2">
                <select value={logLane} onChange={(e) => setLogLane(e.target.value)} className="text-xs px-2 py-1 rounded border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]">
                  <option value="">Lane (optional)</option>
                  {lanes.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <input type="number" min={1} placeholder="Minutes" value={logMinutes} onChange={(e) => setLogMinutes(e.target.value)} className="w-24 text-xs px-2 py-1 rounded border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]" />
                <button type="button" onClick={handleLogTime} className="text-xs px-2 py-1 rounded border border-[color:var(--border-subtle)]">Log</button>
              </div>
              <input
                type="text"
                placeholder="Overrun reason (if over approved time)"
                value={overrunReason}
                onChange={(e) => setOverrunReason(e.target.value)}
                className="w-full text-xs px-2 py-1 rounded border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]"
              />
            </div>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}
        </>
      )}
    </div>
  );
}
