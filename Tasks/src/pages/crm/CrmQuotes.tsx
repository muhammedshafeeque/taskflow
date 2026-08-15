import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, type CrmAccount, type CrmDeal, type CrmQuote } from '../../lib/api';
import { formatDateDDMMYYYY } from '../../lib/dateFormat';

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const;

type SuggestItem = { id: string; label: string; hint?: string };

type QuoteFilters = {
  titleQuery: string;
  titleId: string;
  dealQuery: string;
  dealId: string;
  accountQuery: string;
  accountId: string;
  status: string;
};

const EMPTY_FILTERS: QuoteFilters = {
  titleQuery: '',
  titleId: '',
  dealQuery: '',
  dealId: '',
  accountQuery: '',
  accountId: '',
  status: '',
};

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

function statusClass(status: string): string {
  switch (status) {
    case 'accepted':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'sent':
      return 'bg-sky-500/15 text-sky-400 border-sky-500/30';
    case 'rejected':
    case 'expired':
      return 'bg-red-500/15 text-red-400 border-red-500/30';
    default:
      return 'bg-[color:var(--bg-page)] text-[color:var(--text-muted)] border-[color:var(--border-subtle)]';
  }
}

function dealIdOf(q: CrmQuote): string {
  if (!q.dealId) return '';
  return typeof q.dealId === 'string' ? q.dealId : q.dealId._id;
}

function accountIdOf(q: CrmQuote): string {
  if (!q.accountId) return '';
  return typeof q.accountId === 'string' ? q.accountId : q.accountId._id ?? '';
}

function dealTitle(q: CrmQuote, dealsById: Map<string, CrmDeal>): string {
  if (q.dealId && typeof q.dealId === 'object' && q.dealId.title) return q.dealId.title;
  const id = dealIdOf(q);
  return dealsById.get(id)?.title ?? '—';
}

function accountName(
  q: CrmQuote,
  accountsById: Map<string, CrmAccount>,
  dealsById: Map<string, CrmDeal>
): string {
  if (q.accountId && typeof q.accountId === 'object' && q.accountId.name) return q.accountId.name;
  const aid = accountIdOf(q);
  if (aid && accountsById.has(aid)) return accountsById.get(aid)!.name;
  const deal = dealsById.get(dealIdOf(q));
  if (deal?.accountId) {
    if (typeof deal.accountId === 'object' && deal.accountId.name) return deal.accountId.name;
    if (typeof deal.accountId === 'string' && accountsById.has(deal.accountId)) {
      return accountsById.get(deal.accountId)!.name;
    }
  }
  return '—';
}

function hoursOf(q: CrmQuote): number {
  return (q.lineItems ?? [])
    .filter((l) => l.billingType === 'hourly')
    .reduce((s, l) => s + (l.quantity || 0), 0);
}

function FieldLabel({ children }: { children: string }) {
  return <span className="block text-[11px] font-medium text-[color:var(--text-muted)] mb-1">{children}</span>;
}

const inputClass =
  'h-8 w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2.5 text-[13px] text-[color:var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30';

function FilterAutocomplete({
  label,
  placeholder,
  query,
  onQueryChange,
  selectedId,
  onPick,
  onClear,
  items,
  emptyText = 'No matches',
}: {
  label: string;
  placeholder: string;
  query: string;
  onQueryChange: (value: string) => void;
  selectedId: string;
  onPick: (item: SuggestItem) => void;
  onClear: () => void;
  items: SuggestItem[];
  emptyText?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = items;
    if (!q) return pool.slice(0, 12);
    return pool
      .map((item) => {
        const labelText = item.label.toLowerCase();
        const hint = (item.hint ?? '').toLowerCase();
        let score = -1;
        if (labelText === q) score = 100;
        else if (labelText.startsWith(q)) score = 80;
        else if (labelText.includes(q)) score = 50;
        else if (hint.includes(q)) score = 30;
        return { item, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
      .slice(0, 12)
      .map((x) => x.item);
  }, [items, query]);

  useEffect(() => setHighlight(0), [suggestions, query]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(item: SuggestItem) {
    onPick(item);
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
    <div ref={rootRef} className="relative min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <div className="relative">
        <input
          value={query}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          placeholder={placeholder}
          className={`${inputClass} ${selectedId || query ? 'pr-8' : ''}`}
          onChange={(e) => {
            onQueryChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {(selectedId || query) && (
          <button
            type="button"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 rounded text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
            aria-label={`Clear ${label}`}
            onClick={() => {
              onClear();
              setOpen(false);
            }}
          >
            ✕
          </button>
        )}
      </div>
      {open && (
        <ul
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-lg py-1"
        >
          {suggestions.map((item, i) => (
            <li key={item.id} role="option" aria-selected={i === highlight || item.id === selectedId}>
              <button
                type="button"
                className={
                  i === highlight || item.id === selectedId
                    ? 'w-full text-left px-2.5 py-1.5 text-[12px] bg-[color:var(--accent)]/15'
                    : 'w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-[color:var(--bg-page)]'
                }
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(item);
                }}
              >
                <span className="font-medium text-[color:var(--text-primary)]">{item.label}</span>
                {item.hint ? (
                  <span className="block text-[11px] text-[color:var(--text-muted)] truncate">{item.hint}</span>
                ) : null}
              </button>
            </li>
          ))}
          {suggestions.length === 0 && (
            <li className="px-2.5 py-2 text-[12px] text-[color:var(--text-muted)]">{emptyText}</li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function CrmQuotes() {
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.crm.quote.create');
  const canUpdate = canAny(user, 'taskflow.crm.quote.update');
  const canDelete = canAny(user, 'taskflow.crm.quote.delete');

  const [quotes, setQuotes] = useState<CrmQuote[]>([]);
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [accounts, setAccounts] = useState<CrmAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState<QuoteFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<QuoteFilters>(EMPTY_FILTERS);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [sendFor, setSendFor] = useState<string | null>(null);
  const [sendEmail, setSendEmail] = useState('');
  const [sendBusy, setSendBusy] = useState(false);

  const load = () => {
    if (!token) return;
    setLoading(true);
    crmApi.listQuotes(token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setQuotes(res.data as CrmQuote[]);
    });
  };

  useEffect(() => {
    load();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    crmApi.listDeals(token).then((res) => {
      if (res.success && res.data) setDeals(res.data as CrmDeal[]);
    });
    crmApi.listAccounts(token).then((res) => {
      if (res.success && res.data) {
        const payload = res.data as { data?: CrmAccount[] } | CrmAccount[];
        setAccounts(Array.isArray(payload) ? payload : (payload.data ?? []));
      }
    });
  }, [token]);

  const dealsById = useMemo(() => new Map(deals.map((d) => [d._id, d])), [deals]);
  const accountsById = useMemo(() => new Map(accounts.map((a) => [a._id, a])), [accounts]);

  const titleItems = useMemo<SuggestItem[]>(() => {
    const seen = new Map<string, SuggestItem>();
    for (const q of quotes) {
      const title = (q.title || '').trim();
      if (!title) continue;
      const key = title.toLowerCase();
      if (!seen.has(key)) seen.set(key, { id: key, label: title });
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [quotes]);

  const dealItems = useMemo<SuggestItem[]>(
    () =>
      deals.map((d) => {
        const acc =
          typeof d.accountId === 'object' && d.accountId?.name
            ? d.accountId.name
            : typeof d.accountId === 'string'
              ? accountsById.get(d.accountId)?.name
              : undefined;
        return { id: d._id, label: d.title, hint: acc };
      }),
    [deals, accountsById]
  );

  const accountItems = useMemo<SuggestItem[]>(
    () =>
      accounts.map((a) => ({
        id: a._id,
        label: a.name,
        hint: a.type ? a.type : undefined,
      })),
    [accounts]
  );

  const filtered = useMemo(() => {
    const titleQ = applied.titleQuery.trim().toLowerCase();
    return quotes.filter((quote) => {
      if (applied.status && quote.status !== applied.status) return false;

      if (applied.dealId && dealIdOf(quote) !== applied.dealId) return false;

      if (applied.accountId) {
        const qAid = accountIdOf(quote);
        if (qAid) {
          if (qAid !== applied.accountId) return false;
        } else {
          const deal = dealsById.get(dealIdOf(quote));
          const dealAid =
            typeof deal?.accountId === 'string'
              ? deal.accountId
              : deal?.accountId && typeof deal.accountId === 'object'
                ? deal.accountId._id
                : '';
          if (dealAid !== applied.accountId) return false;
        }
      }

      if (applied.titleId) {
        if ((quote.title || '').trim().toLowerCase() !== applied.titleId) return false;
      } else if (titleQ) {
        if (!(quote.title || '').toLowerCase().includes(titleQ)) return false;
      }

      return true;
    });
  }, [quotes, applied, dealsById]);

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function applyFilters(e?: FormEvent) {
    e?.preventDefault();
    setApplied({ ...draft });
    setPage(1);
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  const hasFilters = Boolean(
    applied.titleQuery || applied.titleId || applied.dealId || applied.accountId || applied.status
  );

  async function send(id: string) {
    if (!token || !sendEmail.trim()) return;
    setSendBusy(true);
    await crmApi.sendQuote(id, sendEmail.trim(), token);
    setSendBusy(false);
    setSendFor(null);
    setSendEmail('');
    load();
  }

  async function setStatus(id: string, status: string) {
    if (!token || !canUpdate) return;
    await crmApi.updateQuote(id, { status }, token);
    load();
  }

  async function remove(id: string) {
    if (!token || !canDelete) return;
    if (!confirm('Delete draft quotation?')) return;
    await crmApi.deleteQuote(id, token);
    load();
  }

  return (
    <div className="p-4 sm:p-6 w-full space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--text-primary)]">Quotes</h1>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
            Software quotations with features, hours, rates, and tax.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1 text-[11px] text-[color:var(--text-muted)]">
            {quotes.length} total
          </span>
          {canCreate && (
            <Link
              to="/crm/quotes/new"
              className={`btn-primary h-8 px-3.5 rounded-md text-[12px] font-medium inline-flex items-center ${
                deals.length === 0 ? 'pointer-events-none opacity-50' : ''
              }`}
              aria-disabled={deals.length === 0}
              title={deals.length === 0 ? 'Create a deal first' : undefined}
            >
              New quotation
            </Link>
          )}
        </div>
      </div>

      {canCreate && deals.length === 0 && (
        <p className="text-sm text-amber-300/90">
          Create a{' '}
          <Link to="/crm/deals" className="underline hover:text-amber-200">
            deal
          </Link>{' '}
          before adding a quotation.
        </p>
      )}

      <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
        <form
          onSubmit={applyFilters}
          className="px-3 sm:px-4 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/35"
        >
          <div className="mb-2.5">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
              Search &amp; filter
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <FilterAutocomplete
              label="Title"
              placeholder="Type title…"
              query={draft.titleQuery}
              selectedId={draft.titleId}
              items={titleItems}
              onQueryChange={(value) => setDraft((d) => ({ ...d, titleQuery: value, titleId: '' }))}
              onPick={(item) => setDraft((d) => ({ ...d, titleQuery: item.label, titleId: item.id }))}
              onClear={() => setDraft((d) => ({ ...d, titleQuery: '', titleId: '' }))}
              emptyText="No titles match"
            />

            <FilterAutocomplete
              label="Deal"
              placeholder="Type deal…"
              query={draft.dealQuery}
              selectedId={draft.dealId}
              items={dealItems}
              onQueryChange={(value) => setDraft((d) => ({ ...d, dealQuery: value, dealId: '' }))}
              onPick={(item) => setDraft((d) => ({ ...d, dealQuery: item.label, dealId: item.id }))}
              onClear={() => setDraft((d) => ({ ...d, dealQuery: '', dealId: '' }))}
              emptyText="No deals match"
            />

            <label className="block min-w-0">
              <FieldLabel>Status</FieldLabel>
              <select
                value={draft.status}
                onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}
                className={inputClass}
              >
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </label>

            <FilterAutocomplete
              label="Customer / company"
              placeholder="Type account…"
              query={draft.accountQuery}
              selectedId={draft.accountId}
              items={accountItems}
              onQueryChange={(value) =>
                setDraft((d) => ({ ...d, accountQuery: value, accountId: '' }))
              }
              onPick={(item) =>
                setDraft((d) => ({ ...d, accountQuery: item.label, accountId: item.id }))
              }
              onClear={() => setDraft((d) => ({ ...d, accountQuery: '', accountId: '' }))}
              emptyText="No accounts match"
            />
          </div>

          <div className="flex flex-wrap justify-end gap-1.5 mt-3">
            <button
              type="button"
              onClick={clearFilters}
              className="h-8 px-3 rounded-md text-[12px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)]"
            >
              Clear
            </button>
            <button type="submit" className="btn-primary h-8 px-3.5 rounded-md text-[12px] font-medium">
              Search
            </button>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 border-b border-[color:var(--border-subtle)]">
          <p className="text-[12px] text-[color:var(--text-muted)]">
            {loading
              ? 'Loading…'
              : total === 0
                ? hasFilters
                  ? 'No matches'
                  : 'No quotations yet.'
                : `Showing ${from}–${to} of ${total}`}
          </p>
          <label className="flex items-center gap-1.5 text-[12px] text-[color:var(--text-muted)]">
            <span>Rows</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="h-7 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-1.5 text-[12px]"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-[color:var(--bg-page)]/50 text-left text-[10px] uppercase tracking-wider text-[color:var(--text-muted)]">
                <th className="px-3 py-2.5 font-semibold">Title</th>
                <th className="px-3 py-2.5 font-semibold">Deal</th>
                <th className="px-3 py-2.5 font-semibold">Customer</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-3 py-2.5 font-semibold text-right">Total</th>
                <th className="px-3 py-2.5 font-semibold text-right">Hours</th>
                <th className="px-3 py-2.5 font-semibold text-right">Lines</th>
                <th className="px-3 py-2.5 font-semibold">Valid until</th>
                <th className="px-3 py-2.5 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((q) => {
                const displayTotal = q.total ?? q.subtotal;
                const hours = hoursOf(q);
                return (
                  <tr
                    key={q._id}
                    className="border-t border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-page)]/40"
                  >
                    <td className="px-3 py-2.5 align-middle min-w-0">
                      <Link
                        to={`/crm/quotes/${q._id}`}
                        className="font-medium text-[color:var(--accent)] hover:underline truncate block max-w-[16rem]"
                      >
                        {q.title || 'Untitled'}
                      </Link>
                      <span className="text-[11px] text-[color:var(--text-muted)]">{q.currency}</span>
                    </td>
                    <td className="px-3 py-2.5 align-middle text-[color:var(--text-muted)] truncate max-w-[12rem]">
                      {dealTitle(q, dealsById)}
                    </td>
                    <td className="px-3 py-2.5 align-middle text-[color:var(--text-muted)] truncate max-w-[12rem]">
                      {accountName(q, accountsById, dealsById)}
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <span
                        className={`inline-flex capitalize text-[11px] px-2 py-0.5 rounded-md border ${statusClass(q.status)}`}
                      >
                        {q.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-middle text-right tabular-nums font-medium whitespace-nowrap">
                      {money(displayTotal, q.currency)}
                    </td>
                    <td className="px-3 py-2.5 align-middle text-right tabular-nums text-[color:var(--text-muted)]">
                      {hours > 0 ? hours : '—'}
                    </td>
                    <td className="px-3 py-2.5 align-middle text-right tabular-nums text-[color:var(--text-muted)]">
                      {q.lineItems?.length ?? 0}
                    </td>
                    <td className="px-3 py-2.5 align-middle text-[color:var(--text-muted)] whitespace-nowrap">
                      {q.validUntil ? formatDateDDMMYYYY(q.validUntil) : '—'}
                    </td>
                    <td className="px-3 py-2.5 align-middle text-right">
                      <div className="inline-flex flex-wrap justify-end gap-x-2 gap-y-1 text-[12px]">
                        <Link to={`/crm/quotes/${q._id}`} className="text-[color:var(--accent)] hover:underline">
                          View
                        </Link>
                        {q.status === 'draft' && canUpdate && (
                          <Link
                            to={`/crm/quotes/${q._id}/edit`}
                            className="text-[color:var(--accent)] hover:underline"
                          >
                            Edit
                          </Link>
                        )}
                        {q.status === 'draft' && canUpdate && (
                          <button
                            type="button"
                            onClick={() => {
                              setSendFor(q._id);
                              setSendEmail('');
                            }}
                            className="text-[color:var(--accent)] hover:underline"
                          >
                            Send
                          </button>
                        )}
                        {(q.status === 'sent' || q.status === 'draft') && canUpdate && (
                          <>
                            <button
                              type="button"
                              onClick={() => void setStatus(q._id, 'accepted')}
                              className="text-emerald-400 hover:underline"
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              onClick={() => void setStatus(q._id, 'rejected')}
                              className="text-[color:var(--text-muted)] hover:underline"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {q.status === 'draft' && canDelete && (
                          <button
                            type="button"
                            onClick={() => void remove(q._id)}
                            className="text-red-400 hover:underline"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && pageRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-[12px] text-[color:var(--text-muted)]">
                    {hasFilters ? 'Try adjusting filters or click Clear.' : 'No quotations yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/30">
          <p className="text-[11px] text-[color:var(--text-muted)]">
            Page {safePage} / {totalPages}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-7 px-2.5 rounded-md text-[12px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] disabled:opacity-40"
            >
              Prev
            </button>
            <div className="hidden sm:flex items-center gap-0.5">
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                .reduce<(number | '…')[]>((acc, p, idx, arr) => {
                  if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('…');
                  acc.push(p);
                  return acc;
                }, [])
                .map((p, i) =>
                  p === '…' ? (
                    <span key={`e${i}`} className="px-1 text-[color:var(--text-muted)] text-[12px]">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      className={
                        p === safePage
                          ? 'min-w-[1.75rem] h-7 rounded-md text-[12px] font-medium btn-primary'
                          : 'min-w-[1.75rem] h-7 rounded-md text-[12px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]'
                      }
                    >
                      {p}
                    </button>
                  )
                )}
            </div>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-7 px-2.5 rounded-md text-[12px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {sendFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => !sendBusy && setSendFor(null)}
        >
          <div
            className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl max-w-sm w-full p-6 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold">Send quotation</h2>
            <input
              type="email"
              required
              placeholder="Recipient email"
              value={sendEmail}
              onChange={(e) => setSendEmail(e.target.value)}
              className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={sendBusy || !sendEmail.trim()}
                className="btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                onClick={() => void send(sendFor)}
              >
                {sendBusy ? 'Sending…' : 'Send'}
              </button>
              <button
                type="button"
                className="px-4 py-2 text-sm"
                disabled={sendBusy}
                onClick={() => setSendFor(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
