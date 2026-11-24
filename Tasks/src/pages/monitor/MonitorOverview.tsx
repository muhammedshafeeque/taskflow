import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { monitorApi } from '../../lib/api';
import { useMonitorWorkspace } from './MonitorWorkspace';
import { ModuleHeader } from '../../components/moduleKit';
import MetricCard from '../../components/MetricCard';
import SectionCard from '../../components/SectionCard';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, Tooltip, XAxis, YAxis } from 'recharts';
import { ResponsiveContainer } from '../../components/charts/ResponsiveContainer';
import { chartTooltipProps, getChartColor } from '../../lib/chartTheme';

export default function MonitorOverview() {
  const { token } = useAuth();
  const { projectId, project } = useMonitorWorkspace();
  const [overview, setOverview] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token || !projectId) return;
    const pull = () => {
      monitorApi.overview(projectId, token).then((r) => {
        if (r.success && r.data) setOverview(r.data);
        else setError(r.message || 'Failed to load overview');
      });
    };
    pull();
    const timer = window.setInterval(pull, 10000);
    return () => window.clearInterval(timer);
  }, [token, projectId]);

  const bar = useMemo(
    () => [
      { name: 'Logs', value: Number(overview?.last24hLogs ?? 0) },
      { name: 'Errors', value: Number(overview?.openErrors ?? 0) },
      { name: 'Live', value: Number(overview?.liveUsers ?? 0) },
      { name: 'HTTP 4xx+', value: Number(overview?.httpErrors ?? 0) },
      { name: 'Uptime fail', value: Number(overview?.uptimeFail ?? 0) },
    ],
    [overview]
  );

  const pie = useMemo(() => {
    const v = (overview?.vitals as Record<string, number> | undefined) ?? {};
    return Object.entries(v).map(([name, value]) => ({ name: name.toUpperCase(), value: Number(value) || 0 }));
  }, [overview]);

  return (
    <div className="w-full animate-fade-in space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <ModuleHeader
        eyebrow="Monitor"
        title={project?.name ?? 'Overview'}
        subtitle={`${project?.key ?? ''} · last 24 hours of telemetry in this workspace`.trim()}
        accent="#22d3ee"
      />
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard title="Logs" value={String(overview?.last24hLogs ?? '—')} helperText="Last 24 hours" />
        <MetricCard title="Open errors" value={String(overview?.openErrors ?? '—')} helperText="Unresolved groups" />
        <MetricCard title="Live users" value={String(overview?.liveUsers ?? '—')} helperText="Seen in 2 minutes" />
        <MetricCard
          title="Avg duration"
          value={overview ? `${Math.round(Number(overview.transactionAvgMs || 0))} ms` : '—'}
          helperText="Transactions"
        />
        <MetricCard title="HTTP errors" value={String(overview?.httpErrors ?? '—')} helperText="Status ≥ 400" />
        <MetricCard title="Uptime failures" value={String(overview?.uptimeFail ?? '—')} helperText="Failed pings" />
      </div>
      <div className="grid gap-6 xl:grid-cols-5">
        <SectionCard className="xl:col-span-3" title="Signal mix" description="Relative volume across monitors.">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bar} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                <Tooltip {...chartTooltipProps} />
                <Bar dataKey="value" fill={getChartColor(1)} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
        <SectionCard className="xl:col-span-2" title="Web vitals" description="Average LCP / INP / CLS / TTFB.">
          {pie.length === 0 ? (
            <p className="flex h-64 items-center justify-center text-sm text-[color:var(--text-muted)]">No vitals ingested yet.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pie} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72} paddingAngle={2}>
                    {pie.map((_, i) => (
                      <Cell key={i} fill={getChartColor(i)} />
                    ))}
                  </Pie>
                  <Tooltip {...chartTooltipProps} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>
      <p className="text-[12px] text-[color:var(--text-muted)]">
        Mongo TTL: ~14 days for most events, ~90 days for errors, ~5 minutes for presence. Sample in production SDKs.
      </p>
    </div>
  );
}
