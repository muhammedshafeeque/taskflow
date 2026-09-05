import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, type CrmContact } from '../../lib/api';

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const ORIGINS = ['all', 'crm', 'lead', 'portal', 'hrms', 'staff'] as const;
type OriginFilter = (typeof ORIGINS)[number];

type DraftFilters = {
  name: string;
  email: string;
  phone: string;
  org: string;
  origin: OriginFilter;
  title: string;
};

const EMPTY_FILTERS: DraftFilters = {
  name: '',
  email: '',
  phone: '',
  org: '',
  origin: 'all',
  title: '',
};

const inputClass =
  'w-full h-9 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-2.5 text-[13px] text-[color:var(--text-primary)] placeholder:text-[color:var(--text-muted)]/70 focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30 focus:border-[color:var(--accent)]';

function FieldLabel({ children }: { children: string }) {
  return <span className="block text-[11px] font-medium text-[color:var(--text-muted)] mb-1">{children}</span>;
}

function orgIdOf(c: CrmContact): string {
  if (!c.customerOrgId) return '';
  return typeof c.customerOrgId === 'string' ? c.customerOrgId : c.customerOrgId._id;
}

function orgNameOf(c: CrmContact, orgs: Array<{ _id: string; name: string }>): string {
  if (c.customerOrgId && typeof c.customerOrgId === 'object' && c.customerOrgId.name) return c.customerOrgId.name;
  const id = orgIdOf(c);
  return orgs.find((o) => o._id === id)?.name ?? (id || '—');
}

function ContactAutocomplete({
  mode,
  value,
  rows,
  onChange,
  onPick,
}: {
  mode: 'name' | 'email';
  value: string;
  rows: CrmContact[];
  onChange: (v: string) => void;
  onPick: (c: CrmContact) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    const scored = rows
      .map((c) => {
        const field = (mode === 'name' ? c.name : c.email ?? '').toLowerCase();
        let score = -1;
        if (!q) score = 10;
        else if (field === q) score = 100;
        else if (field.startsWith(q)) score = 80;
        else if (field.includes(q)) score = 50;
        return { c, score };
      })
      .filter((x) => x.score >= 0)
      .sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    return scored
      .map((x) => x.c)
      .filter((c) => {
        const key = mode === 'name' ? c.name : c.email ?? c._id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);
  }, [rows, mode, value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

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
      onPick(suggestions[highlight]);
      setOpen(false);
    } else if (e.key === 'Escape') setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <input
        value={value}
        placeholder={mode === 'name' ? 'Type name…' : 'Type email…'}
        className={inputClass}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-48 overflow-auto rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-lg text-[13px]">
          {suggestions.map((c, i) => (
            <li key={c._id}>
              <button
                type="button"
                className={`w-full text-left px-2.5 py-1.5 ${i === highlight ? 'bg-[color:var(--accent)]/15' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => {
                  onPick(c);
                  setOpen(false);
                }}
              >
                {mode === 'name' ? c.name : c.email}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CrmContacts() {
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.crm.contact.create');
  const canUpdate = canAny(user, 'taskflow.crm.contact.update');
  const canDelete = canAny(user, 'taskflow.crm.contact.delete');
  const [rows, setRows] = useState<CrmContact[]>([]);
  const [orgs, setOrgs] = useState<Array<{ _id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<DraftFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    customerOrgId: '',
    name: '',
    email: '',
    phone: '',
    title: '',
    department: '',
    origin: 'crm' as CrmContact['origin'],
  });

  const load = () => {
    if (!token) return;
    setLoading(true);
    Promise.all([crmApi.listContacts(token), crmApi.listCustomerOrgs(token)]).then(([cRes, oRes]) => {
      setLoading(false);
      if (cRes.success && cRes.data) setRows(Array.isArray(cRes.data) ? cRes.data : []);
      if (oRes.success && oRes.data) setOrgs(Array.isArray(oRes.data) ? oRes.data : []);
    });
  };

  useEffect(() => {
    load();
  }, [token]);

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
      if (applied.name.trim() && !r.name.toLowerCase().includes(applied.name.trim().toLowerCase())) return false;
      if (applied.email.trim() && !(r.email ?? '').toLowerCase().includes(applied.email.trim().toLowerCase())) return false;
      if (applied.phone.trim() && !(r.phone ?? '').toLowerCase().includes(applied.phone.trim().toLowerCase())) return false;
      if (applied.title.trim() && !(r.title ?? '').toLowerCase().includes(applied.title.trim().toLowerCase())) return false;
      if (applied.origin !== 'all' && (r.origin ?? 'crm') !== applied.origin) return false;
      if (applied.org.trim()) {
        const q = applied.org.trim().toLowerCase();
        const name = orgNameOf(r, orgs).toLowerCase();
        if (!name.includes(q)) return false;
      }
      return true;
    });
  }, [rows, applied, orgs]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const from = filtered.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, filtered.length);
  const portalCount = rows.filter((r) => r.origin === 'portal').length;

  function openCreate() {
    setEditId(null);
    setForm({
      customerOrgId: '',
      name: '',
      email: '',
      phone: '',
      title: '',
      department: '',
      origin: 'crm',
    });
    setError('');
    setModal(true);
  }

  function openEdit(c: CrmContact) {
    setEditId(c._id);
    setForm({
      customerOrgId: orgIdOf(c),
      name: c.name,
      email: c.email ?? '',
      phone: c.phone ?? '',
      title: c.title ?? '',
      department: c.department ?? '',
      origin: c.origin ?? 'crm',
    });
    setError('');
    setModal(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !form.name.trim()) return;
    const payload = {
      customerOrgId: form.customerOrgId || undefined,
      name: form.name.trim(),
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      title: form.title.trim() || undefined,
      department: form.department.trim() || undefined,
      origin: form.origin,
    };
    const res = editId
      ? await crmApi.updateContact(editId, payload, token)
      : await crmApi.createContact(payload, token);
    if (!res.success) {
      setError((res as { message?: string }).message ?? 'Save failed');
      return;
    }
    setModal(false);
    load();
  }

  async function remove(id: string) {
    if (!token || !canDelete) return;
    if (!confirm('Delete this contact?')) return;
    await crmApi.deleteContact(id, token);
    load();
  }

  return (
    <div className="p-8 w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Contacts</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">
            One people directory — leads, portal users, HRMS, and staff.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1 text-[color:var(--text-muted)]">
            {rows.length} total
          </span>
          <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-emerald-600 dark:text-emerald-400">
            {portalCount} portal
          </span>
          {canCreate && (
            <button type="button" onClick={openCreate} className="btn-primary h-8 px-3 rounded-md text-[12px]">
              Add contact
            </button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
        <form
          onSubmit={applyFilters}
          className="px-3 sm:px-4 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/35"
        >
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[color:var(--text-muted)] mb-2.5">
            Search &amp; filter
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <div className="block min-w-0">
              <FieldLabel>Name</FieldLabel>
              <ContactAutocomplete
                mode="name"
                value={draft.name}
                rows={rows}
                onChange={(name) => setDraft((d) => ({ ...d, name }))}
                onPick={(c) => setDraft((d) => ({ ...d, name: c.name, email: c.email ?? d.email }))}
              />
            </div>
            <div className="block min-w-0">
              <FieldLabel>Email</FieldLabel>
              <ContactAutocomplete
                mode="email"
                value={draft.email}
                rows={rows}
                onChange={(email) => setDraft((d) => ({ ...d, email }))}
                onPick={(c) => setDraft((d) => ({ ...d, email: c.email ?? '', name: c.name }))}
              />
            </div>
            <label className="block min-w-0">
              <FieldLabel>Phone</FieldLabel>
              <input
                value={draft.phone}
                onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                className={inputClass}
              />
            </label>
            <label className="block min-w-0">
              <FieldLabel>Customer org</FieldLabel>
              <input
                value={draft.org}
                onChange={(e) => setDraft((d) => ({ ...d, org: e.target.value }))}
                placeholder="Organisation…"
                className={inputClass}
              />
            </label>
            <label className="block min-w-0">
              <FieldLabel>Origin</FieldLabel>
              <select
                value={draft.origin}
                onChange={(e) => setDraft((d) => ({ ...d, origin: e.target.value as OriginFilter }))}
                className={inputClass}
              >
                {ORIGINS.map((o) => (
                  <option key={o} value={o}>
                    {o === 'all' ? 'All' : o}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0">
              <FieldLabel>Title</FieldLabel>
              <input
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
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

        <table className="w-full text-sm">
          <thead className="bg-[color:var(--bg-page)]/50 text-[color:var(--text-muted)]">
            <tr>
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Phone</th>
              <th className="text-left p-3">Customer</th>
              <th className="text-left p-3">Origin</th>
              <th className="text-left p-3">Title</th>
              {(canUpdate || canDelete) && <th className="text-right p-3">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((c) => {
              const oid = orgIdOf(c);
              return (
                <tr key={c._id} className="border-t border-[color:var(--border-subtle)]">
                  <td className="p-3 font-medium">{c.name}</td>
                  <td className="p-3">{c.email ?? '—'}</td>
                  <td className="p-3">{c.phone ?? '—'}</td>
                  <td className="p-3">
                    {oid ? (
                      <Link to={`/admin/customer-orgs/${oid}`} className="text-[color:var(--accent)] hover:underline">
                        {orgNameOf(c, orgs)}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="p-3 capitalize">{c.origin ?? 'crm'}</td>
                  <td className="p-3">{c.title ?? '—'}</td>
                  {(canUpdate || canDelete) && (
                    <td className="p-3 text-right space-x-2">
                      {canUpdate && (
                        <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => openEdit(c)}>
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => void remove(c._id)}>
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-[color:var(--text-muted)]">
                  Try adjusting filters or click Clear.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-2 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/30">
          <p className="text-[12px] text-[color:var(--text-muted)]">
            {loading ? 'Loading…' : filtered.length === 0 ? 'No matches' : `Showing ${from}–${to} of ${filtered.length}`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
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
            <button
              type="button"
              className="h-7 px-2.5 rounded-md text-[12px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] disabled:opacity-40"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <span className="text-[12px] text-[color:var(--text-muted)]">
              {safePage} / {totalPages}
            </span>
            <button
              type="button"
              className="h-7 px-2.5 rounded-md text-[12px] border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] disabled:opacity-40"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setModal(false)}>
          <form
            onSubmit={submit}
            className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl max-w-md w-full p-6 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">{editId ? 'Edit contact' : 'New contact'}</h2>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Customer organisation (optional)</span>
              <select
                value={form.customerOrgId}
                onChange={(e) => setForm((f) => ({ ...f, customerOrgId: e.target.value }))}
                className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
              >
                <option value="">— None —</option>
                {orgs.map((a) => (
                  <option key={a._id} value={a._id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Name</span>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Email</span>
                <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
              </label>
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Phone</span>
                <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
              </label>
            </div>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Title</span>
              <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
            </label>
            <div className="flex gap-2 pt-2">
              <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">
                Save
              </button>
              <button type="button" onClick={() => setModal(false)} className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
