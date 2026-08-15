import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { coreApi, uploadFile, type CoreCompanySettings, type CoreCurrency } from '../../lib/api';
import { resolveMediaUrl } from '../../hooks/useAppDisplayName';

const TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
  'Pacific/Auckland',
];

const inputClass =
  'w-full h-9 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2.5 text-[13px] text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)]/70 focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30 focus:border-[color:var(--accent)] disabled:opacity-55';

function FieldLabel({ children, hint }: { children: string; hint?: string }) {
  return (
    <span className="flex items-baseline justify-between gap-2 mb-1">
      <span className="text-[11px] font-medium text-[color:var(--text-muted)]">{children}</span>
      {hint && <span className="text-[10px] text-[color:var(--text-muted)]/80">{hint}</span>}
    </span>
  );
}

function CountryAutocomplete({
  value,
  countries,
  disabled,
  onChange,
  onPick,
}: {
  value: string;
  countries: string[];
  disabled?: boolean;
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
    if (disabled) return;
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
        disabled={disabled}
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
        onFocus={() => !disabled && setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && !disabled && suggestions.length > 0 && (
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
      {open && !disabled && value.trim() && suggestions.length === 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-lg px-2.5 py-2 text-[12px] text-[color:var(--text-muted)]">
          No matching countries — you can still type a custom value
        </div>
      )}
    </div>
  );
}

export default function CoreCompany() {
  const { token, user, refreshUser, updateUser } = useAuth();
  const canUpdate = canAny(user, 'taskflow.core.company.update');
  const [form, setForm] = useState<CoreCompanySettings>({
    companyName: '',
    baseCurrencyCode: 'USD',
  });
  const [snapshot, setSnapshot] = useState<CoreCompanySettings | null>(null);
  const [currencies, setCurrencies] = useState<CoreCurrency[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([coreApi.getCompany(token), coreApi.listCurrencies(token, true)])
      .then(([companyRes, currencyRes]) => {
        if (companyRes.success && companyRes.data) {
          const data = companyRes.data as CoreCompanySettings;
          setForm(data);
          setSnapshot(data);
        }
        if (currencyRes.success && currencyRes.data) {
          setCurrencies(currencyRes.data as CoreCurrency[]);
        }
      })
      .finally(() => setLoading(false));
  }, [token]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of currencies) {
      for (const country of c.countries ?? []) if (country.trim()) set.add(country.trim());
    }
    if (form.country?.trim()) set.add(form.country.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [currencies, form.country]);

  const currencyMeta = useMemo(() => {
    const code = form.baseCurrencyCode || 'USD';
    return currencies.find((c) => c.code === code) ?? { code, name: code, symbol: code };
  }, [currencies, form.baseCurrencyCode]);

  function patch<K extends keyof CoreCompanySettings>(key: K, value: CoreCompanySettings[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
    setMessage(null);
  }

  function resetForm() {
    if (!snapshot) return;
    setForm(snapshot);
    setDirty(false);
    setMessage(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!token || !canUpdate) return;
    if (!form.companyName.trim()) {
      setMessage({ type: 'err', text: 'Company name is required.' });
      return;
    }
    setSaving(true);
    setMessage(null);
    const res = await coreApi.updateCompany(
      {
        companyName: form.companyName.trim(),
        legalName: form.legalName?.trim() || undefined,
        logoUrl: form.logoUrl?.trim() || '',
        address: form.address?.trim() || undefined,
        city: form.city?.trim() || undefined,
        country: form.country?.trim() || undefined,
        taxId: form.taxId?.trim() || undefined,
        website: form.website?.trim() || undefined,
        baseCurrencyCode: form.baseCurrencyCode || 'USD',
        timezone: form.timezone?.trim() || undefined,
        notes: form.notes?.trim() || undefined,
      },
      token
    );
    setSaving(false);
    if (res.success && res.data) {
      const data = res.data as CoreCompanySettings;
      setForm(data);
      setSnapshot(data);
      setDirty(false);
      setMessage({ type: 'ok', text: 'Company profile saved.' });
      // Keep shell branding (sidebar / tab title / logo) in sync via org summary.
      if (user?.activeOrganizationId && user.organizations) {
        const nextName = data.companyName.trim();
        const nextLogo = data.logoUrl?.trim() || undefined;
        updateUser({
          ...user,
          organizations: user.organizations.map((o) =>
            o.id === user.activeOrganizationId
              ? { ...o, name: nextName, logoUrl: nextLogo }
              : o
          ),
        });
      }
      void refreshUser();
    } else {
      setMessage({ type: 'err', text: (res as { message?: string }).message ?? 'Could not save.' });
    }
  }

  async function persistLogo(logoUrl: string) {
    if (!token || !canUpdate) return;
    setLogoBusy(true);
    setMessage(null);
    const res = await coreApi.updateCompany({ logoUrl }, token);
    setLogoBusy(false);
    if (!res.success || !res.data) {
      setMessage({ type: 'err', text: (res as { message?: string }).message ?? 'Could not update logo.' });
      return;
    }
    const data = res.data as CoreCompanySettings;
    setForm((f) => ({ ...f, logoUrl: data.logoUrl }));
    setSnapshot((s) => (s ? { ...s, logoUrl: data.logoUrl } : s));
    if (user?.activeOrganizationId && user.organizations) {
      const nextLogo = data.logoUrl?.trim() || undefined;
      updateUser({
        ...user,
        organizations: user.organizations.map((o) =>
          o.id === user.activeOrganizationId ? { ...o, logoUrl: nextLogo } : o
        ),
      });
    }
    void refreshUser();
    setMessage({ type: 'ok', text: logoUrl ? 'Logo updated.' : 'Logo removed.' });
  }

  async function handleLogoFile(file: File) {
    if (!token || !canUpdate) return;
    const okTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!okTypes.includes(file.type)) {
      setMessage({ type: 'err', text: 'Please upload a JPEG, PNG, GIF, WebP, or SVG image.' });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ type: 'err', text: 'Logo must be under 2 MB.' });
      return;
    }
    setLogoBusy(true);
    setMessage(null);
    const res = await uploadFile(file, token);
    if (!res.success || !res.data?.url) {
      setLogoBusy(false);
      setMessage({ type: 'err', text: (res as { message?: string }).message ?? 'Upload failed.' });
      return;
    }
    await persistLogo(res.data.url);
  }

  const logoPreview = resolveMediaUrl(form.logoUrl);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh] text-sm text-[color:var(--text-muted)]">
        Loading company profile…
      </div>
    );
  }

  return (
    <form onSubmit={save} className="min-h-full flex flex-col">
      <div className="flex-1 p-4 sm:p-6 w-full space-y-3 pb-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-[color:var(--text-primary)]">Company</h1>
            <p className="text-[12px] text-[color:var(--text-muted)] mt-0.5">
              Legal and trading identity for this workspace. Name syncs to the organization and appears as the platform name everywhere in the app.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1 text-[color:var(--text-muted)]">
              {currencyMeta.symbol ? `${currencyMeta.symbol} ` : ''}
              {currencyMeta.code}
            </span>
            {form.timezone && (
              <span className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1 text-[color:var(--text-muted)]">
                {form.timezone}
              </span>
            )}
            <Link to="/core/currencies" className="text-[color:var(--accent)] hover:underline px-1">
              Currencies
            </Link>
            <Link to="/core/exchange-rates" className="text-[color:var(--accent)] hover:underline px-1">
              Exchange rates
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
          <div className="px-3 sm:px-4 py-2.5 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/35">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
              Company profile
            </h2>
          </div>

          <div className="p-3 sm:p-4 space-y-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)] mb-2">
                Branding
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[color:var(--border-subtle)] bg-white">
                  {logoPreview ? (
                    <img src={logoPreview} alt="Company logo" className="h-full w-full object-contain p-1" />
                  ) : (
                    <span className="text-[11px] text-[color:var(--text-muted)]">No logo</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="text-[12px] text-[color:var(--text-muted)]">
                    Shown in the work hub and module sidebar. PNG, JPEG, WebP, GIF, or SVG · max 2 MB.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                      className="hidden"
                      disabled={!canUpdate || logoBusy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void handleLogoFile(file);
                      }}
                    />
                    <button
                      type="button"
                      disabled={!canUpdate || logoBusy}
                      onClick={() => logoInputRef.current?.click()}
                      className="h-8 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 text-[12px] font-medium text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] disabled:opacity-55"
                    >
                      {logoBusy ? 'Uploading…' : logoPreview ? 'Change logo' : 'Upload logo'}
                    </button>
                    {logoPreview && (
                      <button
                        type="button"
                        disabled={!canUpdate || logoBusy}
                        onClick={() => void persistLogo('')}
                        className="h-8 rounded-md px-3 text-[12px] font-medium text-[color:var(--color-danger)] hover:underline disabled:opacity-55"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)] mb-2">
                Identity
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <label className="block min-w-0">
                  <FieldLabel hint="Required · syncs to org">Company name</FieldLabel>
                  <input
                    required
                    value={form.companyName}
                    disabled={!canUpdate}
                    onChange={(e) => patch('companyName', e.target.value)}
                    className={inputClass}
                    placeholder="Trading name"
                  />
                </label>
                <label className="block min-w-0">
                  <FieldLabel hint="Optional">Legal name</FieldLabel>
                  <input
                    value={form.legalName ?? ''}
                    disabled={!canUpdate}
                    onChange={(e) => patch('legalName', e.target.value)}
                    className={inputClass}
                    placeholder="Registered legal entity"
                  />
                </label>
                <label className="block min-w-0">
                  <FieldLabel>Tax ID / GSTIN</FieldLabel>
                  <input
                    value={form.taxId ?? ''}
                    disabled={!canUpdate}
                    onChange={(e) => patch('taxId', e.target.value)}
                    className={inputClass}
                    placeholder="e.g. 22AAAAA0000A1Z5"
                  />
                </label>
                <label className="block min-w-0">
                  <FieldLabel>Website</FieldLabel>
                  <input
                    type="text"
                    inputMode="url"
                    value={form.website ?? ''}
                    disabled={!canUpdate}
                    onChange={(e) => patch('website', e.target.value)}
                    className={inputClass}
                    placeholder="https://example.com"
                  />
                </label>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)] mb-2">
                Location
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <label className="block min-w-0 sm:col-span-2">
                  <FieldLabel>Street address</FieldLabel>
                  <input
                    value={form.address ?? ''}
                    disabled={!canUpdate}
                    onChange={(e) => patch('address', e.target.value)}
                    className={inputClass}
                    placeholder="Building, street, area"
                  />
                </label>
                <label className="block min-w-0">
                  <FieldLabel>City</FieldLabel>
                  <input
                    value={form.city ?? ''}
                    disabled={!canUpdate}
                    onChange={(e) => patch('city', e.target.value)}
                    className={inputClass}
                  />
                </label>
                <div className="block min-w-0">
                  <FieldLabel>Country</FieldLabel>
                  <CountryAutocomplete
                    value={form.country ?? ''}
                    countries={countryOptions}
                    disabled={!canUpdate}
                    onChange={(country) => patch('country', country)}
                    onPick={(country) => patch('country', country)}
                  />
                </div>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)] mb-2">
                Finance &amp; locale
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="block min-w-0">
                  <FieldLabel>Base currency</FieldLabel>
                  <select
                    value={form.baseCurrencyCode || 'USD'}
                    disabled={!canUpdate}
                    onChange={(e) => patch('baseCurrencyCode', e.target.value)}
                    className={inputClass}
                  >
                    {(currencies.length ? currencies : [{ code: 'USD', name: 'US Dollar' }]).map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block min-w-0">
                  <FieldLabel>Timezone</FieldLabel>
                  <select
                    value={form.timezone || ''}
                    disabled={!canUpdate}
                    onChange={(e) => patch('timezone', e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Select timezone</option>
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                    {form.timezone && !TIMEZONES.includes(form.timezone) && (
                      <option value={form.timezone}>{form.timezone}</option>
                    )}
                  </select>
                </label>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)] mb-2">
                Notes
              </p>
              <textarea
                rows={4}
                value={form.notes ?? ''}
                disabled={!canUpdate}
                onChange={(e) => patch('notes', e.target.value)}
                className={`${inputClass} h-auto min-h-[5.5rem] py-2 resize-y`}
                placeholder="Payment terms, registered office notes, invoice footnotes…"
              />
            </div>
          </div>
        </div>
      </div>

      {canUpdate && (
        <div className="sticky bottom-0 z-20 mt-auto border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]/95 backdrop-blur-md">
          <div className="w-full px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] min-h-[1.25rem]">
              {message ? (
                <span className={message.type === 'ok' ? 'text-emerald-500' : 'text-red-400'}>{message.text}</span>
              ) : dirty ? (
                <span className="text-[color:var(--text-muted)]">Unsaved changes</span>
              ) : (
                <span className="text-[color:var(--text-muted)]">All changes saved</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={resetForm}
                className="h-8 px-3 rounded-md text-[12px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] disabled:opacity-40"
              >
                Clear
              </button>
              <button
                type="submit"
                disabled={saving || !dirty}
                className="btn-primary h-8 px-4 rounded-md text-[12px] font-medium disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save company'}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
