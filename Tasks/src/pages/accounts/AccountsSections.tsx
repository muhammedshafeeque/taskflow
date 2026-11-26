import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { accountsApi } from '../../lib/api';
import type { AccountExpense, BillingInvoice, ExpenseApprovalSettings, ProcurementApprover } from '../../lib/api';
import {
  ExportButton, Field, GhostButton, Modal, PrimaryButton, Select, SectionPage, StatusPill, TextArea, TextInput, money, nameOf,
} from '../../components/moduleKit';
import { ModuleLoader } from '../../components/loaders/ModuleLoader';
import { PersonMultiSelect, PersonSelect, toPeople } from '../../components/people';

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
      {!data ? <ModuleLoader size="block" label="Loading general ledger…" /> : (
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
      {loading ? <ModuleLoader size="block" label="Loading invoices…" /> : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No invoices yet — create them in Billing.</p>
      ) : tableWrap(
        <>
          <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
            <tr><th className="text-left px-4 py-2.5 font-medium">Number</th><th className="text-left px-4 py-2.5 font-medium">Account</th><th className="text-left px-4 py-2.5 font-medium">Status</th><th className="text-right px-4 py-2.5 font-medium">Total</th><th className="text-left px-4 py-2.5 font-medium">Ledger</th><th className="px-4 py-2.5" /></tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i._id} className="border-t border-[color:var(--border-subtle)]">
                <td className="px-4 py-2.5 font-medium">
                  <Link to="/billing/invoices" className="text-[color:var(--accent)] hover:underline">{i.number}</Link>
                </td>
                <td className="px-4 py-2.5">
                  {typeof i.accountId === 'object' && i.accountId?._id ? (
                    <Link to={`/crm/accounts/${i.accountId._id}`} className="text-[color:var(--accent)] hover:underline">
                      {nameOf(i.accountId, '—')}
                    </Link>
                  ) : (
                    nameOf(i.accountId, '—')
                  )}
                </td>
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
const EDITABLE_STATUSES = ['draft', 'submitted', 'rejected'];
const EMPTY_EXPENSE_SETTINGS: ExpenseApprovalSettings = { singleApproverLimit: null, maxClaimAmount: null, secondApproverIds: [], approverLimits: [] };
type ExpenseSettingsForm = {
  singleApproverLimit: string;
  maxClaimAmount: string;
  secondApproverIds: string[];
  approverLimits: Array<{ userId: string; maxAmount: string }>;
};

function idOf(ref: string | { _id?: string } | undefined): string {
  if (!ref) return '';
  return typeof ref === 'string' ? ref : (ref._id ?? '');
}

export function AccountsExpenses() {
  const { token, user } = useAuth();
  const [rows, setRows] = useState<AccountExpense[]>([]);
  const [editing, setEditing] = useState<Partial<AccountExpense> | null>(null);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<ExpenseApprovalSettings>(EMPTY_EXPENSE_SETTINGS);
  const [approvers, setApprovers] = useState<ProcurementApprover[]>([]);
  const [settingsForm, setSettingsForm] = useState<ExpenseSettingsForm | null>(null);
  const [msg, setMsg] = useState('');
  const [errMsg, setErrMsg] = useState('');

  const canEdit = canAny(user, 'taskflow.accounts.expense.update');
  const canCreate = canAny(user, 'taskflow.accounts.expense.create', 'taskflow.accounts.expense.update');
  const canApprove = canAny(user, 'taskflow.accounts.expense.approve');
  const canSettings = canAny(user, 'taskflow.accounts.chart.manage');

  const flash = (text: string) => { setMsg(text); setTimeout(() => setMsg(''), 6000); };

  const load = useCallback(() => {
    if (!token) return;
    accountsApi.listExpenses(token).then((r) => { setLoading(false); if (r.success && r.data) setRows(r.data); });
    accountsApi.expenseApprovalSettings(token).then((r) => r.success && r.data && setSettings(r.data));
    if (canSettings) accountsApi.listExpenseApprovers(token).then((r) => r.success && r.data && setApprovers(r.data));
  }, [token, canSettings]);
  useEffect(load, [load]);

  const save = async () => {
    if (!token || !editing) return;
    setErrMsg('');
    // Status is changed only through the approval workflow, never from the edit form.
    const { status, ...fields } = editing;
    const res = editing._id
      ? await accountsApi.updateExpense(editing._id, fields, token)
      : await accountsApi.createExpense({ ...fields, status }, token);
    if (res.success) { setEditing(null); load(); } else setErrMsg(res.message || 'Could not save the expense');
  };
  const setStatus = async (id: string, status: string) => {
    if (!token) return;
    setErrMsg('');
    const res = await accountsApi.transitionExpense(id, status, token);
    if (!res.success) { setErrMsg(res.message || 'Status update failed'); return; }
    if (res.data?.awaitingSecondApproval) flash('First approval recorded. A second, different approver must approve this claim.');
    load();
  };
  const remove = async (id: string) => {
    if (!token || !confirm('Delete expense?')) return;
    setErrMsg('');
    const res = await accountsApi.removeExpense(id, token);
    if (!res.success) setErrMsg(res.message || 'Could not delete the expense');
    load();
  };

  const openSettings = () => setSettingsForm({
    singleApproverLimit: settings.singleApproverLimit != null ? String(settings.singleApproverLimit) : '',
    maxClaimAmount: settings.maxClaimAmount != null ? String(settings.maxClaimAmount) : '',
    secondApproverIds: [...settings.secondApproverIds],
    approverLimits: settings.approverLimits.filter((l) => l.userId).map((l) => ({ userId: l.userId!, maxAmount: String(l.maxAmount) })),
  });
  const saveSettings = async () => {
    if (!token || !settingsForm) return;
    setErrMsg('');
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    const res = await accountsApi.updateExpenseApprovalSettings({
      singleApproverLimit: num(settingsForm.singleApproverLimit),
      maxClaimAmount: num(settingsForm.maxClaimAmount),
      secondApproverIds: settingsForm.secondApproverIds,
      approverLimits: settingsForm.approverLimits
        .filter((l) => l.userId && l.maxAmount.trim() !== '')
        .map((l) => ({ userId: l.userId, maxAmount: Number(l.maxAmount) })),
    }, token);
    if (!res.success) { setErrMsg(res.message || 'Could not save approval limits'); return; }
    if (res.data) setSettings(res.data);
    setSettingsForm(null);
    flash('Approval limits saved.');
  };

  const actionsFor = (x: AccountExpense) => {
    const uid = user?.id ?? '';
    const isClaimant = Boolean(uid && idOf(x.submittedBy) === uid);
    const firstBy = idOf(x.firstApprovedBy);
    const out: Array<{ label: string; status: string; tone: string; disabled?: boolean; title?: string }> = [];
    if (x.status === 'draft' && (isClaimant || canEdit)) out.push({ label: 'Submit', status: 'submitted', tone: 'text-[color:var(--accent)]' });
    if (x.status === 'submitted' && canApprove) {
      const blocked = isClaimant
        ? 'You cannot approve your own expense claim'
        : firstBy && firstBy === uid
          ? 'A different person must give the second approval'
          : undefined;
      out.push({ label: firstBy ? '2nd approve' : 'Approve', status: 'approved', tone: 'text-emerald-500', disabled: Boolean(blocked), title: blocked });
      out.push({ label: 'Reject', status: 'rejected', tone: 'text-rose-500' });
    }
    if (x.status === 'approved' && canEdit) out.push({ label: 'Mark paid', status: 'paid', tone: 'text-emerald-500' });
    if (x.status === 'rejected' && (isClaimant || canEdit)) out.push({ label: 'Reopen', status: 'draft', tone: 'text-[color:var(--accent)]' });
    return out;
  };

  const statusTone: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = { paid: 'green', approved: 'blue', submitted: 'amber', draft: 'slate', rejected: 'red' };
  const people = toPeople(approvers);

  return (
    <SectionPage title="Expenses" subtitle="Vendor bills, reimbursements, and recurring costs." toolbar={<div className="flex gap-2">
      {canSettings && <GhostButton onClick={openSettings}>Approval limits</GhostButton>}
      <ExportButton rows={rows} filename="expenses" columns={[
        { header: 'Reference', value: (r) => r.reference },
        { header: 'Description', value: (r) => r.description },
        { header: 'Category', value: (r) => r.category },
        { header: 'Status', value: (r) => r.status },
        { header: 'Date', value: (r) => new Date(r.expenseDate).toLocaleDateString() },
        { header: 'Amount', value: (r) => r.amount },
        { header: 'Currency', value: (r) => r.currency },
      ]} />
      {canCreate && <PrimaryButton onClick={() => setEditing({ category: 'other', status: 'submitted', currency: 'USD', expenseDate: new Date().toISOString().slice(0, 10) })}>+ Add expense</PrimaryButton>}
    </div>}>
      {(settings.singleApproverLimit != null || settings.maxClaimAmount != null) && (
        <div className="mb-3 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-4 py-2 text-xs text-[color:var(--text-muted)] flex flex-wrap gap-4">
          {settings.singleApproverLimit != null && <span>2nd approver required above: <strong className="text-[color:var(--text-primary)]">{money(settings.singleApproverLimit)}</strong></span>}
          {settings.maxClaimAmount != null && <span>Max claim: <strong className="text-[color:var(--text-primary)]">{money(settings.maxClaimAmount)}</strong></span>}
        </div>
      )}
      {msg && <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-600 dark:text-emerald-400">{msg}</div>}
      {errMsg && <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-500">{errMsg}</div>}
      {loading ? <ModuleLoader size="block" label="Loading expenses…" /> : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No expenses yet.</p>
      ) : tableWrap(
        <>
          <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
            <tr><th className="text-left px-4 py-2.5 font-medium">Expense</th><th className="text-left px-4 py-2.5 font-medium">Category</th><th className="text-left px-4 py-2.5 font-medium">Date</th><th className="text-left px-4 py-2.5 font-medium">Status</th><th className="text-right px-4 py-2.5 font-medium">Amount</th><th className="px-4 py-2.5" /></tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x._id} className="border-t border-[color:var(--border-subtle)]">
                <td className="px-4 py-2.5">
                  <p className="font-medium">{x.description}</p>
                  <p className="text-[11px] text-[color:var(--text-muted)]">{x.reference}</p>
                  {x.vendorAccountId && typeof x.vendorAccountId === 'object' && x.vendorAccountId._id && (
                    <Link to={`/crm/accounts/${x.vendorAccountId._id}`} className="text-[11px] text-[color:var(--accent)] hover:underline">
                      {x.vendorAccountId.name}
                    </Link>
                  )}
                  {x.purchaseOrderId && typeof x.purchaseOrderId === 'object' && x.purchaseOrderId._id && (
                    <p className="text-[11px]"><Link to="/procurement/pos" className="text-[color:var(--accent)] hover:underline">{x.purchaseOrderId.poNumber ?? 'PO'}</Link></p>
                  )}
                  {x.projectId && typeof x.projectId === 'object' && x.projectId._id && (
                    <p className="text-[11px]"><Link to={`/projects/${x.projectId._id}/dashboard`} className="text-[color:var(--accent)] hover:underline">{x.projectId.key ?? 'Project'}</Link></p>
                  )}
                </td>
                <td className="px-4 py-2.5 capitalize">{x.category.replace('_', ' ')}</td>
                <td className="px-4 py-2.5 text-[color:var(--text-muted)]">{new Date(x.expenseDate).toLocaleDateString()}</td>
                <td className="px-4 py-2.5">
                  <StatusPill label={x.status} tone={statusTone[x.status]} />
                  {x.status === 'submitted' && x.firstApprovedBy && <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">1 of 2 approvals</p>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{money(x.amount, x.currency)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {actionsFor(x).map((a) => (
                    <button
                      key={a.status}
                      onClick={() => setStatus(x._id, a.status)}
                      disabled={a.disabled}
                      title={a.title}
                      className={`${a.tone} hover:underline text-xs mr-3 disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed`}
                    >
                      {a.label}
                    </button>
                  ))}
                  {canEdit && EDITABLE_STATUSES.includes(x.status) && <button onClick={() => setEditing(x)} className="text-[color:var(--accent)] hover:underline text-xs mr-3">Edit</button>}
                  {canEdit && <button onClick={() => remove(x._id)} className="text-rose-500 hover:underline text-xs">Delete</button>}
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
            <Field label="Amount"><TextInput type="number" min={0} value={editing.amount ?? 0} onChange={(e) => setEditing({ ...editing, amount: Number(e.target.value) })} /></Field>
            <Field label="Date"><TextInput type="date" value={(editing.expenseDate ?? '').slice(0, 10)} onChange={(e) => setEditing({ ...editing, expenseDate: e.target.value })} /></Field>
            <Field label="Currency"><TextInput value={editing.currency ?? 'USD'} onChange={(e) => setEditing({ ...editing, currency: e.target.value })} /></Field>
            {!editing._id && (
              <Field label="Save as">
                <Select value={editing.status ?? 'submitted'} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                  <option value="submitted">Submitted for approval</option>
                  <option value="draft">Draft</option>
                </Select>
              </Field>
            )}
          </div>
          <Field label="Notes"><TextArea rows={2} value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field>
          {editing._id && editing.status === 'submitted' && editing.firstApprovedBy && (
            <p className="text-xs text-amber-500">Changing the amount clears the first approval, so the claim is reviewed again.</p>
          )}
        </Modal>
      )}

      {settingsForm && (
        <Modal
          title="Expense approval limits"
          onClose={() => setSettingsForm(null)}
          wide
          footer={<><GhostButton onClick={() => setSettingsForm(null)}>Cancel</GhostButton><PrimaryButton onClick={saveSettings}>Save limits</PrimaryButton></>}
        >
          <p className="text-xs text-[color:var(--text-muted)] mb-3">Nobody can approve their own claim. Leave a field empty for no limit.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Two approvals needed above">
              <TextInput type="number" min={0} placeholder="e.g. 500" value={settingsForm.singleApproverLimit} onChange={(e) => setSettingsForm({ ...settingsForm, singleApproverLimit: e.target.value })} />
            </Field>
            <Field label="Maximum claim amount">
              <TextInput type="number" min={0} placeholder="e.g. 10000" value={settingsForm.maxClaimAmount} onChange={(e) => setSettingsForm({ ...settingsForm, maxClaimAmount: e.target.value })} />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Second approvers (optional; if empty, any other approver can give the 2nd approval)">
              <PersonMultiSelect
                values={settingsForm.secondApproverIds}
                onChange={(v) => setSettingsForm({ ...settingsForm, secondApproverIds: v })}
                people={people}
                placeholder="Search people…"
                aria-label="Second approvers"
              />
            </Field>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">Per-approver limits</span>
              <button
                type="button"
                onClick={() => setSettingsForm({ ...settingsForm, approverLimits: [...settingsForm.approverLimits, { userId: '', maxAmount: '' }] })}
                className="text-xs text-[color:var(--accent)] hover:underline"
              >
                + Add limit
              </button>
            </div>
            <div className="space-y-2">
              {settingsForm.approverLimits.map((rule, idx) => {
                const update = (patch: Partial<typeof rule>) => {
                  const next = [...settingsForm.approverLimits];
                  next[idx] = { ...rule, ...patch };
                  setSettingsForm({ ...settingsForm, approverLimits: next });
                };
                return (
                  <div key={idx} className="grid grid-cols-[1fr_140px_auto] gap-2 items-center">
                    <PersonSelect value={rule.userId} onChange={(v) => update({ userId: v })} people={people} placeholder="Search approver…" aria-label="Approver" />
                    <TextInput type="number" min={0} placeholder="Max amount" value={rule.maxAmount} onChange={(e) => update({ maxAmount: e.target.value })} />
                    <button
                      type="button"
                      onClick={() => setSettingsForm({ ...settingsForm, approverLimits: settingsForm.approverLimits.filter((_, i) => i !== idx) })}
                      className="text-xs text-rose-500 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              {settingsForm.approverLimits.length === 0 && <p className="text-xs text-[color:var(--text-muted)]">No per-approver limits.</p>}
            </div>
          </div>
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
      {!data ? <ModuleLoader size="block" label="Loading financial reports…" /> : (
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
