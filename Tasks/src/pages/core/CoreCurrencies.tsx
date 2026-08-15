import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { coreApi, type CoreCurrency } from '../../lib/api';

const PAGE_SIZE_OPTIONS = [10, 20, 50];

type StatusFilter = 'all' | 'active' | 'inactive';
type DecimalsFilter = 'all' | '0' | '2' | 'other';

type DraftFilters = {
  code: string;
  name: string;
  country: string;
  symbol: string;
  status: StatusFilter;
  decimals: DecimalsFilter;
};

const EMPTY_FILTERS: DraftFilters = {
  code: '',
  name: '',
  country: '',
  symbol: '',
  status: 'all',
  decimals: 'all',
};

const inputClass =
  'w-full h-9 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2.5 text-[13px] text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)]/70 focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30 focus:border-[color:var(--accent)]';

function FieldLabel({ children }: { children: string }) {
  return <span className="block text-[11px] font-medium text-[color:var(--text-muted)] mb-1">{children}</span>;
}

type AutocompleteMode = 'code' | 'name';

function CurrencyAutocomplete({
  mode,
  value,
  currencies,
  placeholder,
  onChange,
  onPick,
}: {
  mode: AutocompleteMode;
  value: string;
  currencies: CoreCurrency[];
  placeholder: string;
  onChange: (value: string) => void;
  onPick: (currency: CoreCurrency) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) {
      // Show first options when focused with empty query
      return currencies.slice(0, 8);
    }
    const scored = currencies
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
      .sort((a, b) => b.score - a.score || a.c.code.localeCompare(b.c.code));
    return scored.slice(0, 8).map((x) => x.c);
  }, [currencies, mode, value]);

  useEffect(() => {
    setHighlight(0);
  }, [suggestions, value]);

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
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <input
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
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
        <ul
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-lg py-1"
        >
          {suggestions.map((c, i) => (
            <li key={c._id} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                className={
                  i === highlight
                    ? 'w-full text-left px-2.5 py-1.5 text-[12px] bg-[color:var(--accent)]/15 text-[color:var(--text-primary)]'
                    : 'w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-[color:var(--bg-page)] text-[color:var(--text-primary)]'
                }
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
              >
                <span className="font-semibold tabular-nums text-[color:var(--accent)]">{c.code}</span>
                <span className="text-[color:var(--text-muted)]"> — </span>
                <span>{c.name}</span>
                <span className="text-[color:var(--text-muted)] ml-1">{c.symbol}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && value.trim() && suggestions.length === 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-lg px-2.5 py-2 text-[12px] text-[color:var(--text-muted)]">
          No matching currencies
        </div>
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
    const list = !q
      ? countries.slice(0, 10)
      : countries
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
    return list;
  }, [countries, value]);

  useEffect(() => {
    setHighlight(0);
  }, [suggestions, value]);

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
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <input
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
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
        <ul
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-lg py-1"
        >
          {suggestions.map((name, i) => (
            <li key={name} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                className={
                  i === highlight
                    ? 'w-full text-left px-2.5 py-1.5 text-[12px] bg-[color:var(--accent)]/15 text-[color:var(--text-primary)]'
                    : 'w-full text-left px-2.5 py-1.5 text-[12px] hover:bg-[color:var(--bg-page)] text-[color:var(--text-primary)]'
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
      {open && value.trim() && suggestions.length === 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-lg px-2.5 py-2 text-[12px] text-[color:var(--text-muted)]">
          No matching countries
        </div>
      )}
    </div>
  );
}

export default function CoreCurrencies() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.core.currency.manage');
  const [rows, setRows] = useState<CoreCurrency[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<DraftFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = () => {
    if (!token) return;
    setLoading(true);
    coreApi
      .listCurrencies(token, false)
      .then((res) => {
        if (res.success && res.data) setRows(res.data as CoreCurrency[]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [token]);

  async function toggle(code: string, isActive: boolean) {
    if (!token || !canManage) return;
    await coreApi.setCurrencyActive(code, isActive, token);
    load();
  }

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

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (applied.code.trim() && !r.code.toLowerCase().includes(applied.code.trim().toLowerCase())) {
        return false;
      }
      if (applied.name.trim() && !r.name.toLowerCase().includes(applied.name.trim().toLowerCase())) {
        return false;
      }
      if (applied.country.trim()) {
        const q = applied.country.trim().toLowerCase();
        const hit = (r.countries ?? []).some((country) => country.toLowerCase().includes(q));
        if (!hit) return false;
      }
      if (applied.symbol.trim() && !r.symbol.toLowerCase().includes(applied.symbol.trim().toLowerCase())) {
        return false;
      }
      if (applied.status === 'active' && !r.isActive) return false;
      if (applied.status === 'inactive' && r.isActive) return false;
      if (applied.decimals === '0' && r.decimalDigits !== 0) return false;
      if (applied.decimals === '2' && r.decimalDigits !== 2) return false;
      if (applied.decimals === 'other' && (r.decimalDigits === 0 || r.decimalDigits === 2)) return false;
      return true;
    });
  }, [rows, applied]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      for (const c of r.countries ?? []) {
        if (c.trim()) set.add(c.trim());
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const from = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, filtered.length);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const activeCount = rows.filter((r) => r.isActive).length;
  const inactiveCount = rows.length - activeCount;

  return (
    <div className="p-4 sm:p-6 w-full space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-[color:var(--text-primary)]">Currencies</h1>
          <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
            Global catalog — activate currencies your organization uses.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1 text-[color:var(--text-muted)]">
            {rows.length} total
          </span>
          <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-emerald-600 dark:text-emerald-400">
            {activeCount} active
          </span>
          <span className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1 text-[color:var(--text-muted)]">
            {inactiveCount} inactive
          </span>
        </div>
      </div>

      <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
        {/* Compact filters */}
        <form
          onSubmit={applyFilters}
          className="px-3 sm:px-4 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/35"
        >
          <div className="mb-2.5">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
              Search &amp; filter
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <div className="block min-w-0">
              <FieldLabel>Code</FieldLabel>
              <CurrencyAutocomplete
                mode="code"
                value={draft.code}
                currencies={rows}
                placeholder="Type code…"
                onChange={(code) => setDraft((d) => ({ ...d, code }))}
                onPick={(c) => setDraft((d) => ({ ...d, code: c.code, name: c.name }))}
              />
            </div>
            <div className="block min-w-0">
              <FieldLabel>Name</FieldLabel>
              <CurrencyAutocomplete
                mode="name"
                value={draft.name}
                currencies={rows}
                placeholder="Type name…"
                onChange={(name) => setDraft((d) => ({ ...d, name }))}
                onPick={(c) => setDraft((d) => ({ ...d, code: c.code, name: c.name }))}
              />
            </div>
            <div className="block min-w-0">
              <FieldLabel>Country</FieldLabel>
              <CountryAutocomplete
                value={draft.country}
                countries={countryOptions}
                onChange={(country) => setDraft((d) => ({ ...d, country }))}
                onPick={(country) => setDraft((d) => ({ ...d, country }))}
              />
            </div>
            <label className="block min-w-0">
              <FieldLabel>Symbol</FieldLabel>
              <input
                value={draft.symbol}
                onChange={(e) => setDraft((d) => ({ ...d, symbol: e.target.value }))}
                placeholder="₹"
                className={inputClass}
              />
            </label>
            <label className="block min-w-0">
              <FieldLabel>Status</FieldLabel>
              <select
                value={draft.status}
                onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as StatusFilter }))}
                className={inputClass}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
            <label className="block min-w-0">
              <FieldLabel>Decimals</FieldLabel>
              <select
                value={draft.decimals}
                onChange={(e) => setDraft((d) => ({ ...d, decimals: e.target.value as DecimalsFilter }))}
                className={inputClass}
              >
                <option value="all">All</option>
                <option value="2">2</option>
                <option value="0">0</option>
                <option value="other">Other</option>
              </select>
            </label>
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

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 border-b border-[color:var(--border-subtle)]">
          <p className="text-[12px] text-[color:var(--text-muted)]">
            {loading
              ? 'Loading…'
              : filtered.length === 0
                ? 'No matches'
                : `Showing ${from}–${to} of ${filtered.length}`}
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

        {/* Dense table */}
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] table-fixed">
            <colgroup>
              <col className="w-[72px]" />
              <col className="w-[22%]" />
              <col />
              <col className="w-[64px]" />
              <col className="w-[64px]" />
              <col className="w-[88px]" />
              {canManage && <col className="w-[100px]" />}
            </colgroup>
            <thead>
              <tr className="bg-[color:var(--bg-page)]/50 text-left text-[10px] uppercase tracking-wider text-[color:var(--text-muted)]">
                <th className="px-3 py-2 font-semibold">Code</th>
                <th className="px-3 py-2 font-semibold">Currency</th>
                <th className="px-3 py-2 font-semibold">Countries</th>
                <th className="px-3 py-2 font-semibold">Symbol</th>
                <th className="px-3 py-2 font-semibold text-center">Dec</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                {canManage && <th className="px-3 py-2 font-semibold text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((c) => (
                <tr
                  key={c._id}
                  className="border-t border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-page)]/40"
                >
                  <td className="px-3 py-2 align-middle">
                    <span className="font-semibold tabular-nums text-[color:var(--accent)]">{c.code}</span>
                  </td>
                  <td className="px-3 py-2 align-middle min-w-0">
                    <div className="font-medium text-[color:var(--text-primary)] truncate">{c.name}</div>
                  </td>
                  <td className="px-3 py-2 align-middle min-w-0">
                    {(c.countries ?? []).length === 0 ? (
                      <span className="text-[color:var(--text-muted)]">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {(c.countries ?? []).map((country) => (
                          <button
                            key={country}
                            type="button"
                            title={`Filter by ${country}`}
                            className="inline-flex max-w-full truncate rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-1.5 py-0.5 text-[11px] text-[color:var(--text-primary)] hover:border-[color:var(--accent)]/50"
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
                  <td className="px-3 py-2 align-middle text-[color:var(--text-primary)]">{c.symbol}</td>
                  <td className="px-3 py-2 align-middle text-center tabular-nums text-[color:var(--text-muted)]">
                    {c.decimalDigits}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    {c.isActive ? (
                      <span className="inline-flex rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold leading-none">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-[color:var(--bg-page)] text-[color:var(--text-muted)] border border-[color:var(--border-subtle)] px-2 py-0.5 text-[10px] font-semibold leading-none">
                        Inactive
                      </span>
                    )}
                  </td>
                  {canManage && (
                    <td className="px-3 py-2 align-middle text-right">
                      <button
                        type="button"
                        className={
                          c.isActive
                            ? 'text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:underline'
                            : 'text-[11px] font-medium text-emerald-600 dark:text-emerald-400 hover:underline'
                        }
                        onClick={() => void toggle(c.code, !c.isActive)}
                      >
                        {c.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {!loading && pageRows.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="px-3 py-8 text-center text-[12px] text-[color:var(--text-muted)]">
                    {rows.length === 0 ? (
                      <>
                        No currencies. Run{' '}
                        <code className="text-[11px] bg-[color:var(--bg-page)] px-1 rounded">npm run seed-currencies</code>
                      </>
                    ) : (
                      'Try adjusting filters or click Clear.'
                    )}
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
    </div>
  );
}
