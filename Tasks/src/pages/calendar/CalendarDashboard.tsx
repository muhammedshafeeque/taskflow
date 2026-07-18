import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import { calendarApi } from '../../lib/api';
import MetricCard from '../../components/MetricCard';
import SectionCard from '../../components/SectionCard';
import { chartTooltipProps, getChartColor } from '../../lib/chartTheme';
import { EmptyChart, LoadingCard, ModuleHeader, StatusPill } from '../../components/moduleKit';

type Dash = {
  counts: { total: number; thisWeek: number; meetings: number; renewals: number; slaDue: number };
  bySource: { name: string; value: number }[];
  byDay: { day: string; count: number }[];
  upcoming: Array<{ id: string; source: string; kind: string; title: string; start: string; link?: string; meta?: Record<string, unknown> }>;
};

const sourceTone: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate' | 'violet'> = {
  calendar: 'blue', activity: 'violet', contract_renewal: 'amber', ticket_sla: 'red', subscription: 'green',
};

export default function CalendarDashboard() {
  const { token } = useAuth();
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    calendarApi.dashboard(token).then((r) => { setLoading(false); if (r.success && r.data) setData(r.data as Dash); });
  }, [token]);

  if (loading) return <LoadingCard label="Loading calendar…" />;
  if (!data) return <div className="p-8 text-red-400">Failed to load calendar.</div>;

  const sourcePie = data.bySource.filter((d) => d.value > 0);

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <ModuleHeader
        eyebrow="Calendar"
        title="Unified calendar"
        subtitle="One view across meetings, CRM follow-ups, contract renewals, SLA deadlines, and subscription billing."
        accent="#e11d48"
        actions={[
          { to: '/calendar/meetings', label: 'Meetings', primary: true },
          { to: '/calendar/demos', label: 'Demos' },
          { to: '/calendar/reviews', label: 'Reviews' },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Upcoming events" value={data.counts.total} helperText={`${data.counts.thisWeek} this week`} />
        <MetricCard title="Meetings" value={data.counts.meetings} helperText="Scheduled" />
        <MetricCard title="Renewals" value={data.counts.renewals} helperText="Contracts due" />
        <MetricCard title="SLA deadlines" value={data.counts.slaDue} helperText="Tickets due" />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <SectionCard className="xl:col-span-3" title="Next 14 days" description="Events per day across all sources.">
          {data.byDay.every((d) => d.count === 0) ? <EmptyChart label="Nothing scheduled." /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byDay} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="var(--text-muted)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                  <Tooltip {...chartTooltipProps} />
                  <Bar dataKey="count" name="Events" fill={getChartColor(4)} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard className="xl:col-span-2" title="By source">
          {sourcePie.length === 0 ? <EmptyChart label="Nothing scheduled." /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={sourcePie} dataKey="value" nameKey="name" cx="42%" cy="50%" innerRadius="48%" outerRadius="72%" paddingAngle={3}>
                    {sourcePie.map((_, i) => <Cell key={i} fill={getChartColor(i)} stroke="var(--bg-surface)" strokeWidth={2} />)}
                  </Pie>
                  <Tooltip {...chartTooltipProps} />
                  <Legend layout="vertical" verticalAlign="middle" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Upcoming agenda">
        {data.upcoming.length === 0 ? (
          <p className="text-sm text-[color:var(--text-muted)] py-8 text-center">Nothing coming up.</p>
        ) : (
          <ul className="divide-y divide-[color:var(--border-subtle)]">
            {data.upcoming.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex items-center gap-3">
                  <div className="w-16 shrink-0 text-center">
                    <p className="text-[11px] uppercase text-[color:var(--text-muted)]">{new Date(e.start).toLocaleDateString(undefined, { month: 'short' })}</p>
                    <p className="text-lg font-bold leading-none">{new Date(e.start).getDate()}</p>
                  </div>
                  <div className="min-w-0"><p className="font-medium truncate">{e.title}</p><p className="text-[11px] text-[color:var(--text-muted)]">{new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div>
                </div>
                <StatusPill label={e.source} tone={sourceTone[e.source] ?? 'slate'} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
