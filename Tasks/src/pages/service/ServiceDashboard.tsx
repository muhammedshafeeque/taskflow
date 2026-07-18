import { useEffect, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import { serviceApi } from '../../lib/api';
import MetricCard from '../../components/MetricCard';
import SectionCard from '../../components/SectionCard';
import { chartTooltipProps, getChartColor } from '../../lib/chartTheme';
import { EmptyChart, LoadingCard, ModuleHeader, StatusPill } from '../../components/moduleKit';

type Dash = {
  counts: { total: number; open: number; resolved: number; breached: number; unassigned: number };
  slaCompliance: number;
  csatAvg: number;
  csatResponses: number;
  byStatus: { name: string; value: number }[];
  byPriority: { name: string; value: number }[];
  byQueue: { name: string; value: number }[];
  trend: { month: string; created: number; resolved: number }[];
  breachingSoon: Array<{ _id: string; subject: string; priority: string; status: string; resolutionDueAt?: string; overdue: boolean }>;
};

const priorityTone: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = { urgent: 'red', high: 'amber', medium: 'blue', low: 'slate' };

export default function ServiceDashboard() {
  const { token } = useAuth();
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    serviceApi.dashboard(token).then((r) => { setLoading(false); if (r.success && r.data) setData(r.data as Dash); });
  }, [token]);

  if (loading) return <LoadingCard label="Loading service desk…" />;
  if (!data) return <div className="p-8 text-red-400">Failed to load service desk dashboard.</div>;

  const statusPie = data.byStatus.filter((d) => d.value > 0);

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <ModuleHeader
        eyebrow="Service Desk"
        title="Support dashboard"
        subtitle="Tickets, SLA compliance, and CSAT. SLA targets are inherited from customers' active contracts."
        accent="#e11d48"
        actions={[
          { to: '/service/tickets', label: 'Tickets', primary: true },
          { to: '/service/sla', label: 'SLA policies' },
          { to: '/service/kb', label: 'Knowledge base' },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Open tickets" value={data.counts.open} helperText={`${data.counts.unassigned} unassigned`} />
        <MetricCard title="SLA compliance" value={`${data.slaCompliance}%`} helperText={`${data.counts.breached} breached`} />
        <MetricCard title="CSAT" value={data.csatAvg ? `${data.csatAvg}/5` : '—'} helperText={`${data.csatResponses} responses`} />
        <MetricCard title="Resolved" value={data.counts.resolved} helperText={`${data.counts.total} total`} />
      </div>

      <SectionCard title="Ticket trend" description="Created vs resolved over the last 6 months.">
        {data.trend.every((r) => r.created === 0 && r.resolved === 0) ? <EmptyChart label="No tickets yet." /> : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.trend} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="svcCreated" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={getChartColor(4)} stopOpacity={0.35} /><stop offset="100%" stopColor={getChartColor(4)} stopOpacity={0.02} /></linearGradient>
                  <linearGradient id="svcResolved" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={getChartColor(2)} stopOpacity={0.3} /><stop offset="100%" stopColor={getChartColor(2)} stopOpacity={0.02} /></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                <Tooltip {...chartTooltipProps} />
                <Legend />
                <Area type="monotone" dataKey="created" name="Created" stroke={getChartColor(4)} fill="url(#svcCreated)" strokeWidth={2} />
                <Area type="monotone" dataKey="resolved" name="Resolved" stroke={getChartColor(2)} fill="url(#svcResolved)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard title="By status">
          {statusPie.length === 0 ? <EmptyChart label="No tickets." /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="48%" outerRadius="74%" paddingAngle={3}>
                    {statusPie.map((_, i) => <Cell key={i} fill={getChartColor(i)} stroke="var(--bg-surface)" strokeWidth={2} />)}
                  </Pie>
                  <Tooltip {...chartTooltipProps} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="By priority">
          {data.byPriority.every((d) => d.value === 0) ? <EmptyChart label="No tickets." /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byPriority} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                  <Tooltip {...chartTooltipProps} />
                  <Bar dataKey="value" name="Tickets" radius={[4, 4, 0, 0]}>
                    {data.byPriority.map((_, i) => <Cell key={i} fill={getChartColor(i === 0 ? 4 : i + 1)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="SLA at risk">
          {data.breachingSoon.length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)] py-8 text-center">No tickets at risk. 🎉</p>
          ) : (
            <ul className="divide-y divide-[color:var(--border-subtle)]">
              {data.breachingSoon.map((t) => (
                <li key={t._id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="min-w-0"><p className="font-medium truncate">{t.subject}</p><p className={`text-[11px] ${t.overdue ? 'text-rose-500' : 'text-[color:var(--text-muted)]'}`}>{t.resolutionDueAt ? new Date(t.resolutionDueAt).toLocaleString() : ''}{t.overdue ? ' · overdue' : ''}</p></div>
                  <StatusPill label={t.priority} tone={priorityTone[t.priority]} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
