import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import { procurementApi } from '../../lib/api';
import MetricCard from '../../components/MetricCard';
import SectionCard from '../../components/SectionCard';
import { chartTooltipProps, getChartColor } from '../../lib/chartTheme';
import { EmptyChart, LoadingCard, ModuleHeader, money } from '../../components/moduleKit';

type Dash = {
  counts: { totalPos: number; open: number; pendingApproval: number; vendors: number; received: number };
  committedSpend: number;
  totalSpend: number;
  byStatus: { name: string; value: number }[];
  byCategory: { name: string; value: number }[];
  spendByVendor: { name: string; value: number }[];
  pendingApprovalList: Array<{ _id: string; poNumber: string; title: string; vendor?: string; total: number; currency: string }>;
};

export default function ProcurementDashboard() {
  const { token } = useAuth();
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    procurementApi.dashboard(token).then((r) => { setLoading(false); if (r.success && r.data) setData(r.data as Dash); });
  }, [token]);

  if (loading) return <LoadingCard label="Loading procurement dashboard…" />;
  if (!data) return <div className="p-8 text-red-400">Failed to load procurement dashboard.</div>;

  const statusPie = data.byStatus.filter((d) => d.value > 0);

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <ModuleHeader
        eyebrow="Procurement"
        title="Procurement dashboard"
        subtitle="Vendors, purchase orders, and committed spend. Vendors are shared with CRM as vendor accounts."
        accent="#a855f7"
        actions={[
          { to: '/procurement/pos', label: 'Purchase orders', primary: true },
          { to: '/procurement/vendors', label: 'Vendors' },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Committed spend" value={money(data.committedSpend)} helperText={`${data.counts.open} open POs`} />
        <MetricCard title="Total spend" value={money(data.totalSpend)} helperText={`${data.counts.totalPos} POs`} />
        <MetricCard title="Pending approval" value={data.counts.pendingApproval} helperText="Awaiting sign-off" />
        <MetricCard title="Vendors" value={data.counts.vendors} helperText={`${data.counts.received} received`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <SectionCard className="xl:col-span-3" title="Spend by vendor" description="Non-cancelled PO totals.">
          {data.spendByVendor.length === 0 ? <EmptyChart label="No purchase orders yet." /> : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.spendByVendor} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--text-muted)" tickFormatter={(v) => money(Number(v))} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" width={110} />
                  <Tooltip {...chartTooltipProps} formatter={(v) => money(Number(v))} />
                  <Bar dataKey="value" name="Spend" fill={getChartColor(6)} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard className="xl:col-span-2" title="PO status">
          {statusPie.length === 0 ? <EmptyChart label="No POs yet." /> : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusPie} dataKey="value" nameKey="name" cx="42%" cy="50%" innerRadius="48%" outerRadius="72%" paddingAngle={3}>
                    {statusPie.map((_, i) => <Cell key={i} fill={getChartColor(i)} stroke="var(--bg-surface)" strokeWidth={2} />)}
                  </Pie>
                  <Tooltip {...chartTooltipProps} />
                  <Legend layout="vertical" verticalAlign="middle" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Spend by category">
          {data.byCategory.length === 0 ? <EmptyChart label="No spend yet." /> : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.byCategory} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="var(--text-muted)" />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" tickFormatter={(v) => money(Number(v))} />
                  <Tooltip {...chartTooltipProps} formatter={(v) => money(Number(v))} />
                  <Bar dataKey="value" name="Spend" fill={getChartColor(3)} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Awaiting approval">
          {data.pendingApprovalList.length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)] py-8 text-center">Nothing awaiting approval.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--border-subtle)]">
              {data.pendingApprovalList.map((p) => (
                <li key={p._id} className="flex items-center justify-between py-2.5 text-sm">
                  <div><p className="font-medium">{p.title}</p><p className="text-[11px] text-[color:var(--text-muted)]">{p.poNumber} · {p.vendor || '—'}</p></div>
                  <span className="tabular-nums font-medium">{money(p.total, p.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
