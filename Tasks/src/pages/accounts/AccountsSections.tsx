import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { accountsApi } from '../../lib/api';
import type { AccountExpense, BillingInvoice } from '../../lib/api';
import {
  ExportButton, Field, GhostButton, Modal, PrimaryButton, Select, SectionPage, StatusPill, TextArea, TextInput, money, nameOf,
} from '../../components/moduleKit';

function tableWrap(children: React.ReactNode) {
  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

// ── Ledger ─────────────────────────────────────────────────────────────────
export function AccountsLedger() {
  const { token } = useAuth();
  const [data, setData] = useState<{ entries: Array<{ _id: string; date: string; account: string; memo: string; type: string; debit: number; credit: number; currency: string; posted: boolean }>; totalDebit: number; totalCredit: number } | null>(null);

  useEffect(() => {
    if (!token) return;
    accountsApi.ledger(token).then((r) => r.success && r.data && setData(r.data as never));
  }, [token]);

  return (
    <SectionPage title="General ledger" subtitle="Journal derived from billing revenue and expenses. Post invoices from the Invoices tab.">
      {!data ? <p className="text-sm text-[color:var(--text-muted)]">Loading…</p> : (
        <>
          <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-5 py-4 flex flex-wrap gap-6">
            <div><p className="text-xs text-[color:var(--text-muted)]">Total credits (revenue)</p><p className="text-xl font-bold text-emerald-500">{money(data.totalCredit)}</p></div>
            <div><p className="text-xs text-[color:var(--text-muted)]">Total debits (expense)</p><p className="text-xl font-bold text-rose-500">{money(data.totalDebit)}</p></div>
            <div><p className="text-xs text-[color:var(--text-muted)]">Net</p><p className="text-xl font-bold">{money(data.totalCredit - data.totalDebit)}</p></div>
          </div>
          {data.entries.length === 0 ? <p className="text-sm text-[color:var(--text-muted)]">No ledger entries yet.</p> : tableWrap(
            <>
              <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
                <tr><th className="text-left px-4 py-2.5 font-medium">Date</th><th className="text-left px-4 py-2.5 font-medium">Account</th><th className="text-left px-4 py-2.5 font-medium">Memo</th><th className="text-right px-4 py-2.5 font-medium">Debit</th><th className="text-right px-4 py-2.5 font-medium">Credit</th></tr>
              </thead>
              <tbody>
                {data.entries.map((e) => (
                  <tr key={e._id} className="border-t border-[color:var(--border-subtle)]">
                    <td className="px-4 py-2.5 text-[color:var(--text-muted)] whitespace-nowrap">{new Date(e.date).toLocaleDateString()}</td>
                    <td className="px-4 py-2.5">{e.account}</td>
                    <td className="px-4 py-2.5 text-[color:var(--text-muted)]">{e.memo}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-rose-500">{e.debit ? money(e.debit, e.currency) : ''}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-emerald-500">{e.credit ? money(e.credit, e.currency) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </>
      )}
    </SectionPage>
  );
}

// ── Invoices (finance view with post-to-ledger) ─────────────────────────────
export function AccountsInvoices() {
  const { token } = useAuth();
  const [rows, setRows] = useState<BillingInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!token) return;
    accountsApi.listInvoices(token).then((r) => { setLoading(false); if (r.success && r.data) setRows(r.data); });
  }, [token]);
  useEffect(load, [load]);

  const togglePost = async (id: string) => { if (!token) return; await accountsApi.postInvoice(id, token); load(); };

  const statusTone: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = { paid: 'green', sent: 'blue', draft: 'slate', overdue: 'red', void: 'slate' };

  return (
    <SectionPage title="Invoices" subtitle="Commercial invoices from Billing. Post to the ledger to reflect them in the books.">
      {loading ? <p className="text-sm text-[color:var(--text-muted)]">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No invoices yet — create them in Billing.</p>
      ) : tableWrap(
        <>
          <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
            <tr><th className="text-left px-4 py-2.5 font-medium">Number</th><th className="text-left px-4 py-2.5 font-medium">Account</th><th className="text-left px-4 py-2.5 font-medium">Status</th><th className="text-right px-4 py-2.5 font-medium">Total</th><th className="text-left px-4 py-2.5 font-medium">Ledger</th><th className="px-4 py-2.5" /></tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i._id} className="border-t border-[color:var(--border-subtle)]">
                <td className="px-4 py-2.5 font-medium">{i.number}</td>
                <td className="px-4 py-2.5">{nameOf(i.accountId, '—')}</td>
                <td className="px-4 py-2.5"><StatusPill label={i.status} tone={statusTone[i.status]} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(i.total, i.currency)}</td>
                <td className="px-4 py-2.5">{i.postedToAccounts ? <StatusPill label="posted" tone="green" /> : <span className="text-[11px] text-[color:var(--text-muted)]">not posted</span>}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => togglePost(i._id)} className="text-[color:var(--accent)] hover:underline text-xs">{i.postedToAccounts ? 'Unpost' : 'Post'}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </>
      )}
    </SectionPage>
  );
}

// ── Expenses ─────────────────────────────────────────────────────────────────
const EXPENSE_CATS = ['payroll', 'software', 'hardware', 'infrastructure', 'travel', 'marketing', 'office', 'professional_services', 'other'];

export function AccountsExpenses() {
  const { token } = useAuth();
  const [rows, setRows] = useState<AccountExpense[]>([]);
  const [editing, setEditing] = useState<Partial<AccountExpense> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!token) return;
    accountsApi.listExpenses(token).then((r) => { setLoading(false); if (r.success && r.data) setRows(r.data); });
  }, [token]);
  useEffect(load, [load]);

  const save = async () => {
    if (!token || !editing) return;
    const res = editing._id ? await accountsApi.updateExpense(editing._id, editing, token) : await accountsApi.createExpense(editing, token);
    if (res.success) { setEditing(null); load(); } else alert(res.message);
  };
  const setStatus = async (id: string, status: string) => { if (!token) return; await accountsApi.updateExpense(id, { status }, token); load(); };
  const remove = async (id: string) => { if (!token || !confirm('Delete expense?')) return; await accountsApi.removeExpense(id, token); load(); };

  const statusTone: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = { paid: 'green', approved: 'blue', submitted: 'amber', draft: 'slate', rejected: 'red' };

  return (
    <SectionPage title="Expenses" subtitle="Vendor bills, reimbursements, and recurring costs." toolbar={<div className="flex gap-2"><ExportButton rows={rows} filename="expenses" columns={[
      { header: 'Reference', value: (r) => r.reference },
      { header: 'Description', value: (r) => r.description },
      { header: 'Category', value: (r) => r.category },
      { header: 'Status', value: (r) => r.status },
      { header: 'Date', value: (r) => new Date(r.expenseDate).toLocaleDateString() },
      { header: 'Amount', value: (r) => r.amount },
      { header: 'Currency', value: (r) => r.currency },
    ]} /><PrimaryButton onClick={() => setEditing({ category: 'other', status: 'submitted', currency: 'USD', expenseDate: new Date().toISOString().slice(0, 10) })}>+ Add expense</PrimaryButton></div>}>
      {loading ? <p className="text-sm text-[color:var(--text-muted)]">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No expenses yet.</p>
      ) : tableWrap(
        <>
          <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
            <tr><th className="text-left px-4 py-2.5 font-medium">Expense</th><th className="text-left px-4 py-2.5 font-medium">Category</th><th className="text-left px-4 py-2.5 font-medium">Date</th><th className="text-left px-4 py-2.5 font-medium">Status</th><th className="text-right px-4 py-2.5 font-medium">Amount</th><th className="px-4 py-2.5" /></tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x._id} className="border-t border-[color:var(--border-subtle)]">
                <td className="px-4 py-2.5"><p className="font-medium">{x.description}</p><p className="text-[11px] text-[color:var(--text-muted)]">{x.reference}</p></td>
                <td className="px-4 py-2.5 capitalize">{x.category.replace('_', ' ')}</td>
                <td className="px-4 py-2.5 text-[color:var(--text-muted)]">{new Date(x.expenseDate).toLocaleDateString()}</td>
                <td className="px-4 py-2.5"><StatusPill label={x.status} tone={statusTone[x.status]} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(x.amount, x.currency)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {x.status === 'submitted' && <button onClick={() => setStatus(x._id, 'approved')} className="text-emerald-500 hover:underline text-xs mr-3">Approve</button>}
                  {x.status === 'approved' && <button onClick={() => setStatus(x._id, 'paid')} className="text-emerald-500 hover:underline text-xs mr-3">Mark paid</button>}
                  <button onClick={() => setEditing(x)} className="text-[color:var(--accent)] hover:underline text-xs mr-3">Edit</button>
                  <button onClick={() => remove(x._id)} className="text-rose-500 hover:underline text-xs">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </>
      )}

      {editing && (
        <Modal title={editing._id ? 'Edit expense' : 'Add expense'} onClose={() => setEditing(null)} footer={<><GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton><PrimaryButton onClick={save}>Save</PrimaryButton></>}>
          <Field label="Description"><TextInput value={editing.description ?? ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Select value={editing.category ?? 'other'} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
              </Select>
            </Field>
            <Field label="Amount"><TextInput type="number" value={editing.amount ?? 0} onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) })} /></Field>
            <Field label="Date"><TextInput type="date" value={(editing.expenseDate ?? '').slice(0, 10)} onChange={(e) => setEditing({ ...editing, expenseDate: e.target.value })} /></Field>
            <Field label="Currency"><TextInput value={editing.currency ?? 'USD'} onChange={(e) => setEditing({ ...editing, currency: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><TextArea rows={2} value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
        </Modal>
      )}
    </SectionPage>
  );
}

// ── Reports (P&L summary) ─────────────────────────────────────────────────────
export function AccountsReports() {
  const { token } = useAuth();
  const [data, setData] = useState<{ revenue: number; collected: number; outstanding: number; totalExpense: number; netProfit: number; profitMargin: number; expenseCategories: { name: string; value: number }[] } | null>(null);

  useEffect(() => {
    if (!token) return;
    accountsApi.dashboard(token).then((r) => r.success && r.data && setData(r.data as never));
  }, [token]);

  return (
    <SectionPage title="Financial reports" subtitle="Profit & loss summary derived from billing and expenses.">
      {!data ? <p className="text-sm text-[color:var(--text-muted)]">Loading…</p> : (
        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 max-w-xl">
          <h2 className="text-sm font-bold mb-4">Profit &amp; loss</h2>
          <dl className="space-y-2.5 text-sm">
            <Row label="Revenue" value={money(data.revenue)} strong />
            <Row label="  Collected" value={money(data.collected)} muted />
            <Row label="  Outstanding" value={money(data.outstanding)} muted />
            <div className="border-t border-[color:var(--border-subtle)] my-2" />
            <Row label="Total expenses" value={`(${money(data.totalExpense)})`} />
            {data.expenseCategories.map((c) => <Row key={c.name} label={`  ${c.name}`} value={`(${money(c.value)})`} muted />)}
            <div className="border-t border-[color:var(--border-subtle)] my-2" />
            <Row label="Net profit" value={money(data.netProfit)} strong accent={data.netProfit >= 0} />
            <Row label="Profit margin" value={`${data.profitMargin}%`} muted />
          </dl>
        </div>
      )}
    </SectionPage>
  );
}

function Row({ label, value, strong, muted, accent }: { label: string; value: string; strong?: boolean; muted?: boolean; accent?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? 'font-bold' : ''} ${muted ? 'text-[color:var(--text-muted)]' : ''}`}>
      <dt className="whitespace-pre capitalize">{label}</dt>
      <dd className={`tabular-nums ${accent === true ? 'text-emerald-500' : accent === false ? 'text-rose-500' : ''}`}>{value}</dd>
    </div>
  );
}
