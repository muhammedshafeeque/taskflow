import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import {
  coreApi,
  type CoreCurrency,
  type CoreExchangeRateRecord,
} from '../../lib/api';

const PAGE_SIZE_OPTIONS = [10, 20, 50];

type DraftFilters = {
  code: string;
  name: string;
  country: string;
  from: string;
  to: string;
};

const EMPTY_FILTERS: DraftFilters = {
  code: '',
  name: '',
  country: '',
  from: '',
  to: '',
};

const inputClass =
  'w-full h-9 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2.5 text-[13px] text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)]/70 focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30 focus:border-[color:var(--accent)]';

function FieldLabel({ children }: { children: string }) {
  return <span className="block text-[11px] font-medium text-[color:var(--text-muted)] mb-1">{children}</span>;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function CurrencyAutocomplete({
  mode,
  value,
  currencies,
  placeholder,
  excludeUsd,
  onChange,
  onPick,
}: {
  mode: 'code' | 'name';
  value: string;
  currencies: CoreCurrency[];
  placeholder: string;
  excludeUsd?: boolean;
  onChange: (value: string) => void;
  onPick: (currency: CoreCurrency) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const pool = useMemo(
    () => (excludeUsd ? currencies.filter((c) => c.code !== 'USD') : currencies),
    [currencies, excludeUsd]
  );

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return pool.slice(0, 8);
    return pool
      .map((c) => {
        const code = c.code.toLowerCase();
        const name = c.name.toLowerCase();
        let score = -1;
        if (mode === 'code') {
          if (code === q) score = 100;
          else if (code.startsWith(q)) score = 80;
          else if (code.includes(q)) score = 50;
          else if (name.includes(q)) score = 20;
        } else {
          if (name === q) score = 100;
          else if (name.startsWith(q)) score = 80;
          else if (name.includes(q)) score = 50;
          else if (code.includes(q)) score = 30;
        }
        return { c, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score || a.c.code.localeCompare(b.c.code))
      .slice(0, 8)
      .map((x) => x.c);
  }, [pool, mode, value]);

  useEffect(() => setHighlight(0), [suggestions, value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(c: CoreCurrency) {
    onPick(c);
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
      <input
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        placeholder={placeholder}
        className={inputClass}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-40 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-lg py-1">
          {suggestions.map((c, i) => (
            <li key={c._id}>
              <button
                type="button"
                className={
                  i === highlight
                    ? 'w-full text-left px-2.5 py-1.5 text-[12px] bg-[color:var(--accent)]/15'
                    : 'w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-[color:var(--bg-page)]'
                }
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
              >
                <span className="font-semibold text-[color:var(--accent)]">{c.code}</span>
                <span className="text-[color:var(--text-muted)]"> — </span>
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CountryAutocomplete({
  value,
  countries,
  onChange,
  onPick,
}: {
  value: string;
  countries: string[];
  onChange: (value: string) => void;
  onPick: (country: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return countries.slice(0, 10);
    return countries
      .map((name) => {
        const n = name.toLowerCase();
        let score = -1;
        if (n === q) score = 100;
        else if (n.startsWith(q)) score = 80;
        else if (n.includes(q)) score = 50;
        return { name, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 10)
      .map((x) => x.name);
  }, [countries, value]);

  useEffect(() => setHighlight(0), [suggestions, value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(name: string) {
    onPick(name);
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
      <input
        value={value}
        autoComplete="off"
        placeholder="Type country…"
        className={inputClass}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-40 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-lg py-1">
          {suggestions.map((name, i) => (
            <li key={name}>
              <button
                type="button"
                className={
                  i === highlight
                    ? 'w-full text-left px-2.5 py-1.5 text-[12px] bg-[color:var(--accent)]/15'
                    : 'w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-[color:var(--bg-page)]'
                }
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(name);
                }}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CoreExchangeRates() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.core.exchange_rate.manage');
  const [currencies, setCurrencies] = useState<CoreCurrency[]>([]);
  const [items, setItems] = useState<CoreExchangeRateRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<DraftFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    code: '',
    name: '',
    rateToUsd: '',
    effectiveFrom: todayIso(),
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [error, setError] = useState('');

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of currencies) {
      for (const country of c.countries ?? []) if (country.trim()) set.add(country.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [currencies]);

  const load = () => {
    if (!token) return;
    setLoading(true);
    coreApi
      .listExchangeRates(token, {
        from: applied.from || undefined,
        to: applied.to || undefined,
        code: applied.code || undefined,
        name: applied.name || undefined,
        country: applied.country || undefined,
        page,
        limit: pageSize,
      })
      .then((res) => {
        if (res.success && res.data) {
          const data = res.data as {
            items: CoreExchangeRateRecord[];
            total: number;
            totalPages: number;
          };
          setItems(data.items ?? []);
          setTotal(data.total ?? 0);
          setTotalPages(data.totalPages ?? 1);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token) return;
    coreApi.listCurrencies(token, true).then((res) => {
      if (res.success && res.data) setCurrencies(res.data as CoreCurrency[]);
    });
  }, [token]);

  useEffect(() => {
    load();
  }, [token, applied, page, pageSize]);

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

  function openCreate() {
    setError('');
    setCreateForm({
      code: '',
      name: '',
      rateToUsd: '',
      effectiveFrom: todayIso(),
      notes: '',
    });
    setCreateOpen(true);
  }

  async function saveCreate(e: FormEvent) {
    e.preventDefault();
    if (!token || !canManage) return;
    if (!createForm.code.trim()) {
      setError('Select a currency.');
      return;
    }
    if (createForm.code.trim().toUpperCase() === 'USD') {
      setError('USD rate is fixed at 1.');
      return;
    }
    const rate = Number(createForm.rateToUsd);
    if (!Number.isFinite(rate) || rate < 0) {
      setError('Enter a valid rate to USD.');
      return;
    }
    if (!createForm.effectiveFrom) {
      setError('Effective date is required.');
      return;
    }
    setSaving(true);
    setError('');
    const res = await coreApi.setExchangeRate(
      createForm.code.trim().toUpperCase(),
      {
        rateToUsd: rate,
        effectiveFrom: createForm.effectiveFrom,
        notes: createForm.notes.trim() || undefined,
      },
      token
    );
    setSaving(false);
    if (!res.success) {
      setError((res as { message?: string }).message ?? 'Could not save rate.');
      return;
    }
    setCreateOpen(false);
    // Show the day that was just created
    setDraft((d) => ({ ...d, from: createForm.effectiveFrom, to: createForm.effectiveFrom, code: createForm.code }));
    setApplied((a) => ({
      ...a,
      from: createForm.effectiveFrom,
      to: createForm.effectiveFrom,
      code: createForm.code.trim().toUpperCase(),
    }));
    setPage(1);
    load();
  }

  async function remove(id: string) {
    if (!token || !canManage) return;
    if (!confirm('Delete this ROE record?')) return;
    await coreApi.deleteExchangeRate(id, token);
    load();
  }

  async function syncFromInternet() {
    if (!token || !canManage || syncing) return;
    setSyncing(true);
    setSyncMessage('');
    const res = await coreApi.syncExchangeRates(token, { effectiveFrom: todayIso() });
    setSyncing(false);
    if (!res.success || !res.data) {
      setSyncMessage((res as { message?: string }).message ?? 'Sync failed.');
      return;
    }
    const data = res.data as { upserted: number; skipped: number; effectiveFrom: string };
    const day = new Date(data.effectiveFrom).toISOString().slice(0, 10);
    setSyncMessage(`Synced ${data.upserted} currencies for ${day}${data.skipped ? ` (${data.skipped} skipped)` : ''}.`);
    setDraft((d) => ({ ...d, from: day, to: day, code: '', name: '', country: '' }));
    setApplied({ from: day, to: day, code: '', name: '', country: '' });
    setPage(1);
    load();
  }

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const safePage = Math.min(page, totalPages);

  return (
    <div className="p-4 sm:p-6 w-full space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Exchange rates (ROE to USD)</h1>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
            Day-wise ROE records. Create a rate for a currency on a specific date. USD is always 1.
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={syncing}
              onClick={() => void syncFromInternet()}
              className="h-9 px-4 rounded-lg text-sm font-medium border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)] disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : 'Sync from internet'}
            </button>
            <button type="button" className="btn-primary h-9 px-4 rounded-lg text-sm font-medium" onClick={openCreate}>
              + Add ROE
            </button>
          </div>
        )}
      </div>
      {syncMessage && (
        <p className="text-[12px] text-[color:var(--text-muted)] -mt-1">{syncMessage}</p>
      )}

      <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
        <form
          onSubmit={applyFilters}
          className="px-3 sm:px-4 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/35"
        >
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
              Search &amp; filter
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <div className="min-w-0">
              <FieldLabel>Code</FieldLabel>
              <CurrencyAutocomplete
                mode="code"
                value={draft.code}
                currencies={currencies}
                placeholder="Type code…"
                onChange={(code) => setDraft((d) => ({ ...d, code }))}
                onPick={(c) => setDraft((d) => ({ ...d, code: c.code, name: c.name }))}
              />
            </div>
            <div className="min-w-0">
              <FieldLabel>Name</FieldLabel>
              <CurrencyAutocomplete
                mode="name"
                value={draft.name}
                currencies={currencies}
                placeholder="Type name…"
                onChange={(name) => setDraft((d) => ({ ...d, name }))}
                onPick={(c) => setDraft((d) => ({ ...d, code: c.code, name: c.name }))}
              />
            </div>
            <div className="min-w-0">
              <FieldLabel>Country</FieldLabel>
              <CountryAutocomplete
                value={draft.country}
                countries={countryOptions}
                onChange={(country) => setDraft((d) => ({ ...d, country }))}
                onPick={(country) => setDraft((d) => ({ ...d, country }))}
              />
            </div>
            <label className="min-w-0 block">
              <FieldLabel>From date</FieldLabel>
              <input
                type="date"
                value={draft.from}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                className={inputClass}
              />
            </label>
            <label className="min-w-0 block">
              <FieldLabel>To date</FieldLabel>
              <input
                type="date"
                value={draft.to}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                className={inputClass}
              />
            </label>
          </div>

          <div className="flex flex-wrap justify-end gap-1.5 mt-3">
            <button
              type="button"
              onClick={clearFilters}
              className="h-8 px-3 rounded-md text-[12px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]"
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
                ? 'No ROE records yet. Add a rate for a specific day.'
                : `Showing ${from}–${to} of ${total} records`}
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
          <table className="w-full text-[13px] table-fixed">
            <colgroup>
              <col className="w-[110px]" />
              <col className="w-[72px]" />
              <col className="w-[18%]" />
              <col />
              <col className="w-[100px]" />
              <col className="w-[16%]" />
              {canManage && <col className="w-[90px]" />}
            </colgroup>
            <thead>
              <tr className="bg-[color:var(--bg-page)]/50 text-left text-[10px] uppercase tracking-wider text-[color:var(--text-muted)]">
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Code</th>
                <th className="px-3 py-2 font-semibold">Currency</th>
                <th className="px-3 py-2 font-semibold">Countries</th>
                <th className="px-3 py-2 font-semibold text-right">Rate → USD</th>
                <th className="px-3 py-2 font-semibold">Notes</th>
                {canManage && <th className="px-3 py-2 font-semibold text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r._id} className="border-t border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-page)]/40">
                  <td className="px-3 py-2 align-middle tabular-nums whitespace-nowrap">
                    {new Date(r.effectiveFrom).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <span className="font-semibold text-[color:var(--accent)]">{r.currencyCode}</span>
                  </td>
                  <td className="px-3 py-2 align-middle min-w-0">
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="text-[11px] text-[color:var(--text-muted)]">{r.symbol}</div>
                  </td>
                  <td className="px-3 py-2 align-middle min-w-0">
                    {(r.countries ?? []).length === 0 ? (
                      <span className="text-[color:var(--text-muted)]">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {r.countries.map((country) => (
                          <button
                            key={country}
                            type="button"
                            className="inline-flex max-w-full truncate rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-1.5 py-0.5 text-[11px] hover:border-[color:var(--accent)]/50"
                            onClick={() => {
                              setDraft((d) => ({ ...d, country }));
                              setApplied((a) => ({ ...a, country }));
                              setPage(1);
                            }}
                          >
                            {country}
                          </button>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-middle text-right tabular-nums font-medium">{r.rateToUsd}</td>
                  <td className="px-3 py-2 align-middle text-[color:var(--text-muted)] truncate">{r.notes || '—'}</td>
                  {canManage && (
                    <td className="px-3 py-2 align-middle text-right">
                      <button
                        type="button"
                        className="text-[11px] font-medium text-red-400 hover:underline"
                        onClick={() => void remove(r._id)}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="px-3 py-10 text-center text-[12px] text-[color:var(--text-muted)]">
                    No day-wise ROE records. Use <strong>+ Add ROE</strong> to create one for a date.
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
              className="h-7 px-2.5 rounded-md text-[12px] border border-[color:var(--border-subtle)] disabled:opacity-40"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-7 px-2.5 rounded-md text-[12px] border border-[color:var(--border-subtle)] disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setCreateOpen(false)}>
          <form
            onSubmit={saveCreate}
            className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl max-w-md w-full p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="font-semibold text-base">Add ROE for a day</h2>
              <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
                1 unit of currency × rate = USD on the effective date.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="min-w-0">
                <FieldLabel>Currency code</FieldLabel>
                <CurrencyAutocomplete
                  mode="code"
                  value={createForm.code}
                  currencies={currencies}
                  excludeUsd
                  placeholder="INR"
                  onChange={(code) => setCreateForm((f) => ({ ...f, code }))}
                  onPick={(c) => setCreateForm((f) => ({ ...f, code: c.code, name: c.name }))}
                />
              </div>
              <div className="min-w-0">
                <FieldLabel>Currency name</FieldLabel>
                <CurrencyAutocomplete
                  mode="name"
                  value={createForm.name}
                  currencies={currencies}
                  excludeUsd
                  placeholder="Indian Rupee"
                  onChange={(name) => setCreateForm((f) => ({ ...f, name }))}
                  onPick={(c) => setCreateForm((f) => ({ ...f, code: c.code, name: c.name }))}
                />
              </div>
              <label className="block min-w-0">
                <FieldLabel>Effective date</FieldLabel>
                <input
                  type="date"
                  required
                  value={createForm.effectiveFrom}
                  onChange={(e) => setCreateForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
                  className={inputClass}
                />
              </label>
              <label className="block min-w-0">
                <FieldLabel>Rate to USD</FieldLabel>
                <input
                  type="number"
                  min={0}
                  step="any"
                  required
                  value={createForm.rateToUsd}
                  onChange={(e) => setCreateForm((f) => ({ ...f, rateToUsd: e.target.value }))}
                  placeholder="e.g. 0.012"
                  className={inputClass}
                />
              </label>
            </div>
            <label className="block">
              <FieldLabel>Notes</FieldLabel>
              <input
                value={createForm.notes}
                onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
                className={inputClass}
              />
            </label>

            {error && <p className="text-[12px] text-red-400">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={saving} className="btn-primary px-4 py-2 rounded-lg text-sm">
                {saving ? 'Saving…' : 'Save ROE'}
              </button>
              <button type="button" className="px-4 py-2 text-sm" onClick={() => setCreateOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
