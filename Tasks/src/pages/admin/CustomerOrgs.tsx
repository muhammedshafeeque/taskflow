import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { adminCustomerApi, type CustomerOrg } from '../../lib/api';
import { FiPlus, FiArrowRight, FiX, FiBriefcase } from 'react-icons/fi';

function statusColor(status: string): string {
  switch (status) {
    case 'active': return 'bg-green-500/15 text-green-400';
    case 'inactive': return 'bg-gray-500/15 text-gray-400';
    case 'suspended': return 'bg-red-500/15 text-red-400';
    default: return 'bg-gray-500/15 text-gray-400';
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function CustomerOrgs() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<CustomerOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    contactEmail: '',
    adminName: '',
    adminEmail: '',
    contactPhone: '',
    description: '',
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  function loadOrgs() {
    if (!token) return;
    setLoading(true);
    adminCustomerApi.listOrgs(token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setOrgs(res.data.orgs);
      else setError((res as { message?: string }).message ?? 'Failed to load organisations');
    });
  }

  useEffect(() => { loadOrgs(); }, [token, user?.activeOrganizationId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setCreating(true);
    setCreateError('');
    const res = await adminCustomerApi.createOrg(
      {
        name: form.name,
        contactEmail: form.contactEmail,
        adminName: form.adminName,
        adminEmail: form.adminEmail,
        contactPhone: form.contactPhone || undefined,
        description: form.description || undefined,
      },
      token
    );
    setCreating(false);
    if (res.success && res.data) {
      setShowCreate(false);
      setForm({ name: '', contactEmail: '', adminName: '', adminEmail: '', contactPhone: '', description: '' });
      navigate(`/admin/customer-orgs/${res.data.org._id}`);
    } else {
      setCreateError((res as { message?: string }).message ?? 'Create failed');
    }
  }

  const inputClass =
    'w-full rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-4 py-3 text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] transition focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30';

  return (
    <>
      <div className="p-8 animate-fade-in">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">Customer organisations</h1>
            <p className="text-sm text-[color:var(--text-muted)] mt-1">
              External client companies linked to your organization.
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setShowCreate(true); setCreateError(''); setForm({ name: '', contactEmail: '', adminName: '', adminEmail: '', contactPhone: '', description: '' }); }}
            className="btn-primary flex items-center gap-2"
          >
            <FiPlus /> Create Organisation
          </button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-12 text-center text-[color:var(--text-muted)] animate-pulse">
            Loading…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-400">{error}</div>
        ) : orgs.length === 0 ? (
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-12 text-center">
            <FiBriefcase className="mx-auto text-4xl text-[color:var(--text-muted)] mb-3" />
            <p className="text-sm text-[color:var(--text-muted)] mb-4">No customer organisations yet.</p>
            <button type="button" onClick={() => setShowCreate(true)} className="btn-primary">Create Organisation</button>
          </div>
        ) : (
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
                    <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Organisation</th>
                    <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Contact Email</th>
                    <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Created</th>
                    <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border-subtle)]">
                  {orgs.map((org) => (
                    <tr
                      key={org._id}
                      className="hover:bg-[color:var(--bg-elevated)] transition cursor-pointer"
                      onClick={() => navigate(`/admin/customer-orgs/${org._id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-[color:var(--accent)]/10 flex items-center justify-center text-[color:var(--accent)] shrink-0">
                            <FiBriefcase className="text-xs" />
                          </div>
                          <div>
                            <p className="font-medium text-[color:var(--text-primary)]">{org.name}</p>
                            <p className="text-xs text-[color:var(--text-muted)] font-mono">{org.slug}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[color:var(--text-muted)]">{org.contactEmail}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(org.status)}`}>
                          {org.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[color:var(--text-muted)]">{formatDate(org.createdAt)}</td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); navigate(`/admin/customer-orgs/${org._id}`); }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] transition"
                        >
                          View <FiArrowRight className="text-xs" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] p-6 shadow-2xl animate-scale-in max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-[color:var(--text-primary)]">Create Customer Organisation</h3>
              <button type="button" onClick={() => setShowCreate(false)} className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition"><FiX /></button>
            </div>
            {createError && (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{createError}</div>
            )}
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Organisation Name <span className="text-red-400">*</span></label>
                <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="Acme Corp" className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Contact Email <span className="text-red-400">*</span></label>
                <input type="email" value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} required placeholder="contact@acme.com" className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Contact Phone</label>
                <input type="text" value={form.contactPhone} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))} placeholder="+1 555 000 0000" className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Description</label>
                <textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Brief description…" className={`${inputClass} resize-none`} />
              </div>
              <hr className="border-[color:var(--border-subtle)]" />
              <p className="text-xs font-semibold text-[color:var(--text-muted)] uppercase tracking-wide">Admin Account</p>
              <div>
                <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Admin Name <span className="text-red-400">*</span></label>
                <input type="text" value={form.adminName} onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))} required placeholder="John Doe" className={inputClass} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Admin Email <span className="text-red-400">*</span></label>
                <input type="email" value={form.adminEmail} onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))} required placeholder="admin@acme.com" className={inputClass} />
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-sm">Cancel</button>
                <button type="submit" disabled={creating} className="btn-primary text-sm flex items-center gap-2">
                  <FiPlus /> {creating ? 'Creating…' : 'Create Organisation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
