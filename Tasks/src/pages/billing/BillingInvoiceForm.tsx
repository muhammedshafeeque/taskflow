import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { CurrencyAutocomplete } from '../../components/CurrencyAutocomplete';
import InvoiceLineEditor from '../../components/billing/InvoiceLineEditor';
import {
  billingApi,
  contractsApi,
  coreApi,
  crmApi,
  projectsApi,
  type BillingInvoice,
  type BillingTaxRule,
  type CoreCurrency,
  type CrmAccount,
  type CrmContract,
  type Project,
} from '../../lib/api';
import {
  emptyInvoiceLine,
  invoiceTotals,
  lineFromApi,
  linesToPayload,
  type InvoiceLineDraft,
} from '../../lib/billingLineUtils';
import { buildInvoicePdf, downloadInvoicePdf } from '../../lib/invoicePdf';
import { ModuleLoader } from '../../components/loaders/ModuleLoader';

const inputClass =
  'w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm';

function refId(ref?: string | { _id: string }): string {
  if (!ref) return '';
  return typeof ref === 'string' ? ref : ref._id;
}

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}

export default function BillingInvoiceForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const [searchParams] = useSearchParams();
  const { token } = useAuth();
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState<CrmAccount[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [contracts, setContracts] = useState<CrmContract[]>([]);
  const [taxRules, setTaxRules] = useState<BillingTaxRule[]>([]);
  const [currencies, setCurrencies] = useState<CoreCurrency[]>([]);
  const [companyName, setCompanyName] = useState('');
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [header, setHeader] = useState({
    accountId: searchParams.get('accountId') ?? '',
    projectId: searchParams.get('projectId') ?? '',
    contractId: '',
    currency: 'USD',
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    paymentTerms: 'Net 30',
    poNumber: '',
    servicePeriodStart: searchParams.get('from')?.slice(0, 10) ?? '',
    servicePeriodEnd: searchParams.get('to')?.slice(0, 10) ?? '',
    notes: '',
    taxCode: '',
  });
  const [lines, setLines] = useState<InvoiceLineDraft[]>([]);

  const defaultTax = taxRules.find((t) => t.enabled)?.rate ?? 0;
  const totals = useMemo(() => invoiceTotals(lines), [lines]);

  useEffect(() => {
    if (!token) return;
    crmApi.listAccounts(token, { limit: 100 }).then((res) => {
      if (res.success && res.data) {
        const raw = res.data as CrmAccount[] | { data: CrmAccount[] };
        const list = Array.isArray(raw) ? raw : raw.data ?? [];
        setAccounts(list);
        if (!header.accountId && list[0]) setHeader((h) => ({ ...h, accountId: list[0]._id }));
      }
    });
    projectsApi.list(1, 200, token).then((res) => {
      if (res.success && res.data) setProjects(res.data.data ?? []);
    });
    billingApi.listTax(token).then((res) => {
      if (res.success && res.data) {
        const rules = res.data as BillingTaxRule[];
        setTaxRules(rules);
        const def = rules.find((r) => r.enabled);
        if (def) setHeader((h) => ({ ...h, taxCode: def.code }));
      }
    });
    coreApi.listCurrencies(token, true).then((res) => {
      if (res.success && res.data) setCurrencies(res.data as CoreCurrency[]);
    });
    coreApi.getCompany(token).then((res) => {
      if (res.success && res.data) setCompanyName((res.data as { companyName?: string }).companyName ?? '');
    });
  }, [token]);

  useEffect(() => {
    if (!token || !header.accountId) return;
    contractsApi.list(token, { accountId: header.accountId }).then((res) => {
      if (res.success && res.data) setContracts(res.data as CrmContract[]);
    });
  }, [token, header.accountId]);

  useEffect(() => {
    if (!token || !isEdit || !id) return;
    setLoading(true);
    billingApi.getInvoice(id, token).then((res) => {
      setLoading(false);
      if (!res.success || !res.data) {
        setError((res as { message?: string }).message ?? 'Invoice not found');
        return;
      }
      const inv = res.data as BillingInvoice;
      if (inv.status !== 'draft') {
        navigate(`/billing/invoices/${id}`, { replace: true });
        return;
      }
      setHeader({
        accountId: refId(inv.accountId),
        projectId: refId(inv.projectId as string | { _id: string }),
        contractId: refId(inv.contractId as string | { _id: string }),
        currency: inv.currency ?? 'USD',
        issueDate: inv.issueDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
        dueDate: inv.dueDate?.slice(0, 10) ?? '',
        paymentTerms: inv.paymentTerms ?? 'Net 30',
        poNumber: inv.poNumber ?? '',
        servicePeriodStart: inv.servicePeriodStart?.slice(0, 10) ?? '',
        servicePeriodEnd: inv.servicePeriodEnd?.slice(0, 10) ?? '',
        notes: inv.notes ?? '',
        taxCode: inv.taxCode ?? '',
      });
      setLines((inv.lines ?? []).map((l) => lineFromApi(l)));
    });
  }, [token, id, isEdit, navigate]);

  useEffect(() => {
    const projectId = searchParams.get('projectId');
    const hours = searchParams.get('hours');
    const rate = searchParams.get('rate');
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const accountId = searchParams.get('accountId');
    if (isEdit || !projectId || lines.length > 0) return;

    const project = projects.find((p) => p._id === projectId);
    const h = hours ? Number(hours) : 0;
    const r = rate ? Number(rate) : 0;
    if (h > 0) {
      setHeader((prev) => ({
        ...prev,
        accountId: accountId ?? prev.accountId,
        projectId,
        servicePeriodStart: from?.slice(0, 10) ?? prev.servicePeriodStart,
        servicePeriodEnd: to?.slice(0, 10) ?? prev.servicePeriodEnd,
      }));
      setLines([
        {
          ...emptyInvoiceLine(defaultTax),
          description: project
            ? `Development services — ${project.name}`
            : 'Development services',
          category: 'Backend',
          billingType: 'hourly',
          quantity: h,
          unitPrice: r,
          periodStart: from?.slice(0, 10) ?? '',
          periodEnd: to?.slice(0, 10) ?? '',
        },
      ]);
    } else if (lines.length === 0) {
      setLines([emptyInvoiceLine(defaultTax)]);
    }
  }, [searchParams, projects, isEdit, defaultTax, lines.length]);

  useEffect(() => {
    if (!isEdit && lines.length === 0 && !searchParams.get('projectId')) {
      setLines([emptyInvoiceLine(defaultTax)]);
    }
  }, [defaultTax, isEdit, lines.length, searchParams]);

  async function save(andPdf = false) {
    if (!token) return;
    const payload = linesToPayload(lines);
    if (!header.accountId || payload.length === 0) {
      setError('Account and at least one line item are required.');
      return;
    }
    setSaving(true);
    setError('');
    const body: Record<string, unknown> = {
      accountId: header.accountId,
      projectId: header.projectId || undefined,
      contractId: header.contractId || undefined,
      currency: header.currency,
      issueDate: header.issueDate,
      dueDate: header.dueDate || undefined,
      paymentTerms: header.paymentTerms || undefined,
      poNumber: header.poNumber || undefined,
      servicePeriodStart: header.servicePeriodStart || undefined,
      servicePeriodEnd: header.servicePeriodEnd || undefined,
      notes: header.notes.trim() || undefined,
      taxCode: header.taxCode || undefined,
      lines: payload,
      workLogIds: searchParams.get('workLogIds')?.split(',').filter(Boolean) || undefined,
    };

    const res = isEdit && id
      ? await billingApi.updateInvoice(id, body, token)
      : await billingApi.createInvoice(body, token);

    setSaving(false);
    if (!res.success || !res.data) {
      setError((res as { message?: string }).message ?? 'Save failed');
      return;
    }
    const inv = res.data as BillingInvoice;
    if (andPdf) {
      const pdf = buildInvoicePdf(inv, companyName);
      downloadInvoicePdf(pdf, inv.number);
    }
    navigate(`/billing/invoices/${inv._id}`);
  }

  if (loading) {
    return <ModuleLoader label="Loading invoice…" />;
  }

  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 max-w-6xl space-y-6">
      <div>
        <Link to="/billing/invoices" className="text-xs text-[color:var(--accent)] hover:underline">
          ← Invoices
        </Link>
        <h1 className="text-xl font-semibold mt-1">{isEdit ? 'Edit draft invoice' : 'New IT service invoice'}</h1>
        <p className="text-[13px] text-[color:var(--text-muted)]">
          Bill time & materials, retainers, AMC, milestones, and expenses with service periods.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 space-y-4">
        <h2 className="text-sm font-semibold">Invoice details</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block text-xs text-[color:var(--text-muted)]">
            Account
            <select
              className={`mt-1 ${inputClass}`}
              value={header.accountId}
              onChange={(e) => setHeader((h) => ({ ...h, accountId: e.target.value, contractId: '' }))}
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
            Project
            <select
              className={`mt-1 ${inputClass}`}
              value={header.projectId}
              onChange={(e) => setHeader((h) => ({ ...h, projectId: e.target.value }))}
            >
              <option value="">Optional</option>
              {projects.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} ({p.key})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[color:var(--text-muted)]">
            Contract
            <select
              className={`mt-1 ${inputClass}`}
              value={header.contractId}
              onChange={(e) => setHeader((h) => ({ ...h, contractId: e.target.value }))}
            >
              <option value="">Optional</option>
              {contracts.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-[color:var(--text-muted)]">
            Currency
            <div className="mt-1">
              <CurrencyAutocomplete
                value={header.currency}
                onChange={(code) => setHeader((h) => ({ ...h, currency: code }))}
                currencies={currencies}
              />
            </div>
          </label>
          <label className="block text-xs text-[color:var(--text-muted)]">
            Issue date
            <input
              type="date"
              className={`mt-1 ${inputClass}`}
              value={header.issueDate}
              onChange={(e) => setHeader((h) => ({ ...h, issueDate: e.target.value }))}
              required
            />
          </label>
          <label className="block text-xs text-[color:var(--text-muted)]">
            Due date
            <input
              type="date"
              className={`mt-1 ${inputClass}`}
              value={header.dueDate}
              onChange={(e) => setHeader((h) => ({ ...h, dueDate: e.target.value }))}
            />
          </label>
          <label className="block text-xs text-[color:var(--text-muted)]">
            Payment terms
            <input
              className={`mt-1 ${inputClass}`}
              value={header.paymentTerms}
              onChange={(e) => setHeader((h) => ({ ...h, paymentTerms: e.target.value }))}
              placeholder="Net 30"
            />
          </label>
          <label className="block text-xs text-[color:var(--text-muted)]">
            PO number
            <input
              className={`mt-1 ${inputClass}`}
              value={header.poNumber}
              onChange={(e) => setHeader((h) => ({ ...h, poNumber: e.target.value }))}
            />
          </label>
          <label className="block text-xs text-[color:var(--text-muted)]">
            Service period from
            <input
              type="date"
              className={`mt-1 ${inputClass}`}
              value={header.servicePeriodStart}
              onChange={(e) => setHeader((h) => ({ ...h, servicePeriodStart: e.target.value }))}
            />
          </label>
          <label className="block text-xs text-[color:var(--text-muted)]">
            Service period to
            <input
              type="date"
              className={`mt-1 ${inputClass}`}
              value={header.servicePeriodEnd}
              onChange={(e) => setHeader((h) => ({ ...h, servicePeriodEnd: e.target.value }))}
            />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
        <InvoiceLineEditor lines={lines} onChange={setLines} currency={header.currency} defaultTaxRate={defaultTax} />
        <div className="mt-4 flex flex-col items-end gap-1 text-sm">
          <div className="text-[color:var(--text-muted)]">
            Subtotal <span className="text-[color:var(--text-primary)] tabular-nums ml-2">{money(totals.subtotal, header.currency)}</span>
          </div>
          <div className="text-[color:var(--text-muted)]">
            Tax <span className="text-[color:var(--text-primary)] tabular-nums ml-2">{money(totals.taxTotal, header.currency)}</span>
          </div>
          <div className="font-semibold text-base">
            Total <span className="tabular-nums ml-2">{money(totals.total, header.currency)}</span>
          </div>
        </div>
      </section>

      <label className="block text-xs text-[color:var(--text-muted)]">
        Notes / payment instructions
        <textarea
          className={`mt-1 ${inputClass} min-h-[80px]`}
          value={header.notes}
          onChange={(e) => setHeader((h) => ({ ...h, notes: e.target.value }))}
          placeholder="Bank details, payment instructions, scope notes…"
        />
      </label>

      <div className="flex flex-wrap gap-3 justify-end">
        <Link to="/billing/invoices" className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">
          Cancel
        </Link>
        <button type="button" disabled={saving} className="btn-primary px-4 py-2 rounded-lg text-sm" onClick={() => void save(false)}>
          {saving ? 'Saving…' : 'Save draft'}
        </button>
        <button type="button" disabled={saving} className="btn-primary px-4 py-2 rounded-lg text-sm" onClick={() => void save(true)}>
          Save & download PDF
        </button>
      </div>
    </div>
  );
}
