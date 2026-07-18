import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { ExportButton } from '../../components/moduleKit';
import {
  billingApi,
  crmApi,
  type BillingInvoice,
  type BillingSubscription,
  type BillingTaxRule,
  type CrmAccount,
} from '../../lib/api';

const money = (n: number, currency = 'USD') =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n || 0);

function accountLabel(accountId: BillingSubscription['accountId'] | BillingInvoice['accountId']): string {
  if (accountId && typeof accountId === 'object') return accountId.name;
  return String(accountId ?? '—');
}

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

export function BillingSubscriptions() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.billing.subscription.manage');
  const accounts = useAccounts(token);
  const [rows, setRows] = useState<BillingSubscription[]>([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({
    accountId: '',
    name: '',
    planCode: '',
    status: 'active',
    billingCycle: 'monthly',
    seats: 1,
    unitPrice: 0,
    amount: 0,
    startDate: new Date().toISOString().slice(0, 10),
    nextBillingDate: new Date().toISOString().slice(0, 10),
    autoRenew: true,
    notes: '',
  });

  const load = () => {
    if (!token) return;
    billingApi.listSubscriptions(token).then((res) => {
      if (res.success && res.data) setRows(res.data as BillingSubscription[]);
    });
  };

  useEffect(() => {
    load();
  }, [token]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!token || !form.accountId || !form.name.trim()) return;
    const seats = Number(form.seats) || 1;
    const unitPrice = Number(form.unitPrice) || 0;
    await billingApi.createSubscription(
      {
        ...form,
        seats,
        unitPrice,
        amount: form.amount || seats * unitPrice,
        name: form.name.trim(),
      },
      token
    );
    setModal(false);
    load();
  }

  async function setStatus(id: string, status: string) {
    if (!token || !canManage) return;
    await billingApi.updateSubscription(id, { status }, token);
    load();
  }

  async function invoiceNow(id: string) {
    if (!token || !canManage) return;
    await billingApi.invoiceSubscription(id, token);
    load();
  }

  async function remove(id: string) {
    if (!token || !canManage) return;
    if (!confirm('Delete this subscription?')) return;
    await billingApi.deleteSubscription(id, token);
    load();
  }

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/billing" className="text-xs text-[color:var(--accent)] hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-semibold mt-1">Subscriptions</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">Recurring plans, seats, and billing cycles.</p>
        </div>
        {canManage && (
          <button
            type="button"
            className="btn-primary px-4 py-2 rounded-lg text-sm"
            disabled={accounts.length === 0}
            onClick={() => {
              setForm((f) => ({ ...f, accountId: accounts[0]?._id ?? '', name: '' }));
              setModal(true);
            }}
          >
            Add subscription
          </button>
        )}
      </div>

      <div className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--bg-elevated)] text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Account</th>
              <th className="text-left px-4 py-3 font-medium">Cycle</th>
              <th className="text-right px-4 py-3 font-medium">Amount</th>
              <th className="text-left px-4 py-3 font-medium">Next bill</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s._id} className="border-t border-[color:var(--border-subtle)]">
                <td className="px-4 py-3">
                  <p className="font-medium">{s.name}</p>
                  <p className="text-[11px] text-[color:var(--text-muted)]">
                    {s.planCode ? `${s.planCode} · ` : ''}
                    {s.seats} seat{s.seats === 1 ? '' : 's'}
                  </p>
                </td>
                <td className="px-4 py-3 text-[color:var(--text-muted)]">{accountLabel(s.accountId)}</td>
                <td className="px-4 py-3 capitalize">{s.billingCycle}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(s.amount, s.currency)}</td>
                <td className="px-4 py-3 text-[color:var(--text-muted)]">
                  {s.nextBillingDate ? new Date(s.nextBillingDate).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3 capitalize">{s.status}</td>
                <td className="px-4 py-3 text-right space-x-2">
                  {canManage && s.status === 'active' && (
                    <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => invoiceNow(s._id)}>
                      Invoice
                    </button>
                  )}
                  {canManage && s.status === 'active' && (
                    <button type="button" className="text-xs text-amber-600 dark:text-amber-400 hover:underline" onClick={() => setStatus(s._id, 'paused')}>
                      Pause
                    </button>
                  )}
                  {canManage && s.status === 'paused' && (
                    <button type="button" className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline" onClick={() => setStatus(s._id, 'active')}>
                      Resume
                    </button>
                  )}
                  {canManage && (
                    <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => remove(s._id)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-[color:var(--text-muted)]">
                  No subscriptions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={create} className="w-full max-w-lg rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 space-y-3">
            <h2 className="text-lg font-semibold">New subscription</h2>
            <label className="block text-xs text-[color:var(--text-muted)]">
              Account
              <select
                className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                value={form.accountId}
                onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                required
              >
                {accounts.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-[color:var(--text-muted)]">
              Name
              <input
                className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-[color:var(--text-muted)]">
                Plan code
                <input
                  className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  value={form.planCode}
                  onChange={(e) => setForm((f) => ({ ...f, planCode: e.target.value }))}
                />
              </label>
              <label className="block text-xs text-[color:var(--text-muted)]">
                Cycle
                <select
                  className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  value={form.billingCycle}
                  onChange={(e) => setForm((f) => ({ ...f, billingCycle: e.target.value }))}
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-[color:var(--text-muted)]">
                Seats
                <input
                  type="number"
                  min={1}
                  className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  value={form.seats}
                  onChange={(e) => setForm((f) => ({ ...f, seats: Number(e.target.value) }))}
                />
              </label>
              <label className="block text-xs text-[color:var(--text-muted)]">
                Unit price
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  value={form.unitPrice}
                  onChange={(e) => setForm((f) => ({ ...f, unitPrice: Number(e.target.value) }))}
                />
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
                Next billing
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  value={form.nextBillingDate}
                  onChange={(e) => setForm((f) => ({ ...f, nextBillingDate: e.target.value }))}
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

export function BillingInvoices() {
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.billing.invoice.create', 'taskflow.billing.invoice.manage');
  const canManage = canAny(user, 'taskflow.billing.invoice.manage');
  const accounts = useAccounts(token);
  const [rows, setRows] = useState<BillingInvoice[]>([]);
  const [taxRules, setTaxRules] = useState<BillingTaxRule[]>([]);
  const [filter, setFilter] = useState('');
  const [modal, setModal] = useState(false);
  const [payFor, setPayFor] = useState<BillingInvoice | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [form, setForm] = useState({
    accountId: '',
    description: 'Professional services',
    quantity: 1,
    unitPrice: 0,
    taxRate: 0,
    dueDate: '',
    notes: '',
  });

  const load = () => {
    if (!token) return;
    billingApi.listInvoices(token, filter ? { status: filter } : undefined).then((res) => {
      if (res.success && res.data) setRows(res.data as BillingInvoice[]);
    });
  };

  useEffect(() => {
    load();
  }, [token, filter]);

  useEffect(() => {
    if (!token) return;
    billingApi.listTax(token).then((res) => {
      if (res.success && res.data) {
        const rules = res.data as BillingTaxRule[];
        setTaxRules(rules);
        const def = rules.find((r) => r.enabled);
        if (def) setForm((f) => ({ ...f, taxRate: def.rate }));
      }
    });
  }, [token]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!token || !form.accountId) return;
    await billingApi.createInvoice(
      {
        accountId: form.accountId,
        dueDate: form.dueDate || undefined,
        notes: form.notes.trim() || undefined,
        taxCode: taxRules.find((t) => t.rate === form.taxRate && t.enabled)?.code,
        lines: [
          {
            description: form.description.trim() || 'Line item',
            quantity: Number(form.quantity) || 1,
            unitPrice: Number(form.unitPrice) || 0,
            taxRate: Number(form.taxRate) || 0,
            sourceType: 'manual',
          },
        ],
      },
      token
    );
    setModal(false);
    load();
  }

  async function setStatus(id: string, status: string) {
    if (!token || !canManage) return;
    const patch: Record<string, unknown> = { status };
    if (status === 'paid') patch.amountPaid = rows.find((r) => r._id === id)?.total ?? 0;
    await billingApi.updateInvoice(id, patch, token);
    load();
  }

  function openPayment(inv: BillingInvoice) {
    setPayFor(inv);
    setPayAmount(Math.round((inv.total - (inv.amountPaid ?? 0)) * 100) / 100);
  }

  async function recordPayment(e: FormEvent) {
    e.preventDefault();
    if (!token || !payFor) return;
    const balance = payFor.total - (payFor.amountPaid ?? 0);
    await billingApi.recordPayment(
      payFor._id,
      { amount: payAmount, markPaid: payAmount >= balance },
      token
    );
    setPayFor(null);
    load();
  }

  async function remove(id: string) {
    if (!token || !canManage) return;
    if (!confirm('Delete this invoice?')) return;
    await billingApi.deleteInvoice(id, token);
    load();
  }

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/billing" className="text-xs text-[color:var(--accent)] hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-semibold mt-1">Invoices</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">Draft, send, and track customer invoices.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
            <option value="void">Void</option>
          </select>
          <ExportButton
            rows={rows}
            filename="invoices"
            columns={[
              { header: 'Number', value: (r) => r.number },
              { header: 'Account', value: (r) => accountLabel(r.accountId) },
              { header: 'Status', value: (r) => r.status },
              { header: 'Issued', value: (r) => new Date(r.issueDate).toLocaleDateString() },
              { header: 'Due', value: (r) => (r.dueDate ? new Date(r.dueDate).toLocaleDateString() : '') },
              { header: 'Currency', value: (r) => r.currency },
              { header: 'Subtotal', value: (r) => r.subtotal },
              { header: 'Tax', value: (r) => r.taxTotal },
              { header: 'Total', value: (r) => r.total },
              { header: 'Paid', value: (r) => r.amountPaid ?? 0 },
              { header: 'Balance', value: (r) => Math.round((r.total - (r.amountPaid ?? 0)) * 100) / 100 },
            ]}
          />
          {canCreate && (
            <button
              type="button"
              className="btn-primary px-4 py-2 rounded-lg text-sm"
              disabled={accounts.length === 0}
              onClick={() => {
                setForm((f) => ({ ...f, accountId: accounts[0]?._id ?? '' }));
                setModal(true);
              }}
            >
              New invoice
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--bg-elevated)] text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Number</th>
              <th className="text-left px-4 py-3 font-medium">Account</th>
              <th className="text-left px-4 py-3 font-medium">Issued</th>
              <th className="text-left px-4 py-3 font-medium">Due</th>
              <th className="text-right px-4 py-3 font-medium">Total</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((inv) => (
              <tr key={inv._id} className="border-t border-[color:var(--border-subtle)]">
                <td className="px-4 py-3 font-medium">{inv.number}</td>
                <td className="px-4 py-3 text-[color:var(--text-muted)]">{accountLabel(inv.accountId)}</td>
                <td className="px-4 py-3">{new Date(inv.issueDate).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-[color:var(--text-muted)]">
                  {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {money(inv.total, inv.currency)}
                  {inv.taxTotal > 0 && (
                    <span className="block text-[11px] text-[color:var(--text-muted)]">tax {money(inv.taxTotal, inv.currency)}</span>
                  )}
                  {(inv.amountPaid ?? 0) > 0 && inv.status !== 'paid' && (
                    <span className="block text-[11px] text-emerald-600 dark:text-emerald-400">
                      paid {money(inv.amountPaid, inv.currency)} · bal {money(inv.total - (inv.amountPaid ?? 0), inv.currency)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 capitalize">{inv.status}</td>
                <td className="px-4 py-3 text-right space-x-2">
                  {canManage && inv.status === 'draft' && (
                    <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => setStatus(inv._id, 'sent')}>
                      Send
                    </button>
                  )}
                  {canManage && inv.status !== 'paid' && inv.status !== 'void' && (
                    <button type="button" className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline" onClick={() => openPayment(inv)}>
                      Record payment
                    </button>
                  )}
                  {canManage && inv.status !== 'paid' && (
                    <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => remove(inv._id)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-[color:var(--text-muted)]">
                  No invoices yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={create} className="w-full max-w-lg rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 space-y-3">
            <h2 className="text-lg font-semibold">New invoice</h2>
            <label className="block text-xs text-[color:var(--text-muted)]">
              Account
              <select
                className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                value={form.accountId}
                onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                required
              >
                {accounts.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-[color:var(--text-muted)]">
              Description
              <input
                className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                required
              />
            </label>
            <div className="grid grid-cols-3 gap-3">
              <label className="block text-xs text-[color:var(--text-muted)]">
                Qty
                <input
                  type="number"
                  min={0}
                  step="0.1"
                  className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
                />
              </label>
              <label className="block text-xs text-[color:var(--text-muted)]">
                Unit price
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  value={form.unitPrice}
                  onChange={(e) => setForm((f) => ({ ...f, unitPrice: Number(e.target.value) }))}
                />
              </label>
              <label className="block text-xs text-[color:var(--text-muted)]">
                Tax %
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  value={form.taxRate}
                  onChange={(e) => setForm((f) => ({ ...f, taxRate: Number(e.target.value) }))}
                />
              </label>
            </div>
            <label className="block text-xs text-[color:var(--text-muted)]">
              Due date
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="px-3 py-2 text-sm rounded-lg border border-[color:var(--border-subtle)]" onClick={() => setModal(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">
                Create draft
              </button>
            </div>
          </form>
        </div>
      )}

      {payFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={recordPayment} className="w-full max-w-sm rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 space-y-3">
            <h2 className="text-lg font-semibold">Record payment</h2>
            <p className="text-[13px] text-[color:var(--text-muted)]">
              {payFor.number} · total {money(payFor.total, payFor.currency)} · already paid {money(payFor.amountPaid ?? 0, payFor.currency)}
            </p>
            <label className="block text-xs text-[color:var(--text-muted)]">
              Amount received
              <input
                type="number"
                min={0}
                step="0.01"
                max={payFor.total - (payFor.amountPaid ?? 0)}
                className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                value={payAmount}
                onChange={(e) => setPayAmount(Number(e.target.value))}
                autoFocus
              />
            </label>
            <p className="text-[11px] text-[color:var(--text-muted)]">
              Outstanding balance: {money(payFor.total - (payFor.amountPaid ?? 0), payFor.currency)}. Paying the full balance marks the invoice paid.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="px-3 py-2 text-sm rounded-lg border border-[color:var(--border-subtle)]" onClick={() => setPayFor(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm" disabled={payAmount <= 0}>
                Record payment
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function BillingTimeToInvoice() {
  const { token, user } = useAuth();
  const canManage = canAny(
    user,
    'taskflow.billing.time_to_invoice.manage',
    'taskflow.billing.invoice.create',
    'taskflow.billing.invoice.manage'
  );
  const accounts = useAccounts(token);
  const [summary, setSummary] = useState<{
    from: string;
    to: string;
    totalHours: number;
    estimatedValue: number;
    defaultRate: number;
    projects: Array<{
      projectId: string;
      projectName: string;
      projectKey: string;
      accountId?: string;
      hours: number;
      estimatedValue: number;
      rate: number;
    }>;
  } | null>(null);
  const [message, setMessage] = useState('');

  const load = () => {
    if (!token) return;
    billingApi.timeToInvoice(token).then((res) => {
      if (res.success && res.data) setSummary(res.data as typeof summary);
    });
  };

  useEffect(() => {
    load();
  }, [token]);

  async function invoiceProject(row: {
    projectId: string;
    projectKey: string;
    accountId?: string;
    hours: number;
    rate: number;
  }) {
    if (!token || !canManage) return;
    let accountId = row.accountId;
    if (!accountId) {
      accountId = accounts[0]?._id;
      if (!accountId) {
        setMessage('Link the project to a CRM account, or create an account first.');
        return;
      }
    }
    const res = await billingApi.createFromTime(
      {
        accountId,
        projectId: row.projectId,
        hours: row.hours,
        rate: row.rate,
      },
      token
    );
    if (res.success) {
      setMessage(`Draft invoice created for ${row.projectKey}.`);
      load();
    } else {
      setMessage((res as { message?: string }).message ?? 'Failed to create invoice');
    }
  }

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div>
        <Link to="/billing" className="text-xs text-[color:var(--accent)] hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-xl font-semibold mt-1">Time to invoice</h1>
        <p className="text-[13px] text-[color:var(--text-muted)]">
          Convert logged project time (last 30 days) into draft invoice lines.
        </p>
      </div>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
            <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">Unbilled hours</p>
            <p className="text-2xl font-semibold mt-1">{summary.totalHours}h</p>
          </div>
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
            <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">Estimated value</p>
            <p className="text-2xl font-semibold mt-1">{money(summary.estimatedValue)}</p>
          </div>
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
            <p className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">Default rate</p>
            <p className="text-2xl font-semibold mt-1">${summary.defaultRate}/h</p>
          </div>
        </div>
      )}

      {message && (
        <p className="text-sm text-[color:var(--accent)]">
          {message}{' '}
          <Link to="/billing/invoices" className="underline">
            View invoices
          </Link>
        </p>
      )}

      <div className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--bg-elevated)] text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Project</th>
              <th className="text-right px-4 py-3 font-medium">Hours</th>
              <th className="text-right px-4 py-3 font-medium">Est. value</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(summary?.projects ?? []).map((p) => (
              <tr key={p.projectId} className="border-t border-[color:var(--border-subtle)]">
                <td className="px-4 py-3">
                  <span className="font-medium">{p.projectKey}</span>
                  <span className="text-[color:var(--text-muted)]"> — {p.projectName}</span>
                  {!p.accountId && (
                    <span className="ml-2 text-[11px] text-amber-600 dark:text-amber-400">no CRM account</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{p.hours}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(p.estimatedValue)}</td>
                <td className="px-4 py-3 text-right">
                  {canManage && (
                    <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => invoiceProject(p)}>
                      Create draft
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {(!summary || summary.projects.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-[color:var(--text-muted)]">
                  No logged time in the last 30 days.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BillingTax() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.billing.tax.manage');
  const [rows, setRows] = useState<BillingTaxRule[]>([]);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({
    name: '',
    code: '',
    rate: 18,
    jurisdiction: '',
    hsnSac: '',
    inclusive: false,
    notes: '',
  });

  const load = () => {
    if (!token) return;
    billingApi.listTax(token).then((res) => {
      if (res.success && res.data) setRows(res.data as BillingTaxRule[]);
    });
  };

  useEffect(() => {
    load();
  }, [token]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!token || !form.name.trim() || !form.code.trim()) return;
    await billingApi.createTax(
      {
        name: form.name.trim(),
        code: form.code.trim(),
        rate: Number(form.rate) || 0,
        jurisdiction: form.jurisdiction.trim() || undefined,
        hsnSac: form.hsnSac.trim() || undefined,
        inclusive: form.inclusive,
        notes: form.notes.trim() || undefined,
      },
      token
    );
    setModal(false);
    setForm({ name: '', code: '', rate: 18, jurisdiction: '', hsnSac: '', inclusive: false, notes: '' });
    load();
  }

  async function toggle(row: BillingTaxRule) {
    if (!token || !canManage) return;
    await billingApi.updateTax(row._id, { enabled: !row.enabled }, token);
    load();
  }

  async function remove(id: string) {
    if (!token || !canManage) return;
    if (!confirm('Delete this tax rule?')) return;
    await billingApi.deleteTax(id, token);
    load();
  }

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/billing" className="text-xs text-[color:var(--accent)] hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-semibold mt-1">Tax & GST</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">Tax codes, rates, and HSN/SAC references for invoices.</p>
        </div>
        {canManage && (
          <button type="button" className="btn-primary px-4 py-2 rounded-lg text-sm" onClick={() => setModal(true)}>
            Add tax rule
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r) => (
          <div key={r._id} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-medium">{r.name}</h2>
                <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">
                  {r.code} · {r.rate}%{r.inclusive ? ' incl.' : ''}
                </p>
              </div>
              <span className={`text-[11px] ${r.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-[color:var(--text-muted)]'}`}>
                {r.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            {(r.jurisdiction || r.hsnSac) && (
              <p className="mt-2 text-sm text-[color:var(--text-muted)]">
                {[r.jurisdiction, r.hsnSac ? `HSN/SAC ${r.hsnSac}` : null].filter(Boolean).join(' · ')}
              </p>
            )}
            {canManage && (
              <div className="mt-3 flex gap-3 text-xs">
                <button type="button" className="text-[color:var(--accent)] hover:underline" onClick={() => toggle(r)}>
                  {r.enabled ? 'Disable' : 'Enable'}
                </button>
                <button type="button" className="text-red-400 hover:underline" onClick={() => remove(r._id)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-[color:var(--border-subtle)] p-10 text-center text-sm text-[color:var(--text-muted)]">
            No tax rules yet. Add GST/VAT codes to apply on invoices.
          </div>
        )}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={create} className="w-full max-w-md rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 space-y-3">
            <h2 className="text-lg font-semibold">New tax rule</h2>
            <label className="block text-xs text-[color:var(--text-muted)]">
              Name
              <input
                className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-[color:var(--text-muted)]">
                Code
                <input
                  className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  required
                  placeholder="GST18"
                />
              </label>
              <label className="block text-xs text-[color:var(--text-muted)]">
                Rate %
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  value={form.rate}
                  onChange={(e) => setForm((f) => ({ ...f, rate: Number(e.target.value) }))}
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-[color:var(--text-muted)]">
                Jurisdiction
                <input
                  className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  value={form.jurisdiction}
                  onChange={(e) => setForm((f) => ({ ...f, jurisdiction: e.target.value }))}
                />
              </label>
              <label className="block text-xs text-[color:var(--text-muted)]">
                HSN / SAC
                <input
                  className="mt-1 w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
                  value={form.hsnSac}
                  onChange={(e) => setForm((f) => ({ ...f, hsnSac: e.target.value }))}
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.inclusive} onChange={(e) => setForm((f) => ({ ...f, inclusive: e.target.checked }))} />
              Tax inclusive pricing
            </label>
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
