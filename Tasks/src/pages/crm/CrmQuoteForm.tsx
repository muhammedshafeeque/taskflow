import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { CurrencyAutocomplete } from '../../components/CurrencyAutocomplete';
import {
  FiAlertCircle,
  FiArrowLeft,
  FiBriefcase,
  FiCalendar,
  FiCheck,
  FiCopy,
  FiPlus,
  FiTrash2,
  FiUser,
  FiZap,
} from 'react-icons/fi';
import {
  billingApi,
  coreApi,
  crmApi,
  type BillingTaxRule,
  type CoreCurrency,
  type CrmDeal,
  type CrmLead,
  type CrmQuote,
  type CrmQuoteBillingType,
} from '../../lib/api';

type Line = {
  description: string;
  category: string;
  billingType: CrmQuoteBillingType;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  discountPercent: number;
};

const CATEGORIES = ['Frontend', 'Backend', 'Mobile', 'Integration', 'DevOps', 'QA', 'Design', 'Other'];

const FEATURE_PRESETS: Array<{
  description: string;
  category: string;
  billingType: CrmQuoteBillingType;
  quantity: number;
}> = [
  { description: 'User authentication & roles', category: 'Backend', billingType: 'hourly', quantity: 16 },
  { description: 'Dashboard & reporting', category: 'Frontend', billingType: 'hourly', quantity: 24 },
  { description: 'REST / GraphQL API', category: 'Backend', billingType: 'hourly', quantity: 32 },
  { description: 'Third-party integrations', category: 'Integration', billingType: 'hourly', quantity: 20 },
  { description: 'QA & UAT support', category: 'QA', billingType: 'hourly', quantity: 16 },
  { description: 'Go-live & handover', category: 'DevOps', billingType: 'fixed', quantity: 1 },
];

const FALLBACK_CURRENCIES: CoreCurrency[] = [
  { _id: 'USD', code: 'USD', name: 'US Dollar', symbol: '$', decimalDigits: 2, countries: [], isActive: true },
  { _id: 'EUR', code: 'EUR', name: 'Euro', symbol: '€', decimalDigits: 2, countries: [], isActive: true },
  { _id: 'GBP', code: 'GBP', name: 'British Pound', symbol: '£', decimalDigits: 2, countries: [], isActive: true },
  { _id: 'INR', code: 'INR', name: 'Indian Rupee', symbol: '₹', decimalDigits: 2, countries: [], isActive: true },
  { _id: 'AED', code: 'AED', name: 'UAE Dirham', symbol: 'د.إ', decimalDigits: 2, countries: [], isActive: true },
  { _id: 'CAD', code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', decimalDigits: 2, countries: [], isActive: true },
  { _id: 'AUD', code: 'AUD', name: 'Australian Dollar', symbol: 'A$', decimalDigits: 2, countries: [], isActive: true },
];

const BILLING_TYPES: Array<{ value: CrmQuoteBillingType; label: string; short: string; bar: string }> = [
  { value: 'hourly', label: 'Hourly', short: 'Hourly', bar: 'bg-indigo-400' },
  { value: 'fixed', label: 'Fixed fee', short: 'Fixed', bar: 'bg-emerald-400' },
  { value: 'milestone', label: 'Milestone', short: 'Milestone', bar: 'bg-amber-400' },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function emptyLine(taxRate = 0): Line {
  return {
    description: '',
    category: '',
    billingType: 'hourly',
    quantity: 8,
    unitPrice: 0,
    taxRate,
    discountPercent: 0,
  };
}

function lineAmount(line: Line): number {
  const qty = line.billingType === 'milestone' ? 1 : Math.max(0, line.quantity || 0);
  const gross = qty * Math.max(0, line.unitPrice || 0);
  return Math.round(gross * (1 - Math.min(100, Math.max(0, line.discountPercent)) / 100) * 100) / 100;
}

function lineTax(line: Line): number {
  return Math.round(lineAmount(line) * (Math.max(0, line.taxRate) / 100) * 100) / 100;
}

function qtyLabel(type: CrmQuoteBillingType): string {
  if (type === 'hourly') return 'Hours';
  return 'Qty';
}

function rateLabel(type: CrmQuoteBillingType): string {
  if (type === 'hourly') return 'Rate / hr';
  if (type === 'milestone') return 'Milestone fee';
  return 'Unit price';
}

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency}`;
  }
}


export default function CrmQuoteForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.crm.quote.create');
  const canUpdate = canAny(user, 'taskflow.crm.quote.update');

  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [taxRules, setTaxRules] = useState<BillingTaxRule[]>([]);
  const [currencies, setCurrencies] = useState<CoreCurrency[]>(FALLBACK_CURRENCIES);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [linkType, setLinkType] = useState<'deal' | 'lead'>(
    searchParams.get('leadId') ? 'lead' : 'deal'
  );
  const [form, setForm] = useState({
    dealId: searchParams.get('dealId') ?? '',
    leadId: searchParams.get('leadId') ?? '',
    title: '',
    currency: 'USD',
    notes: '',
    validUntil: '',
    discountPercent: 0,
    taxCode: '',
    defaultHourlyRate: 75,
    defaultTaxRate: 0,
    lines: [emptyLine()] as Line[],
  });

  const totals = useMemo(() => {
    const subtotal = Math.round(form.lines.reduce((s, l) => s + lineAmount(l), 0) * 100) / 100;
    const discountAmount =
      Math.round(subtotal * (Math.min(100, Math.max(0, form.discountPercent)) / 100) * 100) / 100;
    const afterDiscount = Math.round((subtotal - discountAmount) * 100) / 100;
    const scale = subtotal > 0 ? afterDiscount / subtotal : 1;
    const taxTotal = Math.round(form.lines.reduce((s, l) => s + lineTax(l) * scale, 0) * 100) / 100;
    const totalHours = form.lines
      .filter((l) => l.billingType === 'hourly')
      .reduce((s, l) => s + (Number(l.quantity) || 0), 0);
    return {
      subtotal,
      discountAmount,
      taxTotal,
      total: Math.round((afterDiscount + taxTotal) * 100) / 100,
      totalHours,
    };
  }, [form.lines, form.discountPercent]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    Promise.all([
      crmApi.listDeals(token),
      crmApi.listLeads(token, { limit: 200 }).catch(() => ({ success: false as const })),
      billingApi.listTax(token).catch(() => ({ success: false as const })),
      coreApi.listCurrencies(token, true).catch(() => ({ success: false as const })),
      coreApi.getCompany(token).catch(() => ({ success: false as const })),
    ]).then(([dealsRes, leadsRes, taxRes, currRes, companyRes]) => {
      if (cancelled) return;
      const dealList = dealsRes.success && dealsRes.data ? (dealsRes.data as CrmDeal[]) : [];
      setDeals(dealList);
      let leadList: CrmLead[] = [];
      if (leadsRes.success && leadsRes.data) {
        const raw = leadsRes.data as CrmLead[] | { data: CrmLead[] };
        leadList = Array.isArray(raw) ? raw : raw.data ?? [];
      }
      setLeads(leadList);

      let defTax = 0;
      let defCode = '';
      if (taxRes.success && taxRes.data) {
        const rules = (taxRes.data as BillingTaxRule[]).filter((r) => r.enabled);
        setTaxRules(rules);
        if (rules[0]) {
          defTax = rules[0].rate;
          defCode = rules[0].code;
        }
      }

      if (currRes.success && currRes.data && Array.isArray(currRes.data) && currRes.data.length > 0) {
        setCurrencies(currRes.data as CoreCurrency[]);
      }

      const companyCurrency =
        companyRes.success && companyRes.data && 'baseCurrencyCode' in companyRes.data
          ? String((companyRes.data as { baseCurrencyCode?: string }).baseCurrencyCode || '').toUpperCase()
          : '';

      if (isNew) {
        const prefLead = searchParams.get('leadId');
        const prefDeal = searchParams.get('dealId');
        const useLead = Boolean(prefLead) || (!prefDeal && dealList.length === 0 && leadList.length > 0);
        setLinkType(useLead ? 'lead' : 'deal');
        setForm((f) => ({
          ...f,
          dealId: prefDeal || (!useLead ? dealList[0]?._id ?? '' : ''),
          leadId: prefLead || (useLead ? leadList[0]?._id ?? '' : ''),
          currency:
            (useLead
              ? leadList.find((l) => l._id === (prefLead || leadList[0]?._id))?.currency
              : dealList.find((d) => d._id === (prefDeal || dealList[0]?._id))?.currency) ||
            companyCurrency ||
            f.currency ||
            'USD',
          defaultTaxRate: defTax || f.defaultTaxRate,
          taxCode: defCode || f.taxCode,
          lines: f.lines.map((l) => ({
            ...l,
            taxRate: l.taxRate || defTax,
            unitPrice: l.unitPrice || f.defaultHourlyRate,
          })),
        }));
      }
    });

    if (!isNew && id) {
      setLoading(true);
      crmApi.getQuote(id, token).then((res) => {
        if (cancelled) return;
        setLoading(false);
        if (!res.success || !res.data) {
          setError((res as { message?: string }).message ?? 'Quotation not found');
          return;
        }
        const q = res.data as CrmQuote;
        if (q.status !== 'draft' && q.status !== 'sent') {
          setError('Only draft or sent quotations can be edited (until accepted)');
          return;
        }
        const dealId = typeof q.dealId === 'string' ? q.dealId : q.dealId?._id ?? '';
        const leadId = typeof q.leadId === 'string' ? q.leadId : q.leadId?._id ?? '';
        setLinkType(leadId && !dealId ? 'lead' : 'deal');
        const quoteLines = q.lineItems ?? [];
        const hourlyRates = quoteLines
          .filter((l) => (l.billingType ?? 'hourly') === 'hourly' && (l.unitPrice ?? 0) > 0)
          .map((l) => l.unitPrice);
        // Prefer the most common hourly rate on this quote; else first hourly rate; else keep 75.
        let inferredHourly = 75;
        if (hourlyRates.length > 0) {
          const counts = new Map<number, number>();
          for (const r of hourlyRates) counts.set(r, (counts.get(r) ?? 0) + 1);
          inferredHourly = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
        }
        setForm({
          dealId,
          leadId,
          title: q.title ?? '',
          currency: q.currency || 'USD',
          notes: q.notes ?? '',
          validUntil: q.validUntil ? String(q.validUntil).slice(0, 10) : '',
          discountPercent: q.discountPercent ?? 0,
          taxCode: q.taxCode ?? '',
          defaultHourlyRate: inferredHourly,
          defaultTaxRate: quoteLines[0]?.taxRate ?? 0,
          lines:
            quoteLines.length > 0
              ? quoteLines.map((l) => ({
                  description: l.description,
                  category: l.category ?? '',
                  billingType: l.billingType ?? 'hourly',
                  quantity: l.quantity,
                  unitPrice: l.unitPrice,
                  taxRate: l.taxRate ?? 0,
                  discountPercent: l.discountPercent ?? 0,
                }))
              : [emptyLine()],
        });
      });
    }

    return () => {
      cancelled = true;
    };
  }, [token, id, isNew]);

  const focusNewLineRef = useRef(false);

  useEffect(() => {
    if (!focusNewLineRef.current) return;
    focusNewLineRef.current = false;
    const inputs = document.querySelectorAll<HTMLInputElement>('[data-quote-line-desc]');
    const last = inputs[inputs.length - 1];
    last?.focus();
  }, [form.lines.length]);

  if (isNew && !canCreate) return <Navigate to="/crm/quotes" replace />;
  if (!isNew && !canUpdate) return <Navigate to={`/crm/quotes/${id}`} replace />;

  function addLine() {
    focusNewLineRef.current = true;
    setForm((f) => ({
      ...f,
      lines: [...f.lines, { ...emptyLine(f.defaultTaxRate), unitPrice: f.defaultHourlyRate }],
    }));
  }

  function onLineKeyDown(e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addLine();
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    setForm((f) => {
      const lines = [...f.lines];
      const next = { ...lines[idx], ...patch };
      if (patch.billingType === 'milestone') next.quantity = 1;
      if (patch.billingType === 'hourly' && lines[idx].billingType !== 'hourly' && !next.unitPrice) {
        next.unitPrice = f.defaultHourlyRate;
      }
      lines[idx] = next;
      return { ...f, lines };
    });
  }

  function applyTaxToAll(rate: number, code?: string) {
    setForm((f) => ({
      ...f,
      defaultTaxRate: rate,
      taxCode: code ?? f.taxCode,
      lines: f.lines.map((l) => ({ ...l, taxRate: rate })),
    }));
  }

  function addPreset(preset: (typeof FEATURE_PRESETS)[number]) {
    setForm((f) => ({
      ...f,
      lines: [
        ...f.lines.filter((l) => l.description.trim()),
        {
          description: preset.description,
          category: preset.category,
          billingType: preset.billingType,
          quantity: preset.quantity,
          unitPrice:
            preset.billingType === 'hourly' ? f.defaultHourlyRate : f.defaultHourlyRate * preset.quantity,
          taxRate: f.defaultTaxRate,
          discountPercent: 0,
        },
      ],
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (linkType === 'deal' && !form.dealId) {
      setError('Select a deal for this quotation');
      return;
    }
    if (linkType === 'lead' && !form.leadId) {
      setError('Select a lead for this quotation');
      return;
    }
    const lineItems = form.lines
      .filter((l) => l.description.trim())
      .map((l) => ({
        description: l.description.trim(),
        category: l.category.trim() || undefined,
        quantity: l.billingType === 'milestone' ? 1 : l.quantity,
        unitPrice: l.unitPrice,
        billingType: l.billingType,
        taxRate: l.taxRate,
        discountPercent: l.discountPercent,
      }));
    if (lineItems.length === 0) {
      setError('Add at least one feature / line item');
      return;
    }
    setSaving(true);
    setError('');
    const payload = {
      dealId: linkType === 'deal' ? form.dealId || undefined : undefined,
      leadId: linkType === 'lead' ? form.leadId || undefined : undefined,
      title: form.title.trim() || undefined,
      currency: form.currency,
      notes: form.notes.trim() || undefined,
      validUntil: form.validUntil || undefined,
      discountPercent: form.discountPercent,
      taxCode: form.taxCode || undefined,
      lineItems,
    };
    try {
      if (isNew) {
        const res = await crmApi.createQuote(payload, token);
        setSaving(false);
        if (res.success && res.data) {
          const created = res.data as CrmQuote;
          navigate(`/crm/quotes/${created._id}`);
        } else {
          setError((res as { message?: string }).message ?? 'Failed to create quotation');
        }
      } else if (id) {
        const res = await crmApi.updateQuote(id, payload, token);
        setSaving(false);
        if (res.success) navigate(`/crm/quotes/${id}`);
        else setError((res as { message?: string }).message ?? 'Failed to update quotation');
      }
    } catch {
      setSaving(false);
      setError('Request failed');
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-sm text-[color:var(--text-muted)]">Loading quotation…</p>
      </div>
    );
  }

  if (error && !isNew && form.dealId === '' && form.leadId === '' && !loading) {
    return (
      <div className="p-8 space-y-3">
        <p className="text-sm text-red-400">{error}</p>
        <Link to="/crm/quotes" className="text-sm text-[color:var(--accent)] hover:underline">
          ← Back to quotes
        </Link>
      </div>
    );
  }

  const inputClass =
    'w-full h-9 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 text-sm text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)]/60 focus:outline-none focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20 transition-colors';
  const labelClass = 'block text-[12px] font-medium text-[color:var(--text-muted)] mb-1.5';
  const cancelTo = isNew ? '/crm/quotes' : `/crm/quotes/${id}`;
  const noParents = deals.length === 0 && leads.length === 0;
  const filledLines = form.lines.filter((l) => l.description.trim()).length;
  const selectedDeal = deals.find((d) => d._id === form.dealId);
  const selectedLead = leads.find((l) => l._id === form.leadId);
  const mix = BILLING_TYPES.map((t) => ({
    ...t,
    amount: form.lines.filter((l) => l.billingType === t.value).reduce((s, l) => s + lineAmount(l), 0),
  }));
  const daysLeft = form.validUntil
    ? Math.ceil((new Date(form.validUntil).getTime() - new Date(todayIso()).getTime()) / 86_400_000)
    : null;

  function removeLine(idx: number) {
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  }

  function duplicateLine(idx: number) {
    setForm((f) => {
      const lines = [...f.lines];
      lines.splice(idx + 1, 0, { ...lines[idx] });
      return { ...f, lines };
    });
  }

  return (
    <form id="quote-form" onSubmit={handleSubmit} className="min-h-full flex flex-col pb-24 xl:pb-10">
      {/* Sticky top bar */}
      <header className="sticky top-0 z-20 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/85 backdrop-blur-md">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <Link
              to={cancelTo}
              aria-label="Back"
              className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-lg border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)]"
            >
              <FiArrowLeft />
            </Link>
            <div className="min-w-0">
              <p className="text-[12px] text-[color:var(--text-muted)]">
                <Link to="/crm/quotes" className="hover:text-[color:var(--accent)]">
                  Quotes
                </Link>
                <span className="mx-1.5">/</span>
                {isNew ? 'New' : 'Edit'}
              </p>
              <h1 className="text-base sm:text-lg font-semibold tracking-tight text-[color:var(--text-primary)] truncate">
                {form.title.trim() || (isNew ? 'New quotation' : 'Edit quotation')}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden md:flex flex-col items-end mr-2 leading-tight">
              <span className="text-[11px] text-[color:var(--text-muted)]">Total due</span>
              <span className="text-sm font-semibold text-[color:var(--text-primary)] tabular-nums">
                {money(totals.total, form.currency)}
              </span>
            </div>
            <Link
              to={cancelTo}
              className="hidden sm:inline-flex h-9 px-3 items-center rounded-lg border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving || noParents}
              className="btn-primary h-9 px-4 rounded-lg text-sm inline-flex items-center gap-2 disabled:opacity-50"
            >
              <FiCheck />
              {saving ? 'Saving…' : isNew ? 'Create quotation' : 'Save changes'}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        {noParents && (
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm">
            <FiAlertCircle className="mt-0.5 shrink-0" />
            <span>
              Create a{' '}
              <Link to="/crm/leads" className="underline hover:text-amber-200">
                lead
              </Link>{' '}
              or{' '}
              <Link to="/crm/deals" className="underline hover:text-amber-200">
                deal
              </Link>{' '}
              first — quotations must be linked to one of them.
            </span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            <FiAlertCircle className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
          <div className="space-y-5 min-w-0">
            {/* 1 · Customer */}
            <Section step={1} title="Customer" hint="Who this quotation is for and what it covers.">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <span className={labelClass}>Link to</span>
                  <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
                    {(
                      [
                        { key: 'deal', label: 'Deal', icon: <FiBriefcase />, count: deals.length },
                        { key: 'lead', label: 'Lead', icon: <FiUser />, count: leads.length },
                      ] as const
                    ).map((opt) => {
                      const active = linkType === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => setLinkType(opt.key)}
                          className={`h-10 px-3 rounded-lg border text-sm inline-flex items-center gap-2 transition-colors ${
                            active
                              ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/10 text-[color:var(--text-primary)]'
                              : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
                          }`}
                        >
                          <span className={active ? 'text-[color:var(--accent)]' : ''}>{opt.icon}</span>
                          {opt.label}
                          <span className="ml-auto text-[11px] tabular-nums opacity-70">{opt.count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {linkType === 'deal' ? (
                  <label className="block">
                    <span className={labelClass}>Deal</span>
                    <select
                      required
                      value={form.dealId}
                      onChange={(e) => {
                        const deal = deals.find((d) => d._id === e.target.value);
                        setForm((f) => ({
                          ...f,
                          dealId: e.target.value,
                          currency: deal?.currency || f.currency,
                        }));
                      }}
                      className={inputClass}
                    >
                      <option value="">Select deal…</option>
                      {deals.map((d) => (
                        <option key={d._id} value={d._id}>
                          {d.title}
                          {d.currency ? ` (${d.currency})` : ''}
                        </option>
                      ))}
                    </select>
                    {selectedDeal && (
                      <span className="mt-1.5 block text-[12px] text-[color:var(--text-muted)]">
                        {selectedDeal.value ? `Deal value ${money(selectedDeal.value, selectedDeal.currency || form.currency)}` : 'Deal selected'}
                      </span>
                    )}
                  </label>
                ) : (
                  <label className="block">
                    <span className={labelClass}>Lead</span>
                    <select
                      required
                      value={form.leadId}
                      onChange={(e) => {
                        const lead = leads.find((l) => l._id === e.target.value);
                        setForm((f) => ({
                          ...f,
                          leadId: e.target.value,
                          currency: lead?.currency || f.currency,
                          title: f.title || (lead ? `Quote — ${lead.title}` : f.title),
                        }));
                      }}
                      className={inputClass}
                    >
                      <option value="">Select lead…</option>
                      {leads.map((l) => (
                        <option key={l._id} value={l._id}>
                          {l.title}
                          {l.companyName ? ` — ${l.companyName}` : ''}
                          {l.status ? ` (${l.status})` : ''}
                        </option>
                      ))}
                    </select>
                    {selectedLead && (selectedLead.companyName || selectedLead.contactName) && (
                      <span className="mt-1.5 block text-[12px] text-[color:var(--text-muted)] truncate">
                        {[selectedLead.companyName, selectedLead.contactName, selectedLead.contactEmail]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </label>
                )}
                <label className="block">
                  <span className={labelClass}>Quotation title</span>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    className={inputClass}
                    placeholder="e.g. Phase 1 delivery quotation"
                  />
                </label>
              </div>
            </Section>

            {/* 2 · Terms & pricing */}
            <Section step={2} title="Terms & pricing" hint="Currency, validity and defaults applied to new lines.">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <label className="block">
                  <span className={labelClass}>Currency</span>
                  <CurrencyAutocomplete
                    currencies={currencies}
                    value={form.currency}
                    onChange={(code) => setForm((f) => ({ ...f, currency: code }))}
                  />
                </label>
                <div className="block">
                  <span className={labelClass}>Valid until</span>
                  <input
                    type="date"
                    value={form.validUntil}
                    onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
                    className={inputClass}
                  />
                  <div className="mt-1.5 flex gap-1.5">
                    {[7, 15, 30].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setForm((f) => ({ ...f, validUntil: addDaysIso(d) }))}
                        className="text-[11px] px-2 py-0.5 rounded-md border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:border-[color:var(--accent)]"
                      >
                        +{d}d
                      </button>
                    ))}
                  </div>
                </div>
                <label className="block">
                  <span className={labelClass}>Quote discount</span>
                  <Adorned suffix="%">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={form.discountPercent}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, discountPercent: Number(e.target.value) || 0 }))
                      }
                      className={`${inputClass} pr-8`}
                    />
                  </Adorned>
                </label>
                <div className="block">
                  <span className={labelClass}>Default hourly rate</span>
                  <div className="flex gap-2">
                    <Adorned suffix={`${form.currency}/h`}>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={form.defaultHourlyRate}
                        onChange={(e) => {
                          const rate = Number(e.target.value) || 0;
                          setForm((f) => ({ ...f, defaultHourlyRate: rate }));
                        }}
                        className={`${inputClass} pr-16`}
                      />
                    </Adorned>
                    <button
                      type="button"
                      title="Set this rate on every hourly line"
                      className="shrink-0 h-9 px-3 rounded-lg border border-[color:var(--border-subtle)] text-[12px] text-[color:var(--text-primary)] hover:border-[color:var(--accent)] whitespace-nowrap"
                      onClick={() => {
                        const rate = Number(form.defaultHourlyRate) || 0;
                        setForm((f) => ({
                          ...f,
                          defaultHourlyRate: rate,
                          lines: f.lines.map((l) =>
                            l.billingType === 'hourly' ? { ...l, unitPrice: rate } : l
                          ),
                        }));
                      }}
                    >
                      Apply to all
                    </button>
                  </div>
                </div>
                <label className="block">
                  <span className={labelClass}>Tax</span>
                  {taxRules.length > 0 ? (
                    <select
                      value={form.taxCode}
                      onChange={(e) => {
                        const rule = taxRules.find((r) => r.code === e.target.value);
                        if (rule) applyTaxToAll(rule.rate, rule.code);
                        else setForm((f) => ({ ...f, taxCode: e.target.value }));
                      }}
                      className={inputClass}
                    >
                      <option value="">Custom / none</option>
                      {taxRules.map((r) => (
                        <option key={r._id} value={r.code}>
                          {r.name} ({r.rate}%)
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Adorned suffix="%">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={form.defaultTaxRate}
                        onChange={(e) => applyTaxToAll(Number(e.target.value) || 0)}
                        className={`${inputClass} pr-8`}
                        placeholder="Tax"
                      />
                    </Adorned>
                  )}
                  <span className="mt-1.5 block text-[11px] text-[color:var(--text-muted)]">
                    Applies to all lines; override per line below.
                  </span>
                </label>
              </div>
            </Section>

            {/* 3 · Line items */}
            <Section
              step={3}
              title="Line items"
              hint="Features and deliverables — hourly, fixed fee or milestone. Press Enter to add a line."
              aside={
                <span className="text-[12px] text-[color:var(--text-muted)] tabular-nums">
                  {filledLines} item{filledLines === 1 ? '' : 's'} · {totals.totalHours} hrs
                </span>
              }
              flush
            >
              <div className="px-4 sm:px-5 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/40 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] mr-1">
                  <FiZap /> Quick add
                </span>
                {FEATURE_PRESETS.map((p) => (
                  <button
                    key={p.description}
                    type="button"
                    onClick={() => addPreset(p)}
                    className="text-[12px] px-2.5 py-1 rounded-full border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:border-[color:var(--accent)] hover:bg-[color:var(--accent)]/5"
                  >
                    + {p.description}
                  </button>
                ))}
              </div>

              <ol className="divide-y divide-[color:var(--border-subtle)]">
                {form.lines.map((line, idx) => (
                  <li key={idx} className="group px-4 sm:px-5 py-4 hover:bg-[color:var(--bg-page)]/30 transition-colors">
                    <div className="flex items-start gap-3">
                      <span className="mt-1.5 h-6 w-6 shrink-0 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[11px] font-semibold text-[color:var(--text-muted)] inline-flex items-center justify-center tabular-nums">
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0 space-y-3">
                        <div className="flex items-start gap-3">
                          <input
                            data-quote-line-desc
                            className="flex-1 min-w-0 h-9 bg-transparent border-0 border-b border-transparent px-0 text-[15px] font-medium text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)]/60 focus:outline-none focus:border-[color:var(--accent)] hover:border-[color:var(--border-subtle)]"
                            placeholder="Feature or deliverable…"
                            value={line.description}
                            onChange={(e) => updateLine(idx, { description: e.target.value })}
                            onKeyDown={onLineKeyDown}
                            required={idx === 0}
                          />
                          <div className="text-right shrink-0 pt-1">
                            <p className="text-[15px] font-semibold tabular-nums text-[color:var(--text-primary)]">
                              {money(lineAmount(line), form.currency)}
                            </p>
                            {line.taxRate > 0 && (
                              <p className="text-[11px] text-[color:var(--text-muted)] tabular-nums">
                                + {money(lineTax(line), form.currency)} tax
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-[150px_auto_minmax(80px,1fr)_minmax(110px,1.3fr)_minmax(72px,0.8fr)_minmax(72px,0.8fr)] gap-2 items-end">
                          <MiniField label="Category">
                            <select
                              className={inputClass}
                              value={line.category}
                              onChange={(e) => updateLine(idx, { category: e.target.value })}
                              onKeyDown={onLineKeyDown}
                            >
                              <option value="">—</option>
                              {CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </MiniField>
                          <MiniField label="Billing">
                            <div className="flex h-9 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-0.5">
                              {BILLING_TYPES.map((t) => (
                                <button
                                  key={t.value}
                                  type="button"
                                  title={t.label}
                                  onClick={() => updateLine(idx, { billingType: t.value })}
                                  className={`flex-1 px-2.5 rounded-md text-[12px] whitespace-nowrap transition-colors ${
                                    line.billingType === t.value
                                      ? 'bg-[color:var(--accent)] text-white'
                                      : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
                                  }`}
                                >
                                  {t.short}
                                </button>
                              ))}
                            </div>
                          </MiniField>
                          <MiniField label={qtyLabel(line.billingType)}>
                            <input
                              type="number"
                              min={line.billingType === 'hourly' ? 0.25 : 1}
                              step={line.billingType === 'hourly' ? 0.25 : 1}
                              disabled={line.billingType === 'milestone'}
                              className={`${inputClass} disabled:opacity-50`}
                              value={line.quantity}
                              onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) })}
                              onKeyDown={onLineKeyDown}
                            />
                          </MiniField>
                          <MiniField label={rateLabel(line.billingType)}>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              className={inputClass}
                              value={line.unitPrice}
                              onChange={(e) => updateLine(idx, { unitPrice: Number(e.target.value) })}
                              onKeyDown={onLineKeyDown}
                            />
                          </MiniField>
                          <MiniField label="Tax %">
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              className={inputClass}
                              value={line.taxRate}
                              onChange={(e) => updateLine(idx, { taxRate: Number(e.target.value) })}
                              onKeyDown={onLineKeyDown}
                            />
                          </MiniField>
                          <MiniField label="Disc %">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step="0.01"
                              className={inputClass}
                              value={line.discountPercent}
                              onChange={(e) => updateLine(idx, { discountPercent: Number(e.target.value) })}
                              onKeyDown={onLineKeyDown}
                            />
                          </MiniField>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 pt-1 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 transition-opacity">
                        <button
                          type="button"
                          title="Duplicate line"
                          aria-label="Duplicate line"
                          onClick={() => duplicateLine(idx)}
                          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)]"
                        >
                          <FiCopy size={14} />
                        </button>
                        <button
                          type="button"
                          title="Remove line"
                          aria-label="Remove line"
                          disabled={form.lines.length <= 1}
                          onClick={() => removeLine(idx)}
                          className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[color:var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 disabled:opacity-30 disabled:pointer-events-none"
                        >
                          <FiTrash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>

              <button
                type="button"
                onClick={addLine}
                className="w-full px-4 sm:px-5 py-3.5 border-t border-dashed border-[color:var(--border-subtle)] text-[13px] font-medium text-[color:var(--accent)] hover:bg-[color:var(--accent)]/5 inline-flex items-center justify-center gap-2"
              >
                <FiPlus /> Add line item
              </button>
            </Section>

            {/* 4 · Notes */}
            <Section
              step={4}
              title="Notes & terms"
              hint="Scope, exclusions, payment terms — printed on the quotation PDF."
            >
              <textarea
                rows={6}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2.5 text-sm leading-relaxed text-[color:var(--text-primary)] resize-y placeholder:text-[color:var(--text-muted)]/60 focus:outline-none focus:border-[color:var(--accent)] focus:ring-2 focus:ring-[color:var(--accent)]/20"
                placeholder={'Payment terms…\nIn scope / out of scope…\nAssumptions…'}
              />
              <p className="mt-1.5 text-[11px] text-[color:var(--text-muted)]">
                Each line is printed as its own paragraph.
              </p>
            </Section>
          </div>

          {/* Live summary */}
          <aside className="xl:sticky xl:top-[5.25rem] space-y-3">
            <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] overflow-hidden">
              <div className="relative p-5 bg-gradient-to-br from-[color:var(--accent)]/20 via-[color:var(--accent)]/5 to-transparent border-b border-[color:var(--border-subtle)]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--text-muted)]">
                    Total due
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-muted)]">
                    {form.currency}
                  </span>
                </div>
                <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums text-[color:var(--text-primary)] break-all">
                  {money(totals.total, form.currency)}
                </p>
                <p className="mt-1 text-[12px] text-[color:var(--text-muted)] inline-flex items-center gap-1.5">
                  <FiCalendar size={12} />
                  {daysLeft == null
                    ? 'No validity date set'
                    : daysLeft < 0
                      ? 'Validity date is in the past'
                      : `Valid for ${daysLeft} day${daysLeft === 1 ? '' : 's'}`}
                </p>
              </div>

              <div className="p-5 space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Items" value={String(filledLines)} />
                  <Stat label="Hours" value={String(totals.totalHours)} />
                  <Stat
                    label="Avg / hr"
                    value={
                      totals.totalHours > 0
                        ? money(mix[0].amount / totals.totalHours, form.currency)
                        : '—'
                    }
                  />
                </div>

                {totals.subtotal > 0 && (
                  <div>
                    <div className="flex h-2 rounded-full overflow-hidden bg-[color:var(--bg-page)]">
                      {mix.map((m) =>
                        m.amount > 0 ? (
                          <div
                            key={m.value}
                            className={m.bar}
                            style={{ width: `${(m.amount / totals.subtotal) * 100}%` }}
                          />
                        ) : null
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[color:var(--text-muted)]">
                      {mix
                        .filter((m) => m.amount > 0)
                        .map((m) => (
                          <span key={m.value} className="inline-flex items-center gap-1.5">
                            <span className={`h-2 w-2 rounded-full ${m.bar}`} />
                            {m.label} {Math.round((m.amount / totals.subtotal) * 100)}%
                          </span>
                        ))}
                    </div>
                  </div>
                )}

                <dl className="space-y-2 text-sm">
                  <Row label="Subtotal" value={money(totals.subtotal, form.currency)} />
                  {totals.discountAmount > 0 && (
                    <Row
                      label={`Discount (${form.discountPercent}%)`}
                      value={`−${money(totals.discountAmount, form.currency)}`}
                      tone="text-emerald-400"
                    />
                  )}
                  <Row
                    label={`Tax${form.taxCode ? ` (${form.taxCode})` : ''}`}
                    value={money(totals.taxTotal, form.currency)}
                  />
                  <div className="flex justify-between items-baseline pt-3 border-t border-[color:var(--border-subtle)]">
                    <dt className="font-semibold text-[color:var(--text-primary)]">Total</dt>
                    <dd className="font-semibold text-base tabular-nums text-[color:var(--text-primary)]">
                      {money(totals.total, form.currency)}
                    </dd>
                  </div>
                </dl>

                <button
                  type="submit"
                  disabled={saving || noParents}
                  className="btn-primary w-full h-10 rounded-lg text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <FiCheck />
                  {saving ? 'Saving…' : isNew ? 'Create quotation' : 'Save changes'}
                </button>
                <Link
                  to={cancelTo}
                  className="block text-center text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--accent)]"
                >
                  Cancel
                </Link>
              </div>
            </div>
            <p className="text-[11px] text-[color:var(--text-muted)] px-1 leading-relaxed">
              Totals update as you edit. Tax scales with the quote-level discount. After saving you
              can download the PDF or email it from the quotation page.
            </p>
          </aside>
        </div>
      </div>

      {/* Mobile sticky save */}
      <div className="xl:hidden fixed bottom-0 inset-x-0 z-20 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/95 backdrop-blur-md px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-[color:var(--text-muted)]">
            Total · {filledLines} item{filledLines === 1 ? '' : 's'}
          </p>
          <p className="text-base font-semibold tabular-nums truncate">
            {money(totals.total, form.currency)}
          </p>
        </div>
        <button
          type="submit"
          form="quote-form"
          disabled={saving || noParents}
          className="btn-primary h-10 px-5 rounded-lg text-sm disabled:opacity-50 shrink-0"
        >
          {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function Section({
  step,
  title,
  hint,
  aside,
  flush,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  aside?: React.ReactNode;
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] overflow-hidden">
      <div className="px-4 sm:px-5 py-4 flex items-start gap-3 border-b border-[color:var(--border-subtle)]">
        <span className="h-7 w-7 shrink-0 rounded-full bg-[color:var(--accent)]/15 text-[color:var(--accent)] text-[13px] font-semibold inline-flex items-center justify-center">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">{title}</h2>
          {hint && <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">{hint}</p>}
        </div>
        {aside && <div className="shrink-0 pt-1">{aside}</div>}
      </div>
      {flush ? children : <div className="p-4 sm:p-5">{children}</div>}
    </section>
  );
}

function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="block text-[10px] font-medium uppercase tracking-wide text-[color:var(--text-muted)] mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

function Adorned({ suffix, children }: { suffix: string; children: React.ReactNode }) {
  return (
    <div className="relative flex-1 min-w-0">
      {children}
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-[color:var(--text-muted)]">
        {suffix}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] px-2.5 py-2 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-[color:var(--text-muted)]">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-[color:var(--text-primary)] truncate">{value}</p>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[color:var(--text-muted)]">{label}</dt>
      <dd className={`tabular-nums ${tone ?? 'text-[color:var(--text-primary)]'}`}>{value}</dd>
    </div>
  );
}
