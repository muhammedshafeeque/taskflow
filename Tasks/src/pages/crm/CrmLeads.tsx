import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, type CrmLead } from '../../lib/api';

const SOURCES = ['web', 'referral', 'cold', 'partner', 'event', 'other'];

export default function CrmLeads() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const canCreate = canAny(user, 'taskflow.crm.lead.create');
  const canUpdate = canAny(user, 'taskflow.crm.lead.update');
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [modal, setModal] = useState(false);
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({
    title: '',
    source: 'web',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    companyName: '',
    notes: '',
  });

  const load = () => {
    if (!token) return;
    crmApi.listLeads(token, statusFilter || undefined).then((res) => {
      if (res.success && res.data) setLeads(res.data as CrmLead[]);
    });
  };

  useEffect(() => {
    load();
  }, [token, statusFilter]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !form.title.trim()) return;
    const res = await crmApi.createLead(
      {
        title: form.title.trim(),
        source: form.source,
        contactName: form.contactName.trim() || undefined,
        contactEmail: form.contactEmail.trim() || undefined,
        contactPhone: form.contactPhone.trim() || undefined,
        companyName: form.companyName.trim() || undefined,
        notes: form.notes.trim() || undefined,
      },
      token
    );
    if (res.success) {
      setModal(false);
      setForm({ title: '', source: 'web', contactName: '', contactEmail: '', contactPhone: '', companyName: '', notes: '' });
      load();
    }
  }

  async function convert(id: string) {
    if (!token || !canUpdate) return;
    setMsg('');
    const res = await crmApi.convertLead(id, undefined, token);
    if (!res.success) {
      setMsg((res as { message?: string }).message ?? 'Convert failed');
      return;
    }
    const data = res.data as { deal?: { _id: string }; account?: { _id: string } };
    setMsg('Lead converted');
    load();
    if (data?.account?._id) navigate(`/crm/accounts/${data.account._id}`);
    else navigate('/crm/deals');
  }

  async function markLost(id: string) {
    if (!token || !canUpdate) return;
    await crmApi.updateLead(id, { status: 'lost' }, token);
    load();
  }

  return (
    <div className="p-8 w-full px-4 sm:px-6 lg:px-8 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Leads</h1>
          <p className="text-[13px] text-[color:var(--text-muted)]">Capture and convert inbound opportunities.</p>
        </div>
        <div className="flex gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="new">new</option>
            <option value="qualified">qualified</option>
            <option value="converted">converted</option>
            <option value="lost">lost</option>
          </select>
          {canCreate && (
            <button type="button" onClick={() => setModal(true)} className="btn-primary px-4 py-2 rounded-lg text-sm">
              Add lead
            </button>
          )}
        </div>
      </div>
      {msg && <p className="text-sm text-[color:var(--accent)]">{msg}</p>}
      <div className="space-y-2">
        {leads.map((l) => (
          <div key={l._id} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 flex flex-wrap justify-between items-center gap-3">
            <div>
              <p className="font-medium">{l.title}</p>
              <p className="text-sm text-[color:var(--text-muted)]">
                {l.source} · {l.status}
                {l.companyName && ` · ${l.companyName}`}
                {l.contactName && ` · ${l.contactName}`}
                {l.contactEmail && ` · ${l.contactEmail}`}
              </p>
            </div>
            {l.status !== 'converted' && l.status !== 'lost' && canUpdate && (
              <div className="flex gap-2">
                <button type="button" onClick={() => void convert(l._id)} className="text-sm text-[color:var(--accent)] hover:underline">
                  Convert
                </button>
                <button type="button" onClick={() => void markLost(l._id)} className="text-sm text-[color:var(--text-muted)] hover:underline">
                  Mark lost
                </button>
              </div>
            )}
          </div>
        ))}
        {leads.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No leads yet.</p>}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={() => setModal(false)}>
          <form onSubmit={create} className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl max-w-md w-full p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">New lead</h2>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Title</span>
              <input required value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" placeholder="Opportunity title" />
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Source</span>
              <select value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm">
                {SOURCES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Company</span>
              <input value={form.companyName} onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Contact name</span>
                <input value={form.contactName} onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
              </label>
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">Contact email</span>
                <input value={form.contactEmail} onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
              </label>
            </div>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Phone</span>
              <input value={form.contactPhone} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-[color:var(--text-muted)]">Notes</span>
              <textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm" />
            </label>
            <div className="flex gap-2 pt-2">
              <button type="submit" className="btn-primary px-4 py-2 rounded-lg text-sm">Create</button>
              <button type="button" onClick={() => setModal(false)} className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
