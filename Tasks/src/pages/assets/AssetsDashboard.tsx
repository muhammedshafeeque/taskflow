import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '../../contexts/AuthContext';
import { assetsApi } from '../../lib/api';
import MetricCard from '../../components/MetricCard';
import SectionCard from '../../components/SectionCard';
import { chartTooltipProps, getChartColor } from '../../lib/chartTheme';
import { EmptyChart, LoadingCard, ModuleHeader, money } from '../../components/moduleKit';

type Dash = {
  counts: { totalAssets: number; assigned: number; inStock: number; inRepair: number; servers: number; licenses: number; warrantyExpiring: number };
  totalAssetValue: number;
  seatsTotal: number;
  seatsUsed: number;
  annualLicenseSpend: number;
  byCategory: { name: string; value: number }[];
  byStatus: { name: string; value: number }[];
  licenseUtilization: { name: string; used: number; free: number }[];
  expiringWarranty: Array<{ _id: string; name: string; assetTag: string; category: string; warrantyExpiry?: string; daysLeft: number }>;
};

export default function AssetsDashboard() {
  const { token } = useAuth();
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    assetsApi.dashboard(token).then((r) => {
      setLoading(false);
      if (r.success && r.data) setData(r.data as Dash);
    });
  }, [token]);

  if (loading) return <LoadingCard label="Loading asset dashboard…" />;
  if (!data) return <div className="p-8 text-red-400">Failed to load asset dashboard.</div>;

  const catPie = data.byCategory.filter((d) => d.value > 0);
  const statusPie = data.byStatus.filter((d) => d.value > 0);

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-6">
      <ModuleHeader
        eyebrow="CMDB"
        title="Assets dashboard"
        subtitle="Hardware, servers, licenses, and warranty coverage across the workspace."
        accent="#0ea5e9"
        actions={[
          { to: '/assets/inventory', label: 'Inventory', primary: true },
          { to: '/assets/licenses', label: 'Licenses' },
          { to: '/assets/warranty', label: 'Warranty' },
        ]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Total assets" value={data.counts.totalAssets} helperText={`${data.counts.assigned} assigned · ${data.counts.inStock} in stock`} />
        <MetricCard title="Asset value" value={money(data.totalAssetValue)} helperText={`${data.counts.servers} servers`} />
        <MetricCard title="License seats" value={`${data.seatsUsed}/${data.seatsTotal}`} helperText={`${money(data.annualLicenseSpend)} annual spend`} />
        <MetricCard title="Warranty expiring" value={data.counts.warrantyExpiring} helperText="Next 60 days" />
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <SectionCard className="xl:col-span-2" title="By category">
          {catPie.length === 0 ? <EmptyChart label="No assets yet." /> : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={catPie} dataKey="value" nameKey="name" cx="42%" cy="50%" innerRadius="48%" outerRadius="72%" paddingAngle={3}>
                    {catPie.map((_, i) => <Cell key={i} fill={getChartColor(i)} stroke="var(--bg-surface)" strokeWidth={2} />)}
                  </Pie>
                  <Tooltip {...chartTooltipProps} />
                  <Legend layout="vertical" verticalAlign="middle" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard className="xl:col-span-3" title="License seat utilization" description="Used vs free seats per license.">
          {data.licenseUtilization.length === 0 ? <EmptyChart label="No licenses tracked." /> : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.licenseUtilization} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} stroke="var(--text-muted)" interval={0} angle={-12} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 11 }} stroke="var(--text-muted)" allowDecimals={false} />
                  <Tooltip {...chartTooltipProps} />
                  <Legend />
                  <Bar dataKey="used" name="Used" stackId="s" fill={getChartColor(0)} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="free" name="Free" stackId="s" fill={getChartColor(2)} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-5">
        <SectionCard className="xl:col-span-2" title="By status">
          {statusPie.length === 0 ? <EmptyChart label="No assets yet." /> : (
            <ul className="space-y-2.5 pt-1">
              {data.byStatus.map((s, i) => (
                <li key={s.name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 capitalize"><span className="h-2.5 w-2.5 rounded-full" style={{ background: getChartColor(i) }} />{s.name}</span>
                  <span className="tabular-nums font-medium">{s.value}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard className="xl:col-span-3" title="Warranty expiring soon" description="Coverage ending within 60 days.">
          {data.expiringWarranty.length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)] py-8 text-center">No warranties expiring soon.</p>
          ) : (
            <ul className="divide-y divide-[color:var(--border-subtle)]">
              {data.expiringWarranty.map((a) => (
                <li key={a._id} className="flex items-center justify-between py-2.5 text-sm">
                  <div><p className="font-medium">{a.name}</p><p className="text-[11px] text-[color:var(--text-muted)]">{a.assetTag} · {a.category}</p></div>
                  <span className={`text-[11px] font-medium ${a.daysLeft <= 14 ? 'text-rose-500' : 'text-amber-600 dark:text-amber-400'}`}>
                    {a.daysLeft <= 0 ? 'Expired' : `${a.daysLeft}d left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
