import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import {
  contractsApi,
  crmApi,
  type CrmAccount,
  type CrmContract,
  type SlaPolicy,
} from '../../lib/api';

function accountLabel(accountId: CrmContract['accountId']): string {
  if (accountId && typeof accountId === 'object') return accountId.name;
  return String(accountId ?? '—');
}

function accountIdOf(c: CrmContract): string {
  if (c.accountId && typeof c.accountId === 'object') return c.accountId._id;
  return String(c.accountId ?? '');
}

const money = (n: number, currency = 'USD') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0);

type ContractFormState = {
  accountId: string;
  title: string;
  kind: 'msa' | 'retainer' | 'amc' | 'other';
  value: number;
  currency: string;
  billingCycle: string;
  startDate: string;
  endDate: string;
  renewalDate: string;
  autoRenew: boolean;
  hoursIncluded: number;
  status: string;
  notes: string;
  slaPolicyId: string;
};

const emptyForm = (kind: ContractFormState['kind']): ContractFormState => ({
  accountId: '',
  title: '',
  kind,
  value: 0,
  currency: 'USD',
  billingCycle: kind === 'msa' ? 'annual' : 'monthly',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
  renewalDate: '',
  autoRenew: false,
  hoursIncluded: kind === 'retainer' || kind === 'amc' ? 40 : 0,
  status: 'active',
  notes: '',
  slaPolicyId: '',
});

function useAccounts(token: string | null) {
  const [accounts, setAccounts] = useState<CrmAccount[]>([]);
  useEffect(() => {
    if (!token) return;
    crmApi.listAccounts(token).then((res) => {
      if (!res.success || !res.data) return;
      const raw = res.data as CrmAccount[] | { data: CrmAccount[] };
      setAccounts(Array.isArray(raw) ? raw : raw.data ?? []);
    });
  }, [token]);
  return accounts;
}

function ContractModal({
  open,
  title,
  form,
  setForm,
  accounts,
  slaPolicies,
  showHours,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  form: ContractFormState;
  setForm: (fn: (f: ContractFormState) => ContractFormState) => void;
  accounts: CrmAccount[];
  slaPolicies: SlaPolicy[];
  showHours?: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-lg rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 space-y-3 shadow-xl"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <label className="block text-xs text-[color:var(--text-muted)]">
          Account
          <select
            className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
            value={form.accountId}
            onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
            required
          >
            <option value="">Select account</option>
            {accounts.map((a) => (
              <option key={a._id} value={a._id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-[color:var(--text-muted)]">
          Title
          <input
            className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-[color:var(--text-muted)]">
            Kind
            <select
              className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as ContractFormState['kind'] }))}
            >
              <option value="msa">MSA</option>
              <option value="retainer">Retainer</option>
              <option value="amc">AMC</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="block text-xs text-[color:var(--text-muted)]">
            Status
            <select
              className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-[color:var(--text-muted)]">
            Value
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: Number(e.target.value) }))}
            />
          </label>
          <label className="block text-xs text-[color:var(--text-muted)]">
            Billing cycle
            <select
              className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
              value={form.billingCycle}
              onChange={(e) => setForm((f) => ({ ...f, billingCycle: e.target.value }))}
            >
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
              <option value="one_time">One-time</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-[color:var(--text-muted)]">
            Start
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
              required
            />
          </label>
          <label className="block text-xs text-[color:var(--text-muted)]">
            End
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
              value={form.endDate}
              onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-[color:var(--text-muted)]">
            Renewal date
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
              value={form.renewalDate}
              onChange={(e) => setForm((f) => ({ ...f, renewalDate: e.target.value }))}
            />
          </label>
          <label className="flex items-center gap-2 text-sm mt-6">
            <input
              type="checkbox"
              checked={form.autoRenew}
              onChange={(e) => setForm((f) => ({ ...f, autoRenew: e.target.checked }))}
            />
            Auto-renew
          </label>
        </div>
        {showHours && (
          <label className="block text-xs text-[color:var(--text-muted)]">
            Hours included
            <input
              type="number"
              className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
              value={form.hoursIncluded}
              onChange={(e) => setForm((f) => ({ ...f, hoursIncluded: Number(e.target.value) }))}
            />
          </label>
        )}
        <label className="block text-xs text-[color:var(--text-muted)]">
          Linked SLA
          <select
            className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
            value={form.slaPolicyId}
            onChange={(e) => setForm((f) => ({ ...f, slaPolicyId: e.target.value }))}
          >
            <option value="">None</option>
            {slaPolicies.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
                {!p.enabled ? ' (disabled)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-[color:var(--text-muted)]">
          Notes
          <textarea
            className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="px-3 py-2 text-sm rounded-lg border border-[color:var(--border-subtle)]" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function ContractsListPage({
  title,
  subtitle,
  kinds,
  defaultKind,
  showHours,
  managePerms,
}: {
  title: string;
  subtitle: string;
  kinds?: Array<'msa' | 'retainer' | 'amc' | 'other'>;
  defaultKind: ContractFormState['kind'];
  showHours?: boolean;
  managePerms: string[];
}) {
  const { token, user } = useAuth();
  const canManage = canAny(user, ...managePerms, 'taskflow.crm.contract.create', 'taskflow.crm.contract.update');
  const canDelete = canAny(user, ...managePerms, 'taskflow.crm.contract.delete');
  const accounts = useAccounts(token);
  const [rows, setRows] = useState<CrmContract[]>([]);
  const [slaPolicies, setSlaPolicies] = useState<SlaPolicy[]>([]);
  const [modal, setModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ContractFormState>(() => emptyForm(defaultKind));
  const [burn, setBurn] = useState<{ id: string; percentUsed: number; hoursUsed: number; hoursRemaining: number } | null>(
    null
  );

  const load = () => {
    if (!token) return;
    const loads =
      kinds && kinds.length > 1
        ? Promise.all(kinds.map((kind) => contractsApi.list(token, { kind }))).then((results) => {
            const map = new Map<string, CrmContract>();
            for (const res of results) {
              if (res.success && res.data) {
                for (const row of res.data as CrmContract[]) map.set(row._id, row);
              }
            }
            return [...map.values()];
          })
        : contractsApi.list(token, kinds?.[0] ? { kind: kinds[0] } : undefined).then((res) =>
            res.success && res.data ? (res.data as CrmContract[]) : []
          );

    loads.then(setRows);
    contractsApi.listSla(token).then((res) => {
      if (res.success && res.data) setSlaPolicies(res.data as SlaPolicy[]);
    });
  };

  useEffect(() => {
    load();
  }, [token]);

  function openCreate() {
    setEditingId(null);
    setForm({
      ...emptyForm(defaultKind),
      accountId: accounts[0]?._id ?? '',
    });
    setModal(true);
  }

  function openEdit(c: CrmContract) {
    setEditingId(c._id);
    setForm({
      accountId: accountIdOf(c),
      title: c.title,
      kind: (c.kind as ContractFormState['kind']) ?? defaultKind,
      value: c.value ?? 0,
      currency: c.currency ?? 'USD',
      billingCycle: c.billingCycle ?? 'monthly',
      startDate: c.startDate ? c.startDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
      endDate: c.endDate ? c.endDate.slice(0, 10) : '',
      renewalDate: c.renewalDate ? c.renewalDate.slice(0, 10) : '',
      autoRenew: Boolean(c.autoRenew),
      hoursIncluded: c.hoursIncluded ?? 0,
      status: c.status ?? 'active',
      notes: c.notes ?? '',
      slaPolicyId: typeof c.slaPolicyId === 'object' && c.slaPolicyId ? c.slaPolicyId._id : String(c.slaPolicyId ?? ''),
    });
    setModal(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!token || !form.accountId || !form.title.trim()) return;
    const payload = {
      accountId: form.accountId,
      title: form.title.trim(),
      kind: form.kind,
      value: Number(form.value) || 0,
      currency: form.currency,
      billingCycle: form.billingCycle,
      startDate: form.startDate,
      endDate: form.endDate || undefined,
      renewalDate: form.renewalDate || form.endDate || undefined,
      autoRenew: form.autoRenew,
      hoursIncluded: showHours ? form.hoursIncluded || undefined : undefined,
      status: form.status,
      notes: form.notes.trim() || undefined,
      slaPolicyId: form.slaPolicyId || undefined,
    };
    if (editingId) await contractsApi.update(editingId, payload, token);
    else await contractsApi.create(payload as typeof payload & { startDate: string; accountId: string }, token);
    setModal(false);
    load();
  }

  async function remove(id: string) {
    if (!token || !canDelete) return;
    if (!confirm('Delete this contract?')) return;
    await contractsApi.remove(id, token);
    load();
  }

  async function showBurn(id: string) {
    if (!token) return;
    const res = await contractsApi.burnDown(id, token);
    if (res.success && res.data) {
      const d = res.data as { percentUsed: number; hoursUsed: number; hoursRemaining: number };
      setBurn({ id, ...d });
    }
  }

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/contracts" className="text-xs text-[color:var(--accent)] hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-semibold mt-1">{title}</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">{subtitle}</p>
        </div>
        {canManage && (
          <button
            type="button"
            className="btn-primary px-4 py-2 rounded-lg text-sm"
            disabled={accounts.length === 0}
            onClick={openCreate}
            title={accounts.length === 0 ? 'Create a CRM account first' : undefined}
          >
            Add agreement
          </button>
        )}
      </div>

      {accounts.length === 0 && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          No CRM accounts yet. <Link to="/crm/accounts" className="underline">Create an account</Link> before adding contracts.
        </p>
      )}

      <div className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--bg-elevated)] text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Title</th>
              <th className="text-left px-4 py-3 font-medium">Account</th>
              <th className="text-left px-4 py-3 font-medium">Kind</th>
              <th className="text-right px-4 py-3 font-medium">Value</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-left px-4 py-3 font-medium">Renewal</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c._id} className="border-t border-[color:var(--border-subtle)]">
                <td className="px-4 py-3 font-medium">{c.title}</td>
                <td className="px-4 py-3 text-[color:var(--text-muted)]">{accountLabel(c.accountId)}</td>
                <td className="px-4 py-3 uppercase text-[11px]">{c.kind ?? 'other'}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(c.value, c.currency)}</td>
                <td className="px-4 py-3 capitalize">{c.status}</td>
                <td className="px-4 py-3 text-[color:var(--text-muted)]">
                  {c.renewalDate ? new Date(c.renewalDate).toLocaleDateString() : '—'}
                  {c.autoRenew ? ' · auto' : ''}
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  {showHours && (
                    <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => showBurn(c._id)}>
                      Burn-down
                    </button>
                  )}
                  {canManage && (
                    <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => openEdit(c)}>
                      Edit
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => remove(c._id)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-[color:var(--text-muted)]">
                  No agreements in this view yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {burn && (
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 text-sm flex justify-between gap-4">
          <span>
            Burn-down: <strong>{burn.hoursUsed}h</strong> used, <strong>{burn.hoursRemaining}h</strong> remaining (
            {burn.percentUsed}%)
          </span>
          <button type="button" className="text-xs text-[color:var(--text-muted)]" onClick={() => setBurn(null)}>
            Dismiss
          </button>
        </div>
      )}

      <ContractModal
        open={modal}
        title={editingId ? 'Edit agreement' : 'New agreement'}
        form={form}
        setForm={setForm}
        accounts={accounts}
        slaPolicies={slaPolicies}
        showHours={showHours}
        onClose={() => setModal(false)}
        onSubmit={save}
      />
    </div>
  );
}

export function ContractsMsas() {
  return (
    <ContractsListPage
      title="MSAs"
      subtitle="Master service agreements and commercial frameworks by customer."
      kinds={['msa']}
      defaultKind="msa"
      managePerms={['taskflow.contracts.msa.manage']}
    />
  );
}

export function ContractsRetainers() {
  return (
    <ContractsListPage
      title="Retainers & AMC"
      subtitle="Hour blocks, managed services, and utilization burn-down."
      kinds={['retainer', 'amc']}
      defaultKind="retainer"
      showHours
      managePerms={['taskflow.contracts.retainer.manage']}
    />
  );
}

export function ContractsRenewals() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.contracts.renewal.manage', 'taskflow.crm.contract.update');
  const [rows, setRows] = useState<CrmContract[]>([]);
  const [days, setDays] = useState(90);

  const load = () => {
    if (!token) return;
    contractsApi.list(token, { status: 'active', renewingWithinDays: days }).then((res) => {
      if (res.success && res.data) setRows(res.data as CrmContract[]);
    });
  };

  useEffect(() => {
    load();
  }, [token, days]);

  async function markRenewed(c: CrmContract) {
    if (!token || !canManage) return;
    const base = c.renewalDate ? new Date(c.renewalDate) : new Date();
    const next = new Date(base);
    next.setFullYear(next.getFullYear() + 1);
    await contractsApi.update(
      c._id,
      {
        renewalDate: next.toISOString().slice(0, 10),
        endDate: next.toISOString().slice(0, 10),
        status: 'active',
      },
      token
    );
    load();
  }

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/contracts" className="text-xs text-[color:var(--accent)] hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-semibold mt-1">Renewals</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">
            Active contracts with renewal dates in the selected window.
          </p>
        </div>
        <select
          className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={30}>Next 30 days</option>
          <option value={60}>Next 60 days</option>
          <option value={90}>Next 90 days</option>
          <option value={180}>Next 180 days</option>
        </select>
      </div>

      <div className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--bg-elevated)] text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Title</th>
              <th className="text-left px-4 py-3 font-medium">Account</th>
              <th className="text-left px-4 py-3 font-medium">Kind</th>
              <th className="text-right px-4 py-3 font-medium">Value</th>
              <th className="text-left px-4 py-3 font-medium">Renewal</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const daysLeft = c.renewalDate
                ? Math.ceil((new Date(c.renewalDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
                : null;
              return (
                <tr key={c._id} className="border-t border-[color:var(--border-subtle)]">
                  <td className="px-4 py-3 font-medium">{c.title}</td>
                  <td className="px-4 py-3 text-[color:var(--text-muted)]">{accountLabel(c.accountId)}</td>
                  <td className="px-4 py-3 uppercase text-[11px]">{c.kind ?? 'other'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(c.value, c.currency)}</td>
                  <td className="px-4 py-3">
                    {c.renewalDate ? new Date(c.renewalDate).toLocaleDateString() : '—'}
                    {daysLeft != null && (
                      <span
                        className={`ml-2 text-[11px] ${
                          daysLeft <= 30 ? 'text-amber-600 dark:text-amber-400' : 'text-[color:var(--text-muted)]'
                        }`}
                      >
                        ({daysLeft}d)
                      </span>
                    )}
                    {c.autoRenew ? <span className="ml-1 text-[11px] text-[color:var(--text-muted)]">auto</span> : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canManage && (
                      <button
                        type="button"
                        className="text-xs text-[color:var(--accent)] hover:underline"
                        onClick={() => markRenewed(c)}
                      >
                        Roll +1 year
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-[color:var(--text-muted)]">
                  No renewals in this window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ContractsSlas() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.contracts.sla.manage', 'taskflow.crm.contract.update');
  const [policies, setPolicies] = useState<SlaPolicy[]>([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({
    name: '',
    firstResponseMinutes: 60,
    resolutionMinutes: 480,
    priority: 'normal',
  });

  const load = () => {
    if (!token) return;
    contractsApi.listSla(token).then((res) => {
      if (res.success && res.data) setPolicies(res.data as SlaPolicy[]);
    });
  };

  useEffect(() => {
    load();
  }, [token]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!token || !form.name.trim()) return;
    await contractsApi.createSla(
      {
        name: form.name.trim(),
        enabled: true,
        targets: [
          {
            priority: form.priority,
            firstResponseMinutes: form.firstResponseMinutes,
            resolutionMinutes: form.resolutionMinutes,
          },
        ],
      },
      token
    );
    setModal(false);
    setForm({ name: '', firstResponseMinutes: 60, resolutionMinutes: 480, priority: 'normal' });
    load();
  }

  async function toggle(p: SlaPolicy) {
    if (!token || !canManage) return;
    await contractsApi.updateSla(p._id, { enabled: !p.enabled }, token);
    load();
  }

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/contracts" className="text-xs text-[color:var(--accent)] hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-semibold mt-1">SLAs</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">
            Service level targets used by contracts and the Service Desk.
          </p>
        </div>
        {canManage && (
          <button type="button" className="btn-primary px-4 py-2 rounded-lg text-sm" onClick={() => setModal(true)}>
            Add SLA policy
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {policies.map((p) => (
          <div key={p._id} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-medium">{p.name}</h2>
                <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">{p.enabled ? 'Enabled' : 'Disabled'}</p>
              </div>
              {canManage && (
                <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => toggle(p)}>
                  {p.enabled ? 'Disable' : 'Enable'}
                </button>
              )}
            </div>
            <ul className="mt-3 space-y-1 text-sm text-[color:var(--text-muted)]">
              {(p.targets ?? []).map((t, i) => (
                <li key={i}>
                  <span className="capitalize text-[color:var(--text-primary)]">{t.priority}</span>
                  {' — '}
                  first response {t.firstResponseMinutes}m · resolve {t.resolutionMinutes}m
                </li>
              ))}
              {(p.targets ?? []).length === 0 && <li>No targets configured.</li>}
            </ul>
          </div>
        ))}
        {policies.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-[color:var(--border-subtle)] p-10 text-center text-sm text-[color:var(--text-muted)]">
            No SLA policies yet.
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={create}
            className="w-full max-w-md rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 space-y-3"
          >
            <h2 className="text-lg font-semibold">New SLA policy</h2>
            <label className="block text-xs text-[color:var(--text-muted)]">
              Name
              <input
                className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </label>
            <label className="block text-xs text-[color:var(--text-muted)]">
              Priority
              <select
                className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                value={form.priority}
                onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-[color:var(--text-muted)]">
                First response (min)
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  value={form.firstResponseMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, firstResponseMinutes: Number(e.target.value) }))}
                />
              </label>
              <label className="block text-xs text-[color:var(--text-muted)]">
                Resolution (min)
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  value={form.resolutionMinutes}
                  onChange={(e) => setForm((f) => ({ ...f, resolutionMinutes: Number(e.target.value) }))}
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="px-3 py-2 text-sm rounded-lg border border-[color:var(--border-subtle)]" onClick={() => setModal(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">
                Create
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
