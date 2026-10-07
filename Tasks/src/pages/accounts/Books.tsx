import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { canAny } from '../../utils/moduleAccess';
import { CrudPage, fmtDate, type Row } from '../../components/CrudPage';
import { Field, GhostButton, Modal, PrimaryButton, SectionPage, Select, StatusPill, TextArea, TextInput } from '../../components/moduleKit';

/** Double-entry books: settings, chart, journals, statements, payables, banking. */
const A = {
  chart: 'taskflow.accounts.chart.manage',
  journalManage: 'taskflow.accounts.journal.manage',
  billManage: 'taskflow.accounts.bill.manage',
  creditManage: 'taskflow.accounts.credit_note.manage',
  bankManage: 'taskflow.accounts.bank.manage',
};

const POSTING_LABELS: Record<string, string> = {
  receivable: 'Accounts receivable',
  revenue: 'Sales / revenue',
  taxPayable: 'Output tax payable',
  inputTax: 'Input tax receivable',
  bank: 'Default bank / cash',
  payable: 'Accounts payable',
  expenseDefault: 'Default expense',
  employeeReimbursements: 'Employee reimbursements payable',
  salaryExpense: 'Salary expense',
  payrollDeductions: 'Payroll deductions payable',
};

const num = (n: unknown) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function useData<T>(path: string | null) {
  const { token } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => {
    if (!token || !path) return;
    api.get<T>(path, token).then((r) => (r.success ? (setData(r.data ?? null), setError('')) : setError(r.message ?? 'Failed')));
  }, [token, path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

function Panel({ title, children, right }: { title?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 space-y-3">
      {(title || right) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

function AccountSelect({ accounts, value, onChange, filter }: { accounts: Row[]; value: string; onChange: (v: string) => void; filter?: string[] }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— not set —</option>
      {accounts
        .filter((a) => !filter || filter.includes(String(a.type)))
        .map((a) => (
          <option key={String(a._id)} value={String(a._id)}>
            {String(a.code)} · {String(a.name)}
          </option>
        ))}
    </Select>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────
export function BooksSettings() {
  const { token, user } = useAuth();
  const manage = canAny(user, A.chart);
  const settings = useData<Row>('/accounts/books/settings');
  const chart = useData<Row[]>('/accounts/books/chart');
  const [draft, setDraft] = useState<Row | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (settings.data) setDraft({ ...settings.data, newCategory: '' });
  }, [settings.data]);
  if (!draft) return <SectionPage title="Books settings">{settings.error || 'Loading…'}</SectionPage>;
  const map = (draft.accountMap as Record<string, string>) ?? {};
  const catMap = (draft.expenseCategoryAccounts as Record<string, string>) ?? {};
  const cats = (draft.expenseCategories as string[]) ?? [];
  const accounts = chart.data ?? [];

  const save = async () => {
    if (!token) return;
    const { newCategory: _n, ...body } = draft;
    const r = await api.put('/accounts/books/settings', body, token);
    setMsg(r.success ? 'Saved.' : r.message ?? 'Failed');
    if (r.success) settings.reload();
    setTimeout(() => setMsg(''), 3000);
  };
  return (
    <SectionPage title="Books settings" subtitle="Which accounts automatic postings use, your expense categories and numbering.">
      {accounts.length === 0 && (
        <Panel>
          <p className="text-sm">
            Your chart of accounts is empty. Create accounts under <b>Chart of accounts</b> (or load the optional starter chart) before mapping postings.
          </p>
        </Panel>
      )}
      <fieldset disabled={!manage} className="grid gap-4 lg:grid-cols-2">
        <Panel title="Posting accounts">
          {Object.keys(POSTING_LABELS).map((k) => (
            <Field key={k} label={POSTING_LABELS[k]}>
              <AccountSelect accounts={accounts} value={String(map[k] ?? '')} onChange={(v) => setDraft({ ...draft, accountMap: { ...map, [k]: v || null } })} />
            </Field>
          ))}
        </Panel>
        <div className="space-y-4">
          <Panel title="General">
            <Field label="Fiscal year starts (month)">
              <Select value={String(draft.fiscalYearStartMonth ?? 1)} onChange={(e) => setDraft({ ...draft, fiscalYearStartMonth: Number(e.target.value) })}>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {new Date(2000, i, 1).toLocaleString(undefined, { month: 'long' })}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={Boolean(draft.autoPost)} onChange={(e) => setDraft({ ...draft, autoPost: e.target.checked })} /> Post invoices, payments, expenses, bills and payroll to the ledger automatically
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bill number prefix">
                <TextInput value={String(draft.billNumberPrefix ?? '')} onChange={(e) => setDraft({ ...draft, billNumberPrefix: e.target.value })} />
              </Field>
              <Field label="Credit note prefix">
                <TextInput value={String(draft.creditNotePrefix ?? '')} onChange={(e) => setDraft({ ...draft, creditNotePrefix: e.target.value })} />
              </Field>
            </div>
          </Panel>
          <Panel title="Expense categories">
            {cats.map((c) => (
              <div key={c} className="grid grid-cols-[8rem_1fr_auto] items-center gap-2">
                <span className="text-sm">{c.replace(/_/g, ' ')}</span>
                <AccountSelect accounts={accounts} filter={['expense', 'asset']} value={String(catMap[c] ?? '')} onChange={(v) => setDraft({ ...draft, expenseCategoryAccounts: { ...catMap, [c]: v || null } })} />
                <button className="text-rose-500 text-sm" onClick={() => setDraft({ ...draft, expenseCategories: cats.filter((x) => x !== c) })}>
                  ✕
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <TextInput placeholder="New category" value={String(draft.newCategory ?? '')} onChange={(e) => setDraft({ ...draft, newCategory: e.target.value })} />
              <GhostButton
                onClick={() => {
                  const c = String(draft.newCategory ?? '').trim().toLowerCase().replace(/\s+/g, '_');
                  if (c && !cats.includes(c)) setDraft({ ...draft, expenseCategories: [...cats, c], newCategory: '' });
                }}
              >
                Add
              </GhostButton>
            </div>
            <p className="text-[11px] text-[color:var(--text-muted)]">Unmapped categories post to the default expense account.</p>
          </Panel>
        </div>
      </fieldset>
      {manage && (
        <div className="flex items-center gap-3">
          <PrimaryButton onClick={save}>Save settings</PrimaryButton>
          {msg && <span className="text-sm text-[color:var(--text-muted)]">{msg}</span>}
        </div>
      )}
    </SectionPage>
  );
}

// ── Chart of accounts ───────────────────────────────────────────────────────
export function ChartOfAccounts() {
  const { token, user } = useAuth();
  const [key, setKey] = useState(0);
  return (
    <CrudPage
      key={key}
      title="Chart of accounts"
      subtitle="Your own account codes and names. Accounts with postings can be deactivated, not deleted."
      endpoint="/accounts/books/chart"
      managePermissions={[A.chart]}
      allowDelete={false}
      createLabel="New account"
      toolbar={
        canAny(user, A.chart) ? (
          <GhostButton
            onClick={async () => {
              if (!token || !confirm('Load a generic starter chart? Only works while the chart is empty.')) return;
              const r = await api.post('/accounts/books/chart/starter', {}, token);
              if (!r.success) alert(r.message);
              setKey((k) => k + 1);
            }}
          >
            Load starter chart
          </GhostButton>
        ) : null
      }
      columns={[
        { header: 'Code', render: (r) => <span className="font-mono">{String(r.code)}</span> },
        { header: 'Name', render: (r) => String(r.name) },
        { header: 'Type', render: (r) => <StatusPill label={String(r.type)} tone={({ asset: 'blue', liability: 'amber', equity: 'violet', income: 'green', expense: 'red' } as const)[String(r.type) as 'asset'] ?? 'slate'} /> },
        { header: 'Parent', render: (r) => String((r.parentId as Row)?.name ?? '') },
        { header: 'Active', render: (r) => (r.active === false ? 'No' : 'Yes') },
      ]}
      fields={[
        { key: 'code', label: 'Code', required: true },
        { key: 'name', label: 'Name', required: true },
        { key: 'type', label: 'Type', type: 'select', required: true, options: ['asset', 'liability', 'equity', 'income', 'expense'].map((v) => ({ value: v, label: v })) },
        { key: 'parentId', label: 'Parent account', type: 'select', optionsFrom: { endpoint: '/accounts/books/chart', label: 'name' } },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'active', label: 'Active', type: 'checkbox', defaultValue: true },
      ]}
    />
  );
}

// ── Journals ────────────────────────────────────────────────────────────────
export function Journals() {
  const { token, user } = useAuth();
  const manage = canAny(user, A.journalManage);
  const [source, setSource] = useState('');
  const list = useData<{ data: Row[]; total: number }>(`/accounts/books/journals${source ? `?sourceType=${source}` : ''}`);
  const journals = list.data?.data ?? [];
  const chart = useData<Row[]>('/accounts/books/chart');
  const [entry, setEntry] = useState<Row | null>(null);
  const lines = (entry?.lines as Row[]) ?? [];
  const dr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const cr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const save = async () => {
    if (!token || !entry) return;
    const r = await api.post('/accounts/books/journals', { ...entry, lines: lines.map((l) => ({ ...l, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })) }, token);
    if (!r.success) return alert(r.message);
    setEntry(null);
    list.reload();
  };
  const voidEntry = async (id: string) => {
    if (!token || !confirm('Void this journal entry?')) return;
    const r = await api.post(`/accounts/books/journals/${id}/void`, {}, token);
    if (!r.success) alert(r.message);
    list.reload();
  };
  return (
    <SectionPage
      title="Journal entries"
      subtitle="Automatic postings from invoices, payments, expenses, bills and payroll, plus manual adjustments."
      toolbar={
        <>
          <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-40">
            <option value="">All sources</option>
            {['manual', 'invoice', 'payment', 'expense', 'expense_payment', 'bill', 'bill_payment', 'payroll', 'credit_note', 'bank'].map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
          {manage && <PrimaryButton onClick={() => setEntry({ date: new Date().toISOString().slice(0, 10), memo: '', lines: [{ accountId: '', debit: '', credit: '' }, { accountId: '', debit: '', credit: '' }] })}>Manual entry</PrimaryButton>}
        </>
      }
    >
      <div className="space-y-2">
        {journals.map((j) => (
          <details key={String(j._id)} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-4 py-2.5">
            <summary className="flex cursor-pointer flex-wrap items-center gap-3 text-sm">
              <span className="font-mono text-xs">{String(j.number)}</span>
              <span>{fmtDate(j.date)}</span>
              <span className="flex-1 truncate">{String(j.memo)}</span>
              <StatusPill label={String(j.sourceType)} tone="blue" />
              {j.status === 'void' && <StatusPill label="void" tone="red" />}
              <span className="tabular-nums">{num(((j.lines as Row[]) ?? []).reduce((s, l) => s + Number(l.debit || 0), 0))}</span>
            </summary>
            <table className="mt-2 w-full text-xs">
              <tbody>
                {((j.lines as Row[]) ?? []).map((l, i) => (
                  <tr key={i}>
                    <td className="py-1">{String((l.accountId as Row)?.code ?? '')} {String((l.accountId as Row)?.name ?? '')}</td>
                    <td className="py-1 text-[color:var(--text-muted)]">{String(l.description ?? '')}</td>
                    <td className="py-1 text-right tabular-nums">{Number(l.debit) ? num(l.debit) : ''}</td>
                    <td className="py-1 text-right tabular-nums">{Number(l.credit) ? num(l.credit) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {manage && j.status !== 'void' && (
              <button className="mt-1 text-xs text-rose-500 hover:underline" onClick={() => voidEntry(String(j._id))}>
                Void
              </button>
            )}
          </details>
        ))}
        {list.data && journals.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No entries.</p>}
        {list.error && <p className="text-sm text-rose-500">{list.error}</p>}
      </div>
      {entry && (
        <Modal
          wide
          title="Manual journal entry"
          onClose={() => setEntry(null)}
          footer={
            <>
              <span className={`mr-auto text-sm ${Math.abs(dr - cr) < 0.005 ? 'text-emerald-600' : 'text-rose-500'}`}>
                Dr {num(dr)} · Cr {num(cr)}
              </span>
              <GhostButton onClick={() => setEntry(null)}>Cancel</GhostButton>
              <PrimaryButton disabled={Math.abs(dr - cr) >= 0.005 || dr === 0} onClick={save}>
                Post
              </PrimaryButton>
            </>
          }
        >
          <div className="grid grid-cols-[10rem_1fr] gap-3">
            <Field label="Date">
              <TextInput type="date" value={String(entry.date)} onChange={(e) => setEntry({ ...entry, date: e.target.value })} />
            </Field>
            <Field label="Memo">
              <TextInput value={String(entry.memo)} onChange={(e) => setEntry({ ...entry, memo: e.target.value })} />
            </Field>
          </div>
          {lines.map((l, i) => {
            const upd = (p: Row) => setEntry({ ...entry, lines: lines.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <div key={i} className="grid grid-cols-[1fr_7rem_7rem_auto] gap-2">
                <AccountSelect accounts={chart.data ?? []} value={String(l.accountId)} onChange={(v) => upd({ accountId: v })} />
                <TextInput type="number" step="any" placeholder="Debit" value={String(l.debit)} onChange={(e) => upd({ debit: e.target.value, credit: '' })} />
                <TextInput type="number" step="any" placeholder="Credit" value={String(l.credit)} onChange={(e) => upd({ credit: e.target.value, debit: '' })} />
                <button className="text-rose-500" onClick={() => setEntry({ ...entry, lines: lines.filter((_, j) => j !== i) })}>
                  ✕
                </button>
              </div>
            );
          })}
          <GhostButton onClick={() => setEntry({ ...entry, lines: [...lines, { accountId: '', debit: '', credit: '' }] })}>+ Line</GhostButton>
        </Modal>
      )}
    </SectionPage>
  );
}

// ── Financial statements ─────────────────────────────────────────────────────
function StatementTable({ rows, total, totalLabel }: { rows: Row[]; total?: number; totalLabel?: string }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r) => (
          <tr key={String(r.accountId)} className="border-b border-[color:var(--border-subtle)]">
            <td className="py-1.5 font-mono text-xs w-20">{String(r.code)}</td>
            <td className="py-1.5">{String(r.name)}</td>
            <td className="py-1.5 text-right tabular-nums">{num(r.balance)}</td>
          </tr>
        ))}
        {total !== undefined && (
          <tr className="font-semibold">
            <td />
            <td className="py-1.5">{totalLabel}</td>
            <td className="py-1.5 text-right tabular-nums">{num(total)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function FinancialReports() {
  const today = new Date().toISOString().slice(0, 10);
  const [tab, setTab] = useState<'pl' | 'bs' | 'tb' | 'tax'>('pl');
  const [from, setFrom] = useState(new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const path = { pl: `/accounts/books/reports/profit-loss?from=${from}&to=${to}`, bs: `/accounts/books/reports/balance-sheet?to=${to}`, tb: `/accounts/books/reports/trial-balance?to=${to}`, tax: `/accounts/books/reports/tax?from=${from}&to=${to}` }[tab];
  const { data, error } = useData<Row>(path);
  return (
    <SectionPage
      title="Financial statements"
      subtitle="Generated from posted journal entries."
      toolbar={
        <>
          {(tab === 'pl' || tab === 'tax') && <TextInput type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />}
          <TextInput type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          <GhostButton onClick={() => window.print()}>Print</GhostButton>
        </>
      }
    >
      <div className="flex gap-1 border-b border-[color:var(--border-subtle)]">
        {(
          [
            ['pl', 'Profit & loss'],
            ['bs', 'Balance sheet'],
            ['tb', 'Trial balance'],
            ['tax', 'Tax summary'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? 'border-[color:var(--accent)] font-semibold' : 'border-transparent text-[color:var(--text-muted)]'}`}>
            {l}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-rose-500">{error}</p>}
      {data && tab === 'pl' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Income">
            <StatementTable rows={(data.income as Row[]) ?? []} total={Number(data.totalIncome)} totalLabel="Total income" />
          </Panel>
          <Panel title="Expenses">
            <StatementTable rows={(data.expense as Row[]) ?? []} total={Number(data.totalExpense)} totalLabel="Total expenses" />
          </Panel>
          <Panel>
            <div className="flex justify-between text-lg font-bold">
              <span>Net profit</span>
              <span className={Number(data.netProfit) < 0 ? 'text-rose-500' : 'text-emerald-600'}>{num(data.netProfit)}</span>
            </div>
          </Panel>
        </div>
      )}
      {data && tab === 'bs' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Assets">
            <StatementTable rows={(data.assets as Row[]) ?? []} total={Number(data.totalAssets)} totalLabel="Total assets" />
          </Panel>
          <div className="space-y-4">
            <Panel title="Liabilities">
              <StatementTable rows={(data.liabilities as Row[]) ?? []} total={Number(data.totalLiabilities)} totalLabel="Total liabilities" />
            </Panel>
            <Panel title="Equity">
              <StatementTable rows={[...((data.equity as Row[]) ?? []), { accountId: 'retained', code: '', name: 'Retained earnings (current)', balance: data.retainedEarnings }]} total={Number(data.totalEquity)} totalLabel="Total equity" />
            </Panel>
            <StatusPill label={data.balanced ? 'balanced' : 'out of balance'} tone={data.balanced ? 'green' : 'red'} />
          </div>
        </div>
      )}
      {data && tab === 'tb' && (
        <Panel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-[color:var(--text-muted)]">
                <th className="py-1.5">Code</th>
                <th>Account</th>
                <th className="text-right">Debit</th>
                <th className="text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {((data.rows as Row[]) ?? []).map((r) => (
                <tr key={String(r.accountId)} className="border-b border-[color:var(--border-subtle)]">
                  <td className="py-1.5 font-mono text-xs">{String(r.code)}</td>
                  <td>{String(r.name)}</td>
                  <td className="text-right tabular-nums">{num(r.debit)}</td>
                  <td className="text-right tabular-nums">{num(r.credit)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td />
                <td className="py-1.5">Total</td>
                <td className="text-right tabular-nums">{num(data.totalDebit)}</td>
                <td className="text-right tabular-nums">{num(data.totalCredit)}</td>
              </tr>
            </tbody>
          </table>
        </Panel>
      )}
      {data && tab === 'tax' && (
        <Panel>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-[color:var(--text-muted)]">
                <th className="py-1.5">Rate</th>
                <th className="text-right">Taxable sales</th>
                <th className="text-right">Output tax</th>
                <th className="text-right">Taxable purchases</th>
                <th className="text-right">Input tax</th>
              </tr>
            </thead>
            <tbody>
              {((data.rows as Row[]) ?? []).map((r) => (
                <tr key={String(r.rate)} className="border-b border-[color:var(--border-subtle)]">
                  <td className="py-1.5">{String(r.rate)}%</td>
                  <td className="text-right tabular-nums">{num(r.taxableSales)}</td>
                  <td className="text-right tabular-nums">{num(r.outputTax)}</td>
                  <td className="text-right tabular-nums">{num(r.taxablePurchases)}</td>
                  <td className="text-right tabular-nums">{num(r.inputTax)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-sm">
            <div>Credit-note tax: <b>{num(data.creditNoteTax)}</b></div>
            <div>Output tax: <b>{num(data.outputTax)}</b></div>
            <div>Input tax: <b>{num(data.inputTax)}</b></div>
            <div>Net payable: <b>{num(data.netPayable)}</b></div>
          </div>
        </Panel>
      )}
    </SectionPage>
  );
}

// ── Vendor bills ────────────────────────────────────────────────────────────
export function VendorBills() {
  const { token, user } = useAuth();
  const manage = canAny(user, A.billManage);
  const [status, setStatus] = useState('');
  const list = useData<Row[]>(`/accounts/books/bills${status ? `?status=${status}` : ''}`);
  const vendors = useData<Row[]>(manage ? '/procurement/vendors' : null);
  const pos = useData<Row[]>(manage ? '/procurement/pos' : null);
  const chart = useData<Row[]>(manage ? '/accounts/books/chart' : null);
  const [bill, setBill] = useState<Row | null>(null);
  const lines = (bill?.lines as Row[]) ?? [];
  const act = async (b: Row, body: Row, path = '') => {
    if (!token) return;
    const r = path ? await api.post(`/accounts/books/bills/${b._id}${path}`, body, token) : await api.patch(`/accounts/books/bills/${b._id}`, body, token);
    if (!r.success) alert(r.message);
    list.reload();
  };
  const save = async () => {
    if (!token || !bill) return;
    const r = await api.post('/accounts/books/bills', { ...bill, lines: lines.filter((l) => String(l.description ?? '').trim()).map((l) => ({ ...l, quantity: Number(l.quantity) || 1, unitPrice: Number(l.unitPrice) || 0, taxRate: Number(l.taxRate) || 0, accountId: l.accountId || undefined })) }, token);
    if (!r.success) return alert(r.message);
    setBill(null);
    list.reload();
  };
  const vendorRows = Array.isArray(vendors.data) ? vendors.data : ((vendors.data as unknown as Row)?.items as Row[]) ?? [];
  const poRows = Array.isArray(pos.data) ? pos.data : ((pos.data as unknown as Row)?.items as Row[]) ?? [];
  return (
    <SectionPage
      title="Vendor bills"
      subtitle="Accounts payable: record supplier bills (optionally from a purchase order), approve and pay."
      toolbar={
        <>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-36">
            <option value="">All</option>
            {['draft', 'approved', 'paid', 'void'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          {manage && <PrimaryButton onClick={() => setBill({ vendorAccountId: '', purchaseOrderId: '', billDate: new Date().toISOString().slice(0, 10), dueDate: '', vendorBillRef: '', currency: '', lines: [{ description: '', quantity: 1, unitPrice: '', taxRate: 0, accountId: '' }] })}>New bill</PrimaryButton>}
        </>
      }
    >
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)]">
              {['Number', 'Vendor', 'Bill date', 'Due', 'Total', 'Paid', 'Status', ''].map((h) => (
                <th key={h} className="px-4 py-2.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((b) => (
              <tr key={String(b._id)} className="border-b border-[color:var(--border-subtle)] last:border-0">
                <td className="px-4 py-2.5 font-mono text-xs">{String(b.number)}</td>
                <td className="px-4 py-2.5">{String((b.vendorAccountId as Row)?.name ?? '—')}</td>
                <td className="px-4 py-2.5">{fmtDate(b.billDate)}</td>
                <td className="px-4 py-2.5">{fmtDate(b.dueDate)}</td>
                <td className="px-4 py-2.5 tabular-nums">
                  {String(b.currency)} {num(b.total)}
                </td>
                <td className="px-4 py-2.5 tabular-nums">{num(b.amountPaid)}</td>
                <td className="px-4 py-2.5">
                  <StatusPill label={String(b.status)} tone={({ draft: 'amber', approved: 'blue', paid: 'green', void: 'slate' } as const)[String(b.status) as 'draft'] ?? 'slate'} />
                </td>
                <td className="px-4 py-2.5 text-right space-x-2 whitespace-nowrap text-xs">
                  {manage && b.status === 'draft' && (
                    <button className="text-[color:var(--accent)]" onClick={() => act(b, { status: 'approved' })}>
                      Approve
                    </button>
                  )}
                  {manage && b.status === 'approved' && (
                    <button
                      className="text-emerald-600"
                      onClick={() => {
                        const due = Number(b.total) - Number(b.amountPaid || 0);
                        const amt = Number(prompt('Amount paid', String(due)));
                        if (amt > 0) act(b, { amount: amt }, '/pay');
                      }}
                    >
                      Record payment
                    </button>
                  )}
                  {manage && b.status !== 'void' && b.status !== 'paid' && (
                    <button className="text-rose-500" onClick={() => confirm('Void this bill?') && act(b, { status: 'void' })}>
                      Void
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {list.data?.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-[color:var(--text-muted)]">
                  No bills.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {bill && (
        <Modal
          wide
          title="New vendor bill"
          onClose={() => setBill(null)}
          footer={
            <>
              <GhostButton onClick={() => setBill(null)}>Cancel</GhostButton>
              <PrimaryButton onClick={save}>Save draft</PrimaryButton>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Vendor">
              <Select value={String(bill.vendorAccountId)} onChange={(e) => setBill({ ...bill, vendorAccountId: e.target.value })}>
                <option value="">—</option>
                {vendorRows.map((v) => (
                  <option key={String(v._id)} value={String(v._id)}>
                    {String(v.name)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From purchase order (optional)">
              <Select value={String(bill.purchaseOrderId)} onChange={(e) => setBill({ ...bill, purchaseOrderId: e.target.value, lines: e.target.value ? [] : lines })}>
                <option value="">—</option>
                {poRows.map((p) => (
                  <option key={String(p._id)} value={String(p._id)}>
                    {String(p.poNumber ?? p._id)} · {String((p.vendorAccountId as Row)?.name ?? '')}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Bill date">
              <TextInput type="date" value={String(bill.billDate)} onChange={(e) => setBill({ ...bill, billDate: e.target.value })} />
            </Field>
            <Field label="Due date">
              <TextInput type="date" value={String(bill.dueDate)} onChange={(e) => setBill({ ...bill, dueDate: e.target.value })} />
            </Field>
            <Field label="Vendor's bill number">
              <TextInput value={String(bill.vendorBillRef)} onChange={(e) => setBill({ ...bill, vendorBillRef: e.target.value })} />
            </Field>
            <Field label="Currency (blank = default)">
              <TextInput value={String(bill.currency)} maxLength={3} onChange={(e) => setBill({ ...bill, currency: e.target.value.toUpperCase() })} />
            </Field>
          </div>
          {!bill.purchaseOrderId && (
            <Field label="Lines (description · qty · unit price · tax % · expense account)">
              <div className="space-y-2">
                {lines.map((l, i) => {
                  const upd = (p: Row) => setBill({ ...bill, lines: lines.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                  return (
                    <div key={i} className="grid grid-cols-[1fr_4rem_6rem_4rem_10rem] gap-2">
                      <TextInput value={String(l.description)} onChange={(e) => upd({ description: e.target.value })} />
                      <TextInput type="number" value={String(l.quantity)} onChange={(e) => upd({ quantity: e.target.value })} />
                      <TextInput type="number" step="any" value={String(l.unitPrice)} onChange={(e) => upd({ unitPrice: e.target.value })} />
                      <TextInput type="number" step="any" value={String(l.taxRate)} onChange={(e) => upd({ taxRate: e.target.value })} />
                      <AccountSelect accounts={chart.data ?? []} filter={['expense', 'asset']} value={String(l.accountId)} onChange={(v) => upd({ accountId: v })} />
                    </div>
                  );
                })}
                <GhostButton onClick={() => setBill({ ...bill, lines: [...lines, { description: '', quantity: 1, unitPrice: '', taxRate: 0, accountId: '' }] })}>+ Line</GhostButton>
              </div>
            </Field>
          )}
          <Field label="Notes">
            <TextArea rows={2} value={String(bill.notes ?? '')} onChange={(e) => setBill({ ...bill, notes: e.target.value })} />
          </Field>
        </Modal>
      )}
    </SectionPage>
  );
}

// ── Credit notes ────────────────────────────────────────────────────────────
export function CreditNotes() {
  return (
    <CrudPage
      title="Credit notes"
      subtitle="Reduce what a customer owes on an invoice (refunds, discounts, corrections)."
      endpoint="/accounts/books/credit-notes"
      managePermissions={[A.creditManage]}
      allowDelete={false}
      createLabel="New credit note"
      columns={[
        { header: 'Number', render: (r) => <span className="font-mono text-xs">{String(r.number)}</span> },
        { header: 'Invoice', render: (r) => String((r.invoiceId as Row)?.number ?? '—') },
        { header: 'Date', render: (r) => fmtDate(r.date) },
        { header: 'Amount', render: (r) => `${String(r.currency ?? '')} ${num(r.amount)}` },
        { header: 'Reason', render: (r) => String(r.reason ?? '') },
      ]}
      fields={[
        { key: 'invoiceId', label: 'Invoice', type: 'select', required: true, optionsFrom: { endpoint: '/billing/invoices', label: 'number' } },
        { key: 'amount', label: 'Amount (incl. tax)', type: 'number', required: true },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'reason', label: 'Reason', type: 'textarea' },
      ]}
    />
  );
}

// ── Banking ─────────────────────────────────────────────────────────────────
export function Banking() {
  const { token, user } = useAuth();
  const manage = canAny(user, A.bankManage);
  const banks = useData<Row[]>('/accounts/books/banks');
  const chart = useData<Row[]>('/accounts/books/chart');
  const [bankId, setBankId] = useState('');
  const bank = (banks.data ?? []).find((b) => b._id === bankId) ?? banks.data?.[0];
  const recon = useData<Row[]>(bank ? `/accounts/books/banks/${bank._id}/reconcile` : null);
  const [editBank, setEditBank] = useState<Row | null>(null);
  const [importing, setImporting] = useState(false);
  const [bookAccount, setBookAccount] = useState<Record<string, string>>({});

  const saveBank = async () => {
    if (!token || !editBank) return;
    const body = { name: editBank.name, ledgerAccountId: editBank.ledgerAccountId, currency: editBank.currency, accountNumberLast4: editBank.accountNumberLast4, active: editBank.active !== false };
    const r = editBank._id ? await api.patch(`/accounts/books/banks/${editBank._id}`, body, token) : await api.post('/accounts/books/banks', body, token);
    if (!r.success) return alert(r.message);
    setEditBank(null);
    banks.reload();
  };
  const importCsv = async (file?: File) => {
    if (!token || !file || !bank) return;
    setImporting(true);
    const r = await api.post<Row>(`/accounts/books/banks/${bank._id}/import`, { csv: await file.text() }, token);
    setImporting(false);
    alert(r.success ? `Imported ${r.data?.imported ?? 0}, skipped ${r.data?.duplicates ?? 0} duplicates.` : r.message);
    recon.reload();
  };
  const match = async (t: Row, entryId: string) => {
    if (!token) return;
    const r = await api.post(`/accounts/books/bank-transactions/${t._id}/match`, { entryId }, token);
    if (!r.success) alert(r.message);
    recon.reload();
  };
  const book = async (t: Row) => {
    const accountId = bookAccount[String(t._id)];
    if (!token || !accountId) return alert('Choose the account to book against.');
    const r = await api.post(`/accounts/books/bank-transactions/${t._id}/book`, { accountId }, token);
    if (!r.success) alert(r.message);
    recon.reload();
  };
  return (
    <SectionPage
      title="Banking & reconciliation"
      subtitle="Import bank statements (CSV with date, description and amount or debit/credit columns) and match them to the books."
      toolbar={
        manage && (
          <>
            <GhostButton onClick={() => setEditBank({ name: '', ledgerAccountId: '', currency: '' })}>Add bank account</GhostButton>
            {bank && (
              <label className="btn-primary btn-primary-sm px-4 py-2 rounded-lg text-sm cursor-pointer">
                {importing ? 'Importing…' : 'Import statement CSV'}
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => importCsv(e.target.files?.[0])} />
              </label>
            )}
          </>
        )
      }
    >
      <div className="flex flex-wrap gap-2">
        {(banks.data ?? []).map((b) => (
          <button
            key={String(b._id)}
            onClick={() => setBankId(String(b._id))}
            onDoubleClick={() => manage && setEditBank({ ...b, ledgerAccountId: String((b.ledgerAccountId as Row)?._id ?? b.ledgerAccountId) })}
            className={`rounded-xl border px-3 py-2 text-left text-sm ${bank?._id === b._id ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/10' : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]'}`}
          >
            <div className="font-medium">{String(b.name)}</div>
            <div className="text-[11px] text-[color:var(--text-muted)]">
              {String(b.currency ?? '')} · {String((b.ledgerAccountId as Row)?.name ?? '')}
            </div>
          </button>
        ))}
        {banks.data?.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No bank accounts yet.</p>}
      </div>
      {bank && (
        <Panel title={`Unreconciled · ${(recon.data ?? []).length}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase text-[color:var(--text-muted)]">
                <th className="py-1.5">Date</th>
                <th>Description</th>
                <th className="text-right">Amount</th>
                <th>Match / book</th>
              </tr>
            </thead>
            <tbody>
              {(recon.data ?? []).map((t) => (
                <tr key={String(t._id)} className="border-b border-[color:var(--border-subtle)] align-top">
                  <td className="py-2">{fmtDate(t.date)}</td>
                  <td className="py-2">{String(t.description)}</td>
                  <td className={`py-2 text-right tabular-nums ${Number(t.amount) < 0 ? 'text-rose-500' : 'text-emerald-600'}`}>{num(t.amount)}</td>
                  <td className="py-2 pl-3 space-y-1">
                    {((t.candidates as Row[]) ?? []).map((c) => (
                      <button key={String(c._id)} disabled={!manage} className="block text-xs text-[color:var(--accent)] hover:underline" onClick={() => match(t, String(c._id))}>
                        ✓ {String(c.number)} · {fmtDate(c.date)} · {String(c.memo)}
                      </button>
                    ))}
                    {manage && (
                      <div className="flex gap-1">
                        <AccountSelect accounts={chart.data ?? []} value={bookAccount[String(t._id)] ?? ''} onChange={(v) => setBookAccount({ ...bookAccount, [String(t._id)]: v })} />
                        <GhostButton onClick={() => book(t)}>Book</GhostButton>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {recon.data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-5 text-center text-[color:var(--text-muted)]">
                    All imported transactions are reconciled.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
      )}
      {editBank && (
        <Modal
          title={editBank._id ? 'Edit bank account' : 'Add bank account'}
          onClose={() => setEditBank(null)}
          footer={
            <>
              <GhostButton onClick={() => setEditBank(null)}>Cancel</GhostButton>
              <PrimaryButton onClick={saveBank}>Save</PrimaryButton>
            </>
          }
        >
          <Field label="Name">
            <TextInput value={String(editBank.name ?? '')} onChange={(e) => setEditBank({ ...editBank, name: e.target.value })} />
          </Field>
          <Field label="Ledger account (asset)">
            <AccountSelect accounts={chart.data ?? []} filter={['asset']} value={String(editBank.ledgerAccountId ?? '')} onChange={(v) => setEditBank({ ...editBank, ledgerAccountId: v })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Currency">
              <TextInput value={String(editBank.currency ?? '')} maxLength={3} onChange={(e) => setEditBank({ ...editBank, currency: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Account number (last digits)">
              <TextInput value={String(editBank.accountNumberLast4 ?? '')} maxLength={4} onChange={(e) => setEditBank({ ...editBank, accountNumberLast4: e.target.value })} />
            </Field>
          </div>
        </Modal>
      )}
    </SectionPage>
  );
}
