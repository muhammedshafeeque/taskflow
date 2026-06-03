import { useEffect, useState } from 'react';
import { issuesApi, type IssueRollup } from '../../lib/api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { getChartColor } from '../../lib/chartTheme';

interface EpicRollupPanelProps {
  issueId: string;
  token: string;
  show: boolean;
}

export default function EpicRollupPanel({ issueId, token, show }: EpicRollupPanelProps) {
  const [rollup, setRollup] = useState<IssueRollup | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!show || !token || !issueId) return;
    setLoading(true);
    setError('');
    issuesApi.getRollup(issueId, token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setRollup(res.data);
      else setError(res.message ?? 'Failed to load rollup');
    });
  }, [issueId, token, show]);

  if (!show) return null;
  if (loading) {
    return (
      <section className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 card-shadow">
        <p className="text-xs text-[color:var(--text-muted)]">Loading epic rollup…</p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 card-shadow">
        <p className="text-xs text-red-500">{error}</p>
      </section>
    );
  }
  if (!rollup || rollup.childCount === 0) return null;

  return (
    <section className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
        <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">Epic rollup</h3>
        <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">
          Leaf story points only · {rollup.childCount} descendant{rollup.childCount === 1 ? '' : 's'}
        </p>
      </div>
      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">Total SP</p>
          <p className="text-lg font-semibold text-[color:var(--text-primary)]">{rollup.totalStoryPoints}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">Done SP</p>
          <p className="text-lg font-semibold text-[color:var(--text-primary)]">{rollup.completedStoryPoints}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">% complete</p>
          <p className="text-lg font-semibold text-[color:var(--text-primary)]">{rollup.percentDone}%</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">Direct children</p>
          <p className="text-lg font-semibold text-[color:var(--text-primary)]">{rollup.directChildCount}</p>
        </div>
      </div>
      {rollup.statusBreakdown.length > 0 && (
        <div className="px-4 pb-3">
          <p className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)] mb-2">By status (leaves)</p>
          <div className="flex flex-wrap gap-2">
            {rollup.statusBreakdown.map((s) => (
              <span
                key={s.status}
                className="text-[11px] px-2 py-1 rounded-full bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)]"
              >
                {s.status}: {s.count} ({s.storyPoints} SP)
              </span>
            ))}
          </div>
        </div>
      )}
      {rollup.burndown.length > 1 && (
        <div className="px-4 pb-4 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rollup.burndown}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="remainingStoryPoints"
                name="Remaining SP"
                stroke={getChartColor(0)}
                dot={false}
                strokeWidth={2}
              />
              <Line
                type="monotone"
                dataKey="ideal"
                name="Ideal"
                stroke={getChartColor(1)}
                dot={false}
                strokeDasharray="4 4"
                strokeWidth={1.5}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}
