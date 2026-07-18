import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import { documentsApi } from '../../lib/api';
import MetricCard from '../../components/MetricCard';
import SectionCard from '../../components/SectionCard';
import { chartTooltipProps, getChartColor } from '../../lib/chartTheme';
import { EmptyChart, LoadingCard, ModuleHeader, StatusPill, money } from '../../components/moduleKit';

type Dash = {
  counts: { total: number; templates: number; awaitingSignature: number; signed: number };
  proposalValue: number;
  signedValue: number;
  winRate: number;
  byKind: { name: string; value: number }[];
  byStatus: { name: string; value: number }[];
  recent: Array<{ _id: string; title: string; kind: string; status: string; value: number; currency: string; account?: string; updatedAt: string }>;
  awaitingSignature: Array<{ _id: string; title: string; account?: string; value: number; currency: string; sentAt?: string }>;
};

export default function DocumentsDashboard() {
  const { token } = useAuth();
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    documentsApi.dashboard(token).then((r) => { setLoading(false); if (r.success && r.data) setData(r.data as Dash); });
  }, [token]);

  if (loading) return <LoadingCard label="Loading document vault…" />;
  if (!data) return <div className="p-8 text-red-400">Failed to load documents dashboard.</div>;

  const kindPie = data.byKind.filter((d) => d.value > 0);

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <ModuleHeader
        eyebrow="Documents"
        title="Document vault"
        subtitle="Proposals, SOWs, policies, and templates linked to accounts, deals, and contracts."
        accent="#6366f1"
        actions={[
          { to: '/documents/proposals', label: 'Proposals', primary: true },
          { to: '/documents/sows', label: 'SOWs' },
          { to: '/documents/templates', label: 'Templates' },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Documents" value={data.counts.total} helperText={`${data.counts.templates} templates`} />
        <MetricCard title="Proposal value" value={money(data.proposalValue)} helperText={`${money(data.signedValue)} signed`} />
        <MetricCard title="Win rate" value={`${data.winRate}%`} helperText="Signed / total value" />
        <MetricCard title="Awaiting signature" value={data.counts.awaitingSignature} helperText={`${data.counts.signed} signed`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <SectionCard className="xl:col-span-2" title="By type">
          {kindPie.length === 0 ? <EmptyChart label="No documents yet." /> : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={kindPie} dataKey="value" nameKey="name" cx="42%" cy="50%" innerRadius="48%" outerRadius="72%" paddingAngle={3}>
                    {kindPie.map((_, i) => <Cell key={i} fill={getChartColor(i)} stroke="var(--bg-surface)" strokeWidth={2} />)}
                  </Pie>
                  <Tooltip {...chartTooltipProps} />
                  <Legend layout="vertical" verticalAlign="middle" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard className="xl:col-span-3" title="By status">
          {data.byStatus.every((d) => d.value === 0) ? <EmptyChart label="No documents yet." /> : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byStatus} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                  <Tooltip {...chartTooltipProps} />
                  <Bar dataKey="value" name="Documents" fill={getChartColor(5)} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Recent documents">
          {data.recent.length === 0 ? <p className="text-sm text-[color:var(--text-muted)] py-8 text-center">No documents yet.</p> : (
            <ul className="divide-y divide-[color:var(--border-subtle)]">
              {data.recent.map((d) => (
                <li key={d._id} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="min-w-0"><p className="font-medium truncate">{d.title}</p><p className="text-[11px] text-[color:var(--text-muted)] capitalize">{d.kind} · {d.account || 'unlinked'}</p></div>
                  <StatusPill label={d.status} tone={d.status === 'signed' || d.status === 'approved' ? 'green' : d.status === 'sent' ? 'blue' : 'slate'} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Awaiting signature">
          {data.awaitingSignature.length === 0 ? <p className="text-sm text-[color:var(--text-muted)] py-8 text-center">Nothing awaiting signature.</p> : (
            <ul className="divide-y divide-[color:var(--border-subtle)]">
              {data.awaitingSignature.map((d) => (
                <li key={d._id} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="min-w-0"><p className="font-medium truncate">{d.title}</p><p className="text-[11px] text-[color:var(--text-muted)]">{d.account || 'unlinked'}</p></div>
                  <span className="tabular-nums font-medium">{money(d.value, d.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
