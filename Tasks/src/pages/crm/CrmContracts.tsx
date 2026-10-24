import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiCheckCircle, FiPlus, FiSearch } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, type CrmContract, type CrmContractSupportPeriod } from '../../lib/api';
import ConfirmModal from '../../components/ConfirmModal';
import {
  Chip,
  CrmShell,
  EmptyState,
  Field,
  LoadingBlock,
  Modal,
  Notice,
  RowMenu,
  Segmented,
  Stat,
  btnPrimary,
  btnSecondary,
  daysUntil,
  errorOf,
  fmtDate,
  inputCls,
  money,
  moneyShort,
  prettyLabel,
  refId,
  refName,
  toDateInput,
} from './crmKit';

type Kind = 'msa' | 'retainer' | 'amc' | 'hourly' | 'other';
type StatusFilter = 'all' | 'active' | 'draft' | 'expired' | 'cancelled';
const KIND_LABEL: Record<Kind, string> = { msa: 'MSA', retainer: 'Retainer', amc: 'AMC', hourly: 'Hourly', other: 'Other' };
const STATUS_TONE: Record<string, 'good' | 'neutral' | 'bad' | 'warn'> = { active: 'good', draft: 'neutral', expired: 'warn', cancelled: 'bad' };

type Form = {
  customerOrgId: string;
  title: string;
  kind: Kind;
  value: string;
  currency: string;
  billingCycle: string;
  startDate: string;
  endDate: string;
  renewalDate: string;
  autoRenew: boolean;
  hoursIncluded: string;
  hourlyRate: string;
  supportPeriod: CrmContractSupportPeriod;
  supportDurationMonths: string;
  prodReleaseDate: string;
  status: string;
};

function formFrom(c: CrmContract | null, orgId: string): Form {
  return {
    customerOrgId: refId(c?.customerOrgId) || orgId,
    title: c?.title ?? '',
    kind: (c?.kind ?? 'retainer') as Kind,
    value: String(c?.value ?? 0),
    currency: c?.currency ?? 'USD',
    billingCycle: c?.billingCycle ?? 'monthly',
    startDate: toDateInput(c?.startDate) || new Date().toISOString().slice(0, 10),
    endDate: toDateInput(c?.endDate),
    renewalDate: toDateInput(c?.renewalDate),
    autoRenew: !!c?.autoRenew,
    hoursIncluded: c?.hoursIncluded != null ? String(c.hoursIncluded) : '',
    hourlyRate: c?.hourlyRate != null ? String(c.hourlyRate) : '',
    supportPeriod: c?.supportPeriod ?? 'lifelong_with_payment',
    supportDurationMonths: String(c?.supportDurationMonths ?? 6),
    prodReleaseDate: toDateInput(c?.prodReleaseDate),
    status: c?.status ?? 'active',
  };
}

export default function CrmContracts() {
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.crm.contract.create');
  const canUpdate = canAny(user, 'taskflow.crm.contract.update');
  const canDelete = canAny(user, 'taskflow.crm.contract.delete');
  const [rows, setRows] = useState<CrmContract[] | null>(null);
  const [orgs, setOrgs] = useState<Array<{ _id: string; name: string }>>([]);
  const [modal, setModal] = useState<{ editing: CrmContract | null } | null>(null);
  const [deleting, setDeleting] = useState<CrmContract | null>(null);
  const [burn, setBurn] = useState<Record<string, { hoursUsed: number; hoursRemaining: number; percentUsed: number }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [tick, setTick] = useState(0);
  const load = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!token) return;
    let stale = false;
    crmApi.listContracts(token).then((res) => {
      if (stale) return;
      if (res.success && res.data) setRows(res.data as CrmContract[]);
      else setNotice(errorOf(res, 'Could not load contracts.'));
    });
    return () => {
      stale = true;
    };
  }, [token, tick]);

  useEffect(() => {
    if (!token) return;
    crmApi.listCustomerOrgs(token).then((res) => {
      if (res.success && res.data) setOrgs(Array.isArray(res.data) ? res.data : []);
    });
  }, [token]);

  const all = useMemo(() => rows ?? [], [rows]);
  const orgName = (c: CrmContract) => refName(c.customerOrgId) || refName(c.accountId) || orgs.find((o) => o._id === refId(c.customerOrgId))?.name || '—';
  const active = all.filter((c) => c.status === 'active');
  const renewingSoon = active.filter((c) => {
    const d = daysUntil(c.renewalDate ?? c.endDate);
    return d != null && d >= 0 && d <= 60;
  });
  const currency = all[0]?.currency;

  const shown = all.filter((c) => {
    if (status !== 'all' && c.status !== status) return false;
    const q = search.trim().toLowerCase();
    return !q || `${c.title} ${orgName(c)} ${c.kind ?? ''}`.toLowerCase().includes(q);
  });

  async function run(fn: () => Promise<{ success: boolean }>, fallback: string) {
    const res = await fn();
    if (!res.success) setNotice(errorOf(res, fallback));
    load();
  }

  async function showBurn(id: string) {
    if (!token) return;
    const res = await crmApi.getContractBurnDown(id, token);
    if (res.success && res.data) setBurn((b) => ({ ...b, [id]: res.data as (typeof b)[string] }));
  }

  return (
    <CrmShell
      title="Contracts"
      description="Retainers, MSAs and support agreements — with renewals and hour burn-down."
      actions={
        canCreate && (
          <button type="button" className={btnPrimary} disabled={orgs.length === 0} onClick={() => setModal({ editing: null })} title={orgs.length === 0 ? 'Create a customer organisation first' : undefined}>
            <FiPlus /> New contract
          </button>
        )
      }
    >
      <Notice message={notice} onClose={() => setNotice(null)} />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Stat label="Active contracts" value={active.length} hint={`${all.length} total`} />
        <Stat label="Active value" value={moneyShort(active.reduce((s, c) => s + (c.value ?? 0), 0), currency)} />
        <Stat label="Renewing in 60 days" value={renewingSoon.length} tone={renewingSoon.length ? 'warn' : undefined} />
        <Stat label="Drafts" value={all.filter((c) => c.status === 'draft').length} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<StatusFilter>
          value={status}
          onChange={setStatus}
          options={(['all', 'active', 'draft', 'expired', 'cancelled'] as const).map((s) => ({
            value: s,
            label: prettyLabel(s),
            count: s === 'all' ? all.length : all.filter((c) => c.status === s).length,
          }))}
        />
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search contracts or customers…" className={`${inputCls} pl-9`} />
        </div>
      </div>

      {!rows ? (
        <LoadingBlock label="Loading contracts…" />
      ) : shown.length === 0 ? (
        <EmptyState title="No contracts here">{all.length ? 'Try another filter.' : 'Add the first agreement with a customer.'}</EmptyState>
      ) : (
        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)] text-left border-b border-[color:var(--border-subtle)]">
                <th className="py-2.5 px-4 font-medium">Contract</th>
                <th className="py-2.5 px-3 font-medium">Status</th>
                <th className="py-2.5 px-3 font-medium text-right">Value</th>
                <th className="py-2.5 px-3 font-medium hidden md:table-cell">Term</th>
                <th className="py-2.5 px-3 font-medium hidden lg:table-cell w-48">Hours</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border-subtle)]">
              {shown.map((c) => {
                const renewal = c.renewalDate ?? c.endDate;
                const renewIn = daysUntil(renewal);
                const b = burn[c._id];
                const used = b?.hoursUsed ?? c.hoursUsed ?? 0;
                const pct = b?.percentUsed ?? (c.hoursIncluded ? Math.round((used / c.hoursIncluded) * 100) : 0);
                return (
                  <tr key={c._id} className="hover:bg-[color:var(--bg-elevated)]/60 align-top">
                    <td className="py-3 px-4">
                      <p className="font-medium">{c.title}</p>
                      <p className="text-[11px] text-[color:var(--text-muted)]">
                        {refId(c.customerOrgId) ? (
                          <Link to={`/admin/customer-orgs/${refId(c.customerOrgId)}`} className="hover:underline">
                            {orgName(c)}
                          </Link>
                        ) : (
                          orgName(c)
                        )}
                        {' · '}
                        {KIND_LABEL[(c.kind ?? 'other') as Kind]}
                        {c.billingCycle ? ` · ${prettyLabel(c.billingCycle)}` : ''}
                        {c.kind === 'hourly' && c.hourlyRate != null ? ` · ${money(c.hourlyRate, c.currency)}/h` : ''}
                      </p>
                    </td>
                    <td className="py-3 px-3">
                      <Chip tone={STATUS_TONE[c.status] ?? 'neutral'}>{prettyLabel(c.status)}</Chip>
                    </td>
                    <td className="py-3 px-3 text-right tabular-nums font-medium">{money(c.value, c.currency)}</td>
                    <td className="py-3 px-3 text-xs hidden md:table-cell">
                      <span className="text-[color:var(--text-muted)]">
                        {fmtDate(c.startDate)} → {c.endDate ? fmtDate(c.endDate) : 'open-ended'}
                      </span>
                      {c.status === 'active' && renewIn != null && renewIn >= 0 && (
                        <span className={`block ${renewIn <= 30 ? 'text-amber-400' : 'text-[color:var(--text-muted)]'}`}>
                          {c.autoRenew ? 'Auto-renews' : 'Renewal'} in {renewIn}d
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3 hidden lg:table-cell">
                      {c.hoursIncluded ? (
                        <button type="button" className="w-full text-left" onClick={() => void showBurn(c._id)} title="Refresh burn-down from logged time">
                          <div className="flex justify-between text-[11px] mb-1">
                            <span className="tabular-nums">
                              {used.toFixed(1)} / {c.hoursIncluded}h
                            </span>
                            <span className={pct >= 90 ? 'text-red-400' : pct >= 75 ? 'text-amber-400' : 'text-[color:var(--text-muted)]'}>{pct}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-[color:var(--bg-elevated)] overflow-hidden">
                            <div className={`h-full rounded-full ${pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-[color:var(--accent)]'}`} style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                        </button>
                      ) : (
                        <span className="text-xs text-[color:var(--text-muted)]">—</span>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-right">
                      <RowMenu
                        onEdit={canUpdate ? () => setModal({ editing: c }) : undefined}
                        onDelete={canDelete ? () => setDeleting(c) : undefined}
                        extra={
                          canUpdate && c.status === 'draft'
                            ? [{ label: 'Activate', icon: <FiCheckCircle />, onClick: () => void run(() => crmApi.updateContract(c._id, { status: 'active' }, token!), 'Could not activate.') }]
                            : []
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <ContractModal
          editing={modal.editing}
          orgs={orgs}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
      <ConfirmModal
        open={!!deleting}
        title="Delete contract?"
        message={`“${deleting?.title ?? ''}” will be removed. Invoices already raised are not affected.`}
        confirmLabel="Delete contract"
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target) void run(() => crmApi.deleteContract(target._id, token!), 'Could not delete the contract.');
        }}
        onCancel={() => setDeleting(null)}
      />
    </CrmShell>
  );
}

function ContractModal({ editing, orgs, onClose, onSaved }: { editing: CrmContract | null; orgs: Array<{ _id: string; name: string }>; onClose: () => void; onSaved: () => void }) {
  const { token } = useAuth();
  const [form, setForm] = useState<Form>(() => formFrom(editing, orgs[0]?._id ?? ''));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const hourly = form.kind === 'hourly';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !form.customerOrgId || !form.title.trim()) return;
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {
      customerOrgId: form.customerOrgId,
      title: form.title.trim(),
      kind: form.kind,
      value: Number(form.value) || 0,
      currency: form.currency.trim().toUpperCase() || 'USD',
      billingCycle: form.billingCycle,
      startDate: form.startDate,
      endDate: form.endDate || null,
      renewalDate: form.renewalDate || form.endDate || null,
      autoRenew: form.autoRenew,
      status: form.status,
      hoursIncluded: !hourly && form.hoursIncluded ? Number(form.hoursIncluded) : undefined,
    };
    if (hourly) {
      payload.hourlyRate = Number(form.hourlyRate);
      payload.supportPeriod = form.supportPeriod;
      if (form.supportPeriod !== 'lifelong_with_payment') payload.supportDurationMonths = Number(form.supportDurationMonths) || undefined;
      payload.prodReleaseDate = form.supportPeriod === 'from_prod_release' ? form.prodReleaseDate || null : null;
    }
    const res = editing
      ? await crmApi.updateContract(editing._id, payload as Partial<CrmContract>, token)
      : await crmApi.createContract(payload as Parameters<typeof crmApi.createContract>[0], token);
    setSaving(false);
    if (!res.success) return setError(errorOf(res, 'Could not save the contract.'));
    onSaved();
  }

  return (
    <Modal open title={editing ? 'Edit contract' : 'New contract'} onClose={onClose} width="max-w-2xl">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer">
            <select required value={form.customerOrgId} onChange={(e) => set({ customerOrgId: e.target.value })} className={inputCls}>
              {orgs.map((o) => (
                <option key={o._id} value={o._id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title">
            <input required autoFocus value={form.title} onChange={(e) => set({ title: e.target.value })} className={inputCls} />
          </Field>
        </div>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          <Field label="Kind">
            <select value={form.kind} onChange={(e) => set({ kind: e.target.value as Kind })} className={inputCls}>
              {Object.entries(KIND_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => set({ status: e.target.value })} className={inputCls}>
              {['draft', 'active', 'expired', 'cancelled'].map((s) => (
                <option key={s} value={s}>
                  {prettyLabel(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Billing">
            <select value={form.billingCycle} onChange={(e) => set({ billingCycle: e.target.value })} className={inputCls}>
              {['monthly', 'quarterly', 'annual', 'one_time'].map((s) => (
                <option key={s} value={s}>
                  {prettyLabel(s)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Currency">
            <input value={form.currency} maxLength={3} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} className={`${inputCls} uppercase`} />
          </Field>
        </div>
        <div className="grid gap-3 grid-cols-2">
          <Field label="Value">
            <input type="number" min={0} step="any" value={form.value} onChange={(e) => set({ value: e.target.value })} className={inputCls} />
          </Field>
          {hourly ? (
            <Field label="Hourly rate">
              <input type="number" min={0.01} step="0.01" required value={form.hourlyRate} onChange={(e) => set({ hourlyRate: e.target.value })} className={inputCls} />
            </Field>
          ) : (
            <Field label="Hours included">
              <input type="number" min={0} value={form.hoursIncluded} onChange={(e) => set({ hoursIncluded: e.target.value })} className={inputCls} />
            </Field>
          )}
        </div>
        {hourly && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Support period" className="sm:col-span-1">
              <select value={form.supportPeriod} onChange={(e) => set({ supportPeriod: e.target.value as CrmContractSupportPeriod })} className={inputCls}>
                <option value="lifelong_with_payment">Lifelong with payment</option>
                <option value="from_prod_release">N months from prod release</option>
                <option value="from_last_invoice">N months from last invoice</option>
              </select>
            </Field>
            {form.supportPeriod !== 'lifelong_with_payment' && (
              <Field label="Months">
                <input type="number" min={1} required value={form.supportDurationMonths} onChange={(e) => set({ supportDurationMonths: e.target.value })} className={inputCls} />
              </Field>
            )}
            {form.supportPeriod === 'from_prod_release' && (
              <Field label="Prod release">
                <input type="date" required value={form.prodReleaseDate} onChange={(e) => set({ prodReleaseDate: e.target.value })} className={inputCls} />
              </Field>
            )}
          </div>
        )}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
          <Field label="Start">
            <input type="date" required value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} className={inputCls} />
          </Field>
          <Field label="End">
            <input type="date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Renewal" hint="Defaults to the end date.">
            <input type="date" value={form.renewalDate} onChange={(e) => set({ renewalDate: e.target.value })} className={inputCls} />
          </Field>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.autoRenew} onChange={(e) => set({ autoRenew: e.target.checked })} />
          Renews automatically
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={btnSecondary}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create contract'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
