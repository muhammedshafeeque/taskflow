import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import {
  billingApi,
  coreApi,
  crmApi,
  type BillingTaxRule,
  type CoreCurrency,
  type CrmDeal,
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

function CurrencySelect({
  currencies,
  value,
  onChange,
}: {
  currencies: CoreCurrency[];
  value: string;
  onChange: (code: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  const selected = currencies.find((c) => c.code === value);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = currencies;
    if (!q) return pool.slice(0, 12);
    return pool
      .filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          (c.symbol ?? '').toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [currencies, query]);

  useEffect(() => setHighlight(0), [suggestions, query]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(c: CoreCurrency) {
    onChange(c.code);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(0, suggestions.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter' && suggestions[highlight]) {
      e.preventDefault();
      pick(suggestions[highlight]);
    } else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setQuery('');
        }}
        className="w-full flex items-center justify-between gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm text-left hover:border-[color:var(--accent)]/50"
      >
        <span className="min-w-0 truncate">
          {selected ? (
            <>
              <span className="font-medium">{selected.code}</span>
              <span className="text-[color:var(--text-muted)]">
                {' '}
                · {selected.name}
                {selected.symbol ? ` (${selected.symbol})` : ''}
              </span>
            </>
          ) : (
            <span className="text-[color:var(--text-muted)]">Select currency…</span>
          )}
        </span>
        <span className="text-[color:var(--text-muted)] text-xs shrink-0">▾</span>
      </button>
      {open && (
        <div className="absolute z-40 left-0 right-0 mt-1 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-xl overflow-hidden">
          <input
            autoFocus
            value={query}
            autoComplete="off"
            placeholder="Search code, name, or symbol…"
            className="w-full px-3 py-2 text-sm bg-[color:var(--bg-page)] border-b border-[color:var(--border-subtle)] focus:outline-none"
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
          />
          <ul className="max-h-56 overflow-auto py-1">
            {suggestions.map((c, i) => (
              <li key={c.code}>
                <button
                  type="button"
                  className={
                    i === highlight || c.code === value
                      ? 'w-full text-left px-3 py-2 text-sm bg-[color:var(--accent)]/15'
                      : 'w-full text-left px-3 py-2 text-sm hover:bg-[color:var(--bg-page)]'
                  }
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(c);
                  }}
                >
                  <span className="font-medium tabular-nums">{c.code}</span>
                  <span className="text-[color:var(--text-muted)]">
                    {' '}
                    · {c.name}
                    {c.symbol ? ` · ${c.symbol}` : ''}
                  </span>
                </button>
              </li>
            ))}
            {suggestions.length === 0 && (
              <li className="px-3 py-3 text-sm text-[color:var(--text-muted)]">No currencies match</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function CrmQuoteForm() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.crm.quote.create');
  const canUpdate = canAny(user, 'taskflow.crm.quote.update');

  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [taxRules, setTaxRules] = useState<BillingTaxRule[]>([]);
  const [currencies, setCurrencies] = useState<CoreCurrency[]>(FALLBACK_CURRENCIES);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    dealId: '',
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
      billingApi.listTax(token).catch(() => ({ success: false as const })),
      coreApi.listCurrencies(token, true).catch(() => ({ success: false as const })),
      coreApi.getCompany(token).catch(() => ({ success: false as const })),
    ]).then(([dealsRes, taxRes, currRes, companyRes]) => {
      if (cancelled) return;
      const dealList = dealsRes.success && dealsRes.data ? (dealsRes.data as CrmDeal[]) : [];
      setDeals(dealList);

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
        setForm((f) => ({
          ...f,
          dealId: dealList[0]?._id ?? '',
          currency: companyCurrency || f.currency || 'USD',
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
        if (q.status !== 'draft') {
          setError('Only draft quotations can be edited');
          return;
        }
        const dealId = typeof q.dealId === 'string' ? q.dealId : q.dealId?._id ?? '';
        setForm({
          dealId,
          title: q.title ?? '',
          currency: q.currency || 'USD',
          notes: q.notes ?? '',
          validUntil: q.validUntil ? String(q.validUntil).slice(0, 10) : '',
          discountPercent: q.discountPercent ?? 0,
          taxCode: q.taxCode ?? '',
          defaultHourlyRate: 75,
          defaultTaxRate: q.lineItems?.[0]?.taxRate ?? 0,
          lines:
            (q.lineItems ?? []).length > 0
              ? (q.lineItems ?? []).map((l) => ({
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

  if (isNew && !canCreate) return <Navigate to="/crm/quotes" replace />;
  if (!isNew && !canUpdate) return <Navigate to={`/crm/quotes/${id}`} replace />;

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
    if (!token || !form.dealId) return;
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
      dealId: form.dealId,
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

  if (error && !isNew && form.dealId === '' && !loading) {
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
    'w-full h-9 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 text-sm text-[color:var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30';
  const labelClass = 'block text-[12px] font-medium text-[color:var(--text-muted)] mb-1';

  return (
    <form id="quote-form" onSubmit={handleSubmit} className="min-h-full flex flex-col pb-24 lg:pb-8">
      {/* Sticky top bar */}
      <header className="sticky top-0 z-20 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/90 backdrop-blur-md">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Link
              to="/crm/quotes"
              className="text-[12px] text-[color:var(--text-muted)] hover:text-[color:var(--accent)]"
            >
              ← Quotes
            </Link>
            <h1 className="text-lg font-semibold tracking-tight text-[color:var(--text-primary)]">
              {isNew ? 'New quotation' : 'Edit quotation'}
            </h1>
            <p className="text-[13px] text-[color:var(--text-muted)] truncate">
              Link a deal, add line items, and review totals before saving.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="hidden sm:flex items-center gap-3 mr-2 text-[13px] text-[color:var(--text-muted)]">
              <span className="tabular-nums">{totals.totalHours} hrs</span>
              <span className="text-[color:var(--border-subtle)]">·</span>
              <span className="font-semibold text-[color:var(--text-primary)] tabular-nums">
                {money(totals.total, form.currency)}
              </span>
            </div>
            <Link
              to={isNew ? '/crm/quotes' : `/crm/quotes/${id}`}
              className="h-9 px-3 inline-flex items-center rounded-md border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving || deals.length === 0}
              className="btn-primary h-9 px-4 rounded-md text-sm disabled:opacity-50"
            >
              {saving ? 'Saving…' : isNew ? 'Create quotation' : 'Save quotation'}
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 w-full px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        {deals.length === 0 && (
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm">
            Create a{' '}
            <Link to="/crm/deals" className="underline hover:text-amber-200">
              deal
            </Link>{' '}
            first — quotations must be linked to a CRM deal.
          </div>
        )}

        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-5 items-start">
          <div className="space-y-5 min-w-0">
            {/* Basics */}
            <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-4 sm:p-5">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Quote details</h2>
                <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
                  Who this is for, currency, validity, and default pricing.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <label className="block sm:col-span-2 lg:col-span-2">
                  <span className={labelClass}>Deal</span>
                  <select
                    required
                    value={form.dealId}
                    onChange={(e) => {
                      setForm((f) => ({
                        ...f,
                        dealId: e.target.value,
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
                </label>
                <label className="block sm:col-span-2 lg:col-span-2">
                  <span className={labelClass}>Title</span>
                  <input
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    className={inputClass}
                    placeholder="e.g. Phase 1 delivery quotation"
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Currency</span>
                  <CurrencySelect
                    currencies={currencies}
                    value={form.currency}
                    onChange={(code) => setForm((f) => ({ ...f, currency: code }))}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Valid until</span>
                  <input
                    type="date"
                    value={form.validUntil}
                    onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className={labelClass}>Default hourly rate</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.defaultHourlyRate}
                    onChange={(e) => {
                      const rate = Number(e.target.value) || 0;
                      setForm((f) => ({
                        ...f,
                        defaultHourlyRate: rate,
                        lines: f.lines.map((l) =>
                          l.billingType === 'hourly' &&
                          (!l.unitPrice || l.unitPrice === f.defaultHourlyRate)
                            ? { ...l, unitPrice: rate }
                            : l
                        ),
                      }));
                    }}
                    className={inputClass}
                  />
                </label>
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
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={form.defaultTaxRate}
                      onChange={(e) => applyTaxToAll(Number(e.target.value) || 0)}
                      className={inputClass}
                      placeholder="Tax %"
                    />
                  )}
                </label>
                <label className="block sm:col-span-2 lg:col-span-1">
                  <span className={labelClass}>Quote discount %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={form.discountPercent}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, discountPercent: Number(e.target.value) || 0 }))
                    }
                    className={inputClass}
                  />
                </label>
              </div>
            </section>

            {/* Line items */}
            <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] overflow-hidden">
              <div className="px-4 sm:px-5 py-4 border-b border-[color:var(--border-subtle)] flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">
                    Line items
                  </h2>
                  <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
                    Features and deliverables — hours, fixed fees, or milestones.
                  </p>
                </div>
                <button
                  type="button"
                  className="h-8 px-3 rounded-md border border-[color:var(--border-subtle)] text-[13px] text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)]"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      lines: [
                        ...f.lines,
                        { ...emptyLine(f.defaultTaxRate), unitPrice: f.defaultHourlyRate },
                      ],
                    }))
                  }
                >
                  + Add line
                </button>
              </div>

              <div className="px-4 sm:px-5 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/40">
                <p className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] mb-2">
                  Quick add
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {FEATURE_PRESETS.map((p) => (
                    <button
                      key={p.description}
                      type="button"
                      onClick={() => addPreset(p)}
                      className="text-[12px] px-2.5 py-1 rounded-md border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:border-[color:var(--accent)] hover:bg-[color:var(--bg-elevated)]"
                    >
                      + {p.description}
                    </button>
                  ))}
                </div>
              </div>

              {/* Desktop table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)]">
                      <th className="px-4 py-2.5 font-medium w-[28%]">Feature</th>
                      <th className="px-2 py-2.5 font-medium w-[12%]">Category</th>
                      <th className="px-2 py-2.5 font-medium w-[10%]">Type</th>
                      <th className="px-2 py-2.5 font-medium w-[9%]">Qty / hrs</th>
                      <th className="px-2 py-2.5 font-medium w-[10%]">Rate</th>
                      <th className="px-2 py-2.5 font-medium w-[8%]">Tax %</th>
                      <th className="px-2 py-2.5 font-medium w-[8%]">Disc %</th>
                      <th className="px-2 py-2.5 font-medium text-right w-[10%]">Amount</th>
                      <th className="px-3 py-2.5 w-[5%]" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.lines.map((line, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-[color:var(--border-subtle)] last:border-0 align-middle"
                      >
                        <td className="px-3 py-2">
                          <input
                            className={inputClass}
                            placeholder="Feature / deliverable"
                            value={line.description}
                            onChange={(e) => updateLine(idx, { description: e.target.value })}
                            required={idx === 0}
                          />
                        </td>
                        <td className="px-1.5 py-2">
                          <select
                            className={inputClass}
                            value={line.category}
                            onChange={(e) => updateLine(idx, { category: e.target.value })}
                          >
                            <option value="">—</option>
                            {CATEGORIES.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1.5 py-2">
                          <select
                            className={inputClass}
                            value={line.billingType}
                            onChange={(e) =>
                              updateLine(idx, { billingType: e.target.value as CrmQuoteBillingType })
                            }
                          >
                            <option value="hourly">Hourly</option>
                            <option value="fixed">Fixed</option>
                            <option value="milestone">Milestone</option>
                          </select>
                        </td>
                        <td className="px-1.5 py-2">
                          <input
                            type="number"
                            min={line.billingType === 'hourly' ? 0.25 : 1}
                            step={line.billingType === 'hourly' ? 0.25 : 1}
                            disabled={line.billingType === 'milestone'}
                            className={`${inputClass} disabled:opacity-50`}
                            value={line.quantity}
                            onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) })}
                            title={qtyLabel(line.billingType)}
                          />
                        </td>
                        <td className="px-1.5 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className={inputClass}
                            value={line.unitPrice}
                            onChange={(e) => updateLine(idx, { unitPrice: Number(e.target.value) })}
                            title={rateLabel(line.billingType)}
                          />
                        </td>
                        <td className="px-1.5 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className={inputClass}
                            value={line.taxRate}
                            onChange={(e) => updateLine(idx, { taxRate: Number(e.target.value) })}
                          />
                        </td>
                        <td className="px-1.5 py-2">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            className={inputClass}
                            value={line.discountPercent}
                            onChange={(e) =>
                              updateLine(idx, { discountPercent: Number(e.target.value) })
                            }
                          />
                        </td>
                        <td className="px-2 py-2 text-right font-medium tabular-nums whitespace-nowrap">
                          {money(lineAmount(line), form.currency)}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            type="button"
                            className="text-[12px] text-red-400 hover:underline disabled:opacity-30"
                            disabled={form.lines.length <= 1}
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                lines: f.lines.filter((_, i) => i !== idx),
                              }))
                            }
                            aria-label="Remove line"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile stacked cards */}
              <div className="lg:hidden divide-y divide-[color:var(--border-subtle)]">
                {form.lines.map((line, idx) => (
                  <div key={idx} className="p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium text-[color:var(--text-muted)]">
                        Line {idx + 1}
                      </span>
                      <button
                        type="button"
                        className="text-[12px] text-red-400 hover:underline disabled:opacity-30"
                        disabled={form.lines.length <= 1}
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            lines: f.lines.filter((_, i) => i !== idx),
                          }))
                        }
                      >
                        Remove
                      </button>
                    </div>
                    <label className="block">
                      <span className={labelClass}>Feature</span>
                      <input
                        className={inputClass}
                        placeholder="Feature / deliverable"
                        value={line.description}
                        onChange={(e) => updateLine(idx, { description: e.target.value })}
                        required={idx === 0}
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className={labelClass}>Category</span>
                        <select
                          className={inputClass}
                          value={line.category}
                          onChange={(e) => updateLine(idx, { category: e.target.value })}
                        >
                          <option value="">—</option>
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className={labelClass}>Type</span>
                        <select
                          className={inputClass}
                          value={line.billingType}
                          onChange={(e) =>
                            updateLine(idx, { billingType: e.target.value as CrmQuoteBillingType })
                          }
                        >
                          <option value="hourly">Hourly</option>
                          <option value="fixed">Fixed</option>
                          <option value="milestone">Milestone</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className={labelClass}>{qtyLabel(line.billingType)}</span>
                        <input
                          type="number"
                          min={line.billingType === 'hourly' ? 0.25 : 1}
                          step={line.billingType === 'hourly' ? 0.25 : 1}
                          disabled={line.billingType === 'milestone'}
                          className={`${inputClass} disabled:opacity-50`}
                          value={line.quantity}
                          onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) })}
                        />
                      </label>
                      <label className="block">
                        <span className={labelClass}>{rateLabel(line.billingType)}</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={inputClass}
                          value={line.unitPrice}
                          onChange={(e) => updateLine(idx, { unitPrice: Number(e.target.value) })}
                        />
                      </label>
                      <label className="block">
                        <span className={labelClass}>Tax %</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className={inputClass}
                          value={line.taxRate}
                          onChange={(e) => updateLine(idx, { taxRate: Number(e.target.value) })}
                        />
                      </label>
                      <label className="block">
                        <span className={labelClass}>Disc %</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.01"
                          className={inputClass}
                          value={line.discountPercent}
                          onChange={(e) =>
                            updateLine(idx, { discountPercent: Number(e.target.value) })
                          }
                        />
                      </label>
                    </div>
                    <div className="flex justify-between text-sm pt-1">
                      <span className="text-[color:var(--text-muted)]">Amount</span>
                      <span className="font-medium tabular-nums">
                        {money(lineAmount(line), form.currency)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Notes */}
            <section className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-4 sm:p-5">
              <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-1">
                Notes / assumptions
              </h2>
              <p className="text-[12px] text-[color:var(--text-muted)] mb-3">
                Scope, out of scope, payment terms — shown on the quotation and PDF.
              </p>
              <textarea
                rows={5}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30"
                placeholder="Scope assumptions, out of scope, payment terms…"
              />
            </section>
          </div>

          {/* Sticky summary */}
          <aside className="xl:sticky xl:top-[4.75rem] space-y-3">
            <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-5 space-y-3">
              <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Summary</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-[color:var(--text-muted)]">
                  <span>Line items</span>
                  <span className="tabular-nums text-[color:var(--text-primary)]">
                    {form.lines.filter((l) => l.description.trim()).length}
                  </span>
                </div>
                <div className="flex justify-between text-[color:var(--text-muted)]">
                  <span>Total hours</span>
                  <span className="tabular-nums text-[color:var(--text-primary)]">
                    {totals.totalHours} hrs
                  </span>
                </div>
                <div className="flex justify-between text-[color:var(--text-muted)]">
                  <span>Subtotal</span>
                  <span className="tabular-nums text-[color:var(--text-primary)]">
                    {money(totals.subtotal, form.currency)}
                  </span>
                </div>
                {totals.discountAmount > 0 && (
                  <div className="flex justify-between text-[color:var(--text-muted)]">
                    <span>Discount ({form.discountPercent}%)</span>
                    <span className="tabular-nums text-[color:var(--text-primary)]">
                      −{money(totals.discountAmount, form.currency)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-[color:var(--text-muted)]">
                  <span>Tax</span>
                  <span className="tabular-nums text-[color:var(--text-primary)]">
                    {money(totals.taxTotal, form.currency)}
                  </span>
                </div>
                <div className="flex justify-between font-semibold text-base pt-3 border-t border-[color:var(--border-subtle)]">
                  <span>Total</span>
                  <span className="tabular-nums">{money(totals.total, form.currency)}</span>
                </div>
              </div>
              <button
                type="submit"
                disabled={saving || deals.length === 0}
                className="btn-primary w-full h-10 rounded-md text-sm disabled:opacity-50 mt-2"
              >
                {saving ? 'Saving…' : isNew ? 'Create quotation' : 'Save quotation'}
              </button>
              <Link
                to={isNew ? '/crm/quotes' : `/crm/quotes/${id}`}
                className="block text-center text-[13px] text-[color:var(--text-muted)] hover:text-[color:var(--accent)]"
              >
                Cancel
              </Link>
            </div>
            <p className="text-[11px] text-[color:var(--text-muted)] px-1 leading-relaxed">
              Totals update as you edit. Tax scales with quote-level discount when applied.
            </p>
          </aside>
        </div>
      </div>

      {/* Mobile sticky save */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-20 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/95 backdrop-blur-md px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-[color:var(--text-muted)]">Total</p>
          <p className="text-sm font-semibold tabular-nums truncate">
            {money(totals.total, form.currency)}
          </p>
        </div>
        <button
          type="submit"
          form="quote-form"
          disabled={saving || deals.length === 0}
          className="btn-primary h-10 px-5 rounded-md text-sm disabled:opacity-50 shrink-0"
        >
          {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
        </button>
      </div>
    </form>
  );
}
