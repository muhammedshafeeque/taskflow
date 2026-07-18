import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, type CrmAccount, type CrmContact } from '../../lib/api';

export default function CrmContacts() {
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.crm.contact.create');
  const canUpdate = canAny(user, 'taskflow.crm.contact.update');
  const canDelete = canAny(user, 'taskflow.crm.contact.delete');
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [accounts, setAccounts] = useState<CrmAccount[]>([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    accountId: '',
    name: '',
    email: '',
    phone: '',
    title: '',
    department: '',
    isPrimary: false,
  });

  const accountName = (id: string) => accounts.find((a) => a._id === id)?.name ?? id;

  const load = () => {
    if (!token) return;
    crmApi.listContacts(token, { search: search || undefined }).then((res) => {
      if (res.success && res.data) setContacts(res.data as CrmContact[]);
    });
  };

  useEffect(() => {
    load();
  }, [token, search]);

  useEffect(() => {
    if (!token) return;
    crmApi.listAccounts(token).then((res) => {
      if (res.success && res.data) setAccounts((res.data as { data: CrmAccount[] }).data ?? []);
    });
  }, [token]);

  function openCreate() {
    setEditId(null);
    setForm({
      accountId: accounts[0]?._id ?? '',
      name: '',
      email: '',
      phone: '',
      title: '',
      department: '',
      isPrimary: false,
    });
    setError('');
    setModal(true);
  }

  function openEdit(c: CrmContact) {
    setEditId(c._id);
    setForm({
      accountId: c.accountId,
      name: c.name,
      email: c.email ?? '',
      phone: c.phone ?? '',
      title: c.title ?? '',
      department: c.department ?? '',
      isPrimary: Boolean(c.isPrimary),
    });
    setError('');
    setModal(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !form.name.trim() || !form.accountId) return;
    const payload = {
      accountId: form.accountId,
      name: form.name.trim(),
      email: form.email.trim() || undefined,
      phone: form.phone.trim() || undefined,
      title: form.title.trim() || undefined,
      department: form.department.trim() || undefined,
      isPrimary: form.isPrimary,
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
    <div className="p-8 w-full px-4 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">Contacts</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">People linked to CRM accounts.</p>
        </div>
        {canCreate && (
          <button type="button" onClick={openCreate} className="btn-primary px-4 py-2 rounded-lg text-sm" disabled={accounts.length === 0}>
            Add contact
          </button>
        )}
      </div>
      {accounts.length === 0 && (
        <p className="text-sm text-amber-400 mb-4">
          Create an <Link to="/crm/accounts" className="underline">account</Link> before adding contacts.
        </p>
      )}
      <input
        className="mb-4 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm w-full max-w-md"
        placeholder="Search contacts…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="rounded-2xl border border-[color:var(--border-subtle)] overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[color:var(--bg-surface)] text-[color:var(--text-muted)]">
            <tr>
              <th className="text-left p-3">Name</th>
              <th className="text-left p-3">Account</th>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Phone</th>
              <th className="text-left p-3">Title</th>
              {(canUpdate || canDelete) && <th className="text-right p-3">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr key={c._id} className="border-t border-[color:var(--border-subtle)]">
                <td className="p-3 font-medium">
                  {c.name} {c.isPrimary && <span className="text-[10px] text-[color:var(--accent)]">primary</span>}
                </td>
                <td className="p-3">
                  <Link to={`/crm/accounts/${c.accountId}`} className="text-[color:var(--accent)] hover:underline">
                    {accountName(c.accountId)}
                  </Link>
                </td>
                <td className="p-3">{c.email ?? '—'}</td>
                <td className="p-3">{c.phone ?? '—'}</td>
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
            ))}
            {contacts.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-[color:var(--text-muted)]">No contacts yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setModal(false)}>
          <form onSubmit={submit} className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl max-w-md w-full p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">{editId ? 'Edit contact' : 'New contact'}</h2>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Account</span>
              <select required value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm">
                {accounts.map((a) => (
                  <option key={a._id} value={a._id}>{a.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Name</span>
              <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
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
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Title</span>
                <input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
              </label>
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Department</span>
                <input value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
              </label>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={form.isPrimary} onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))} />
              Primary contact
            </label>
            <div className="flex gap-2 pt-2">
              <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">Save</button>
              <button type="button" onClick={() => setModal(false)} className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
