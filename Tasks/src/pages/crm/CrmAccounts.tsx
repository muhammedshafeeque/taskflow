import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, type CrmAccount } from '../../lib/api';
import { ExportButton } from '../../components/moduleKit';

const TYPES = ['prospect', 'client', 'partner', 'vendor'] as const;

export default function CrmAccounts() {
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.crm.account.create');
  const canUpdate = canAny(user, 'taskflow.crm.account.update');
  const canDelete = canAny(user, 'taskflow.crm.account.delete');
  const [accounts, setAccounts] = useState<CrmAccount[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', type: 'client', industry: '', website: '', notes: '' });
  const [error, setError] = useState('');

  const load = () => {
    if (!token) return;
    setLoading(true);
    crmApi.listAccounts(token, { search: search || undefined }).then((res) => {
      setLoading(false);
      if (res.success && res.data) setAccounts((res.data as { data: CrmAccount[] }).data ?? []);
    });
  };

  useEffect(() => {
    load();
  }, [token, search]);

  function openCreate() {
    setForm({ name: '', type: 'client', industry: '', website: '', notes: '' });
    setEditId(null);
    setError('');
    setModal('create');
  }

  function openEdit(a: CrmAccount) {
    setForm({
      name: a.name,
      type: a.type || 'client',
      industry: a.industry ?? '',
      website: a.website ?? '',
      notes: a.notes ?? '',
    });
    setEditId(a._id);
    setError('');
    setModal('edit');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !form.name.trim()) return;
    setError('');
    const payload = {
      name: form.name.trim(),
      type: form.type,
      industry: form.industry.trim() || undefined,
      website: form.website.trim() || undefined,
      notes: form.notes.trim() || undefined,
    };
    const res =
      modal === 'create'
        ? await crmApi.createAccount(payload, token)
        : editId
          ? await crmApi.updateAccount(editId, payload, token)
          : null;
    if (!res?.success) {
      setError((res as { message?: string } | null)?.message ?? 'Save failed');
      return;
    }
    setModal(null);
    load();
  }

  async function remove(id: string) {
    if (!token || !canDelete) return;
    if (!confirm('Delete this account?')) return;
    await crmApi.deleteAccount(id, token);
    load();
  }

  return (
    <div className="p-8 w-full px-4 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold">Accounts</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">Customers, prospects, partners, and vendors.</p>
        </div>
        <div className="flex gap-2">
          <ExportButton
            rows={accounts}
            filename="accounts"
            columns={[
              { header: 'Name', value: (a) => a.name },
              { header: 'Type', value: (a) => a.type ?? '' },
              { header: 'Industry', value: (a) => a.industry ?? '' },
              { header: 'Website', value: (a) => a.website ?? '' },
            ]}
          />
          {canCreate && (
            <button type="button" onClick={openCreate} className="btn-primary px-4 py-2 rounded-lg text-sm">
              Add account
            </button>
          )}
        </div>
      </div>
      <input
        className="mb-4 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm w-full max-w-md"
        placeholder="Search accounts…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {loading ? (
        <p className="text-[color:var(--text-muted)]">Loading…</p>
      ) : (
        <div className="rounded-2xl border border-[color:var(--border-subtle)] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[color:var(--bg-surface)] text-[color:var(--text-muted)]">
              <tr>
                <th className="text-left p-3">Name</th>
                <th className="text-left p-3">Type</th>
                <th className="text-left p-3">Industry</th>
                <th className="text-left p-3">Website</th>
                {(canUpdate || canDelete) && <th className="text-right p-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a._id} className="border-t border-[color:var(--border-subtle)]">
                  <td className="p-3">
                    <Link to={`/crm/accounts/${a._id}`} className="text-[color:var(--accent)] hover:underline font-medium">
                      {a.name}
                    </Link>
                  </td>
                  <td className="p-3 capitalize">{a.type}</td>
                  <td className="p-3">{a.industry ?? '—'}</td>
                  <td className="p-3 text-[color:var(--text-muted)] truncate max-w-[12rem]">{a.website ?? '—'}</td>
                  {(canUpdate || canDelete) && (
                    <td className="p-3 text-right space-x-2">
                      {canUpdate && (
                        <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => openEdit(a)}>
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" className="text-xs text-red-400 hover:underline" onClick={() => void remove(a._id)}>
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-[color:var(--text-muted)]">
                    No accounts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setModal(null)}>
          <form
            onSubmit={submit}
            className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl max-w-md w-full p-6 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">{modal === 'create' ? 'New account' : 'Edit account'}</h2>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Name</span>
              <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Type</span>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm">
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Industry</span>
              <input value={form.industry} onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Website</span>
              <input value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Notes</span>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
            </label>
            <div className="flex gap-2 pt-2">
              <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">Save</button>
              <button type="button" onClick={() => setModal(null)} className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
