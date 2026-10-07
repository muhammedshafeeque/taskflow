import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { CrudPage, SettingsForm, fmtDate, type Row } from '../../components/CrudPage';
import { GhostButton, SectionPage, StatusPill, TextInput, money } from '../../components/moduleKit';

const SETTINGS = 'taskflow.platform.settings.manage';
const ANNOUNCE = 'taskflow.platform.announcement.manage';

/** Platform-wide behaviour: which role new sign-ups get, and the 2FA policy. */
export function CorePreferences() {
  return (
    <SettingsForm
      title="Preferences"
      subtitle="Defaults applied to every new account. Roles are yours — create them under Roles."
      endpoint="/core/preferences"
      method="patch"
      managePermissions={[SETTINGS]}
      transformIn={(v) => ({ ...v, defaultRoleId: v.defaultRoleId ? String(v.defaultRoleId) : '' })}
      transformOut={(v) => ({ ...v, defaultRoleId: v.defaultRoleId || null })}
      fields={[
        {
          key: 'defaultRoleId',
          label: 'Role for new users',
          type: 'select',
          optionsFrom: { endpoint: '/roles' },
          help: 'Applied on self sign-up, Google / SSO first login and directory sync. Leave empty to give no permissions until an admin assigns a role.',
        },
        { key: 'requireTwoFactor', label: 'Two-factor authentication', type: 'checkbox', placeholder: 'Require every staff user to set up an authenticator app' },
      ]}
    />
  );
}

export function AnnouncementsAdmin() {
  return (
    <CrudPage
      title="Announcements"
      subtitle="Shown on everyone's Home page and sent as a notification. Target specific roles or the whole workspace."
      endpoint="/announcements"
      listEndpoint="/announcements?all=1"
      managePermissions={[ANNOUNCE]}
      createLabel="New announcement"
      columns={[
        { header: 'Title', render: (r) => <span className="font-medium">{String(r.title)}</span> },
        { header: 'Audience', render: (r) => (((r.roleIds as unknown[]) ?? []).length ? `${(r.roleIds as unknown[]).length} role(s)` : 'Everyone') },
        { header: 'Published', render: (r) => (r.publishedAt ? fmtDate(r.publishedAt, true) : <StatusPill label="draft" tone="amber" />) },
        { header: 'Expires', render: (r) => fmtDate(r.expiresAt) },
        { header: 'Pinned', render: (r) => (r.pinned ? '📌' : '') },
      ]}
      fields={[
        { key: 'title', label: 'Title', required: true },
        { key: 'body', label: 'Message', type: 'textarea', required: true },
        { key: 'roleIds', label: 'Only for these roles (none = everyone)', type: 'multiselect', optionsFrom: { endpoint: '/roles' } },
        { key: 'publishedAt', label: 'Publish at (empty = draft)', type: 'datetime' },
        { key: 'expiresAt', label: 'Expires', type: 'date' },
        { key: 'pinned', label: 'Pinned', type: 'checkbox', placeholder: 'Keep at the top' },
      ]}
    />
  );
}

/** Home widget: current announcements for this user. */
export function AnnouncementsWidget() {
  const { token } = useAuth();
  const [items, setItems] = useState<Row[]>([]);
  useEffect(() => {
    if (!token) return;
    api.get<Row[]>('/announcements', token).then((r) => setItems(Array.isArray(r.data) ? r.data : []));
  }, [token]);
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      {items.slice(0, 3).map((a) => (
        <div key={String(a._id)} className="rounded-2xl border border-[color:var(--accent)]/30 bg-[color:var(--accent)]/5 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {a.pinned ? '📌' : '📣'} {String(a.title)}
            <span className="ml-auto text-[11px] font-normal text-[color:var(--text-muted)]">{fmtDate(a.publishedAt)}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-[13px] text-[color:var(--text-muted)]">{String(a.body)}</p>
        </div>
      ))}
    </div>
  );
}

// ── Management insights ─────────────────────────────────────────────────────
function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
      <div className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-500' : ''}`}>{value}</div>
      {hint && <div className="text-[11px] text-[color:var(--text-muted)]">{hint}</div>}
    </div>
  );
}

export function ManagementInsights() {
  const { token } = useAuth();
  const [currency, setCurrency] = useState('USD');
  const [from, setFrom] = useState(new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [p, setP] = useState<Row | null>(null);
  const [cash, setCash] = useState<Row | null>(null);
  const [payroll, setPayroll] = useState<Row[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!token) return;
    api.get<Row>('/core/company', token).then((r) => r.data?.baseCurrencyCode && setCurrency(String(r.data.baseCurrencyCode)));
    api.get<Row>('/insights/cash', token).then((r) => setCash(r.data ?? null));
    api.get<Row[]>('/insights/payroll-trend', token).then((r) => setPayroll(Array.isArray(r.data) ? r.data : []));
  }, [token]);
  useEffect(() => {
    if (!token) return;
    api.get<Row>(`/insights/profitability?from=${from}&to=${to}`, token).then((r) => (r.success ? setP(r.data ?? null) : setError(r.message ?? 'Failed')));
  }, [token, from, to]);
  const m = (n: unknown) => money(Number(n) || 0, currency);
  const t = (p?.totals as Row) ?? {};
  const u = (p?.utilisation as Row) ?? {};
  const maxPayroll = Math.max(1, ...payroll.map((x) => Number(x.gross) || 0));
  return (
    <SectionPage
      title="Management insights"
      subtitle="Revenue vs cost per project and client, utilisation and cash — computed from invoices, timesheets, expenses, bills, payroll and the ledger."
      toolbar={
        <>
          <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          <GhostButton onClick={() => window.print()}>Print</GhostButton>
        </>
      }
    >
      {error && <p className="text-sm text-rose-500">{error}</p>}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Kpi label="Revenue (net of tax)" value={m(t.revenue)} hint={Number(t.unassignedRevenue) ? `${m(t.unassignedRevenue)} not linked to a project` : undefined} />
        <Kpi label="Labour cost" value={m(t.labourCost)} hint={Number(u.unratedHours) ? `${u.unratedHours}h by people without a cost rate` : undefined} />
        <Kpi label="Other direct cost" value={m(t.otherCost)} />
        <Kpi label="Gross profit" value={m(t.profit)} tone={Number(t.profit) >= 0 ? 'good' : 'bad'} />
        <Kpi label="Utilisation" value={u.utilisationPct == null ? '—' : `${u.utilisationPct}%`} hint={`${u.loggedHours ?? 0}h of ${u.capacityHours ?? 0}h capacity`} />
        <Kpi label="Billable" value={u.billablePct == null ? '—' : `${u.billablePct}%`} hint={`${u.billableHours ?? 0}h billable`} />
        <Kpi label="Bank balance" value={m(cash?.bankBalance)} hint={`${((cash?.banks as Row[]) ?? []).length} account(s)`} />
        <Kpi label="Receivables" value={m(cash?.receivables)} hint={`${m(cash?.overdueReceivables)} overdue`} tone={Number(cash?.overdueReceivables) > 0 ? 'bad' : undefined} />
      </div>
      {cash && (
        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 text-sm grid gap-2 sm:grid-cols-4">
          <div className="font-semibold">Next 30 days</div>
          <div>Expected in: <b>{m((cash.next30 as Row)?.expectedIn)}</b></div>
          <div>Expected out: <b>{m((cash.next30 as Row)?.expectedOut)}</b> <span className="text-[color:var(--text-muted)]">(incl. payroll ≈ {m((cash.next30 as Row)?.payrollEstimate)})</span></div>
          <div>Payables: <b>{m(cash.payables)}</b></div>
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-[2fr_1fr]">
        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
          <div className="px-4 pt-3 text-sm font-semibold">Projects</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)]">
                {['Project', 'Revenue', 'Labour', 'Other', 'Profit', 'Margin', 'Hours (billable)'].map((h) => (
                  <th key={h} className="px-4 py-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {((p?.projects as Row[]) ?? []).map((r) => (
                <tr key={String(r.projectId)} className="border-b border-[color:var(--border-subtle)] last:border-0">
                  <td className="px-4 py-2">{String(r.key ? `${r.key} · ` : '')}{String(r.name)}</td>
                  <td className="px-4 py-2 tabular-nums">{m(r.revenue)}</td>
                  <td className="px-4 py-2 tabular-nums">{m(r.labourCost)}</td>
                  <td className="px-4 py-2 tabular-nums">{m(r.otherCost)}</td>
                  <td className={`px-4 py-2 tabular-nums ${Number(r.profit) < 0 ? 'text-rose-500' : ''}`}>{m(r.profit)}</td>
                  <td className="px-4 py-2">{r.marginPct == null ? '—' : <StatusPill label={`${r.marginPct}%`} tone={Number(r.marginPct) >= 30 ? 'green' : Number(r.marginPct) >= 0 ? 'amber' : 'red'} />}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {String(r.hours)} ({String(r.billableHours)})
                  </td>
                </tr>
              ))}
              {p && ((p.projects as Row[]) ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-[color:var(--text-muted)]">
                    No revenue or logged time in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="space-y-4">
          <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
            <div className="text-sm font-semibold mb-2">Clients</div>
            {((p?.clients as Row[]) ?? []).slice(0, 12).map((c) => (
              <div key={String(c.accountId)} className="flex justify-between border-b border-[color:var(--border-subtle)] py-1.5 text-sm last:border-0">
                <span className="truncate">{String(c.name)}</span>
                <span className="tabular-nums">
                  {m(c.revenue)} <span className={`text-[11px] ${Number(c.profit) < 0 ? 'text-rose-500' : 'text-[color:var(--text-muted)]'}`}>({m(c.profit)})</span>
                </span>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
            <div className="text-sm font-semibold mb-2">Payroll trend (gross)</div>
            <div className="flex h-32 items-end gap-1">
              {payroll.map((x) => (
                <div key={String(x.period)} className="flex-1 rounded-t bg-[color:var(--accent)]/70" style={{ height: `${(Number(x.gross) / maxPayroll) * 100}%` }} title={`${x.period}: ${m(x.gross)} · ${x.employees} employees`} />
              ))}
            </div>
            {payroll.length === 0 && <p className="text-xs text-[color:var(--text-muted)]">No finalized payroll runs.</p>}
          </div>
        </div>
      </div>
    </SectionPage>
  );
}
