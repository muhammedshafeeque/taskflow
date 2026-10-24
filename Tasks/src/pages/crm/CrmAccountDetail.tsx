import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FiArrowLeft, FiEdit2, FiPlus, FiTrash2 } from 'react-icons/fi';
import ConfirmModal from '../../components/ConfirmModal';
import { Chip, Field, Modal, Notice, btnDanger, btnPrimary, btnSecondary, errorOf, inputCls, prettyLabel } from './crmKit';
import { CrmEmailPanel } from './CrmSalesTools';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { crmApi, projectsApi, type CrmContract, type CrmQuote, type Project } from '../../lib/api';
import { money } from '../../components/moduleKit';

export default function CrmAccountDetail() {
  const { id } = useParams<{ id: string }>();
  const { token, user } = useAuth();
  const canContact = canAny(user, 'taskflow.crm.contact.create');
  const canActivity = canAny(user, 'taskflow.crm.activity.create');
  const canUpdate = canAny(user, 'taskflow.crm.account.update');
  const canDelete = canAny(user, 'taskflow.crm.account.delete');
  const canDeal = canAny(user, 'taskflow.crm.deal.create');
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<{
    account: { name: string; type: string; notes?: string; industry?: string; website?: string };
    contacts: Array<{ _id: string; name: string; email?: string; isPrimary?: boolean }>;
    activities: Array<{ _id: string; type: string; subject: string }>;
    deals: Array<{ _id: string; title: string; value: number; status: string }>;
    projects: Array<{ _id: string; name: string; key: string }>;
    requests: Array<{ _id: string; title: string; status: string }>;
    invoices?: Array<{ _id: string; number: string; status: string; total: number; currency: string }>;
    subscriptions?: Array<{ _id: string; name: string; status: string; amount: number; currency: string; billingCycle: string }>;
    tickets?: Array<{ _id: string; subject: string; status: string; priority: string }>;
    assets?: Array<{ _id: string; name: string; assetTag: string; status: string }>;
    documents?: Array<{ _id: string; title: string; kind: string; status: string }>;
    financials?: {
      lifetimeValue: number;
      contractValue: number;
      invoiced: number;
      collected: number;
      outstanding: number;
      mrr: number;
      openTickets: number;
    };
  } | null>(null);
  const [contracts, setContracts] = useState<CrmContract[]>([]);
  const [quotes, setQuotes] = useState<CrmQuote[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [note, setNote] = useState('');
  const [followDue, setFollowDue] = useState('');
  const [contactForm, setContactForm] = useState({ name: '', email: '', phone: '' });
  const [linkProjectId, setLinkProjectId] = useState('');

  const load = () => {
    if (!token || !id) return;
    crmApi.getAccount360(id, token).then((res) => {
      if (res.success && res.data) setView(res.data as typeof view);
    });
    crmApi.listContracts(token, { accountId: id }).then((res) => {
      if (res.success && res.data) setContracts(res.data as CrmContract[]);
    });
  };

  useEffect(() => {
    load();
  }, [token, id]);

  useEffect(() => {
    if (!token || !id) return;
    crmApi.listQuotes(token, { accountId: id }).then((res) => {
      if (res.success && res.data) setQuotes(res.data as CrmQuote[]);
    });
    if (canUpdate) {
      projectsApi.list(1, 100, token).then((res) => {
        if (res.success && res.data) setProjects(res.data.data ?? []);
      });
    }
  }, [token, id, canUpdate]);

  const addNote = async () => {
    if (!token || !id || !note.trim()) return;
    await crmApi.createActivity({ type: 'note', subject: note.trim(), relatedType: 'account', relatedId: id }, token);
    setNote('');
    load();
  };

  const addFollowUp = async () => {
    if (!token || !id || !followDue) return;
    await crmApi.createActivity(
      {
        type: 'follow_up',
        subject: `Follow up: ${view?.account.name || 'Account'}`,
        dueAt: new Date(followDue).toISOString(),
        relatedType: 'account',
        relatedId: id,
      },
      token
    );
    setFollowDue('');
    load();
  };

  const addContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !id || !contactForm.name.trim()) return;
    await crmApi.createContact(
      {
        accountId: id,
        name: contactForm.name.trim(),
        email: contactForm.email.trim() || undefined,
        phone: contactForm.phone.trim() || undefined,
      },
      token
    );
    setContactForm({ name: '', email: '', phone: '' });
    load();
  };

  const linkProject = async () => {
    if (!token || !id || !linkProjectId) return;
    await crmApi.linkProject(id, linkProjectId, token);
    setLinkProjectId('');
    load();
  };

  if (!view) return <div className="p-8 text-[color:var(--text-muted)]">Loading account…</div>;

  return (
    <div className="p-8 w-full px-4 sm:px-6 lg:px-8">
      <header className="relative overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-5 py-5 sm:px-7 mb-6">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 100% at 0% 0%, color-mix(in srgb, #0ea5e9 14%, transparent), transparent 50%), radial-gradient(ellipse 50% 80% at 100% 100%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 45%)',
          }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">CRM · Account</p>
            <h1 className="text-2xl font-bold tracking-tight mt-1">{view.account.name}</h1>
            <p className="text-[13px] text-[color:var(--text-muted)] mt-1 flex flex-wrap items-center gap-2">
              <Chip tone={view.account.type === 'client' ? 'good' : view.account.type === 'prospect' ? 'info' : 'neutral'}>{prettyLabel(view.account.type)}</Chip>
              {view.account.industry && <span>{view.account.industry}</span>}
              {view.account.website && (
                <a href={/^https?:\/\//.test(view.account.website) ? view.account.website : `https://${view.account.website}`} target="_blank" rel="noreferrer" className="text-[color:var(--accent)] hover:underline">
                  {view.account.website}
                </a>
              )}
            </p>
            {view.account.notes && <p className="text-xs text-[color:var(--text-muted)] mt-2 max-w-2xl whitespace-pre-wrap">{view.account.notes}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/crm/accounts" className={btnSecondary}>
              <FiArrowLeft /> Accounts
            </Link>
            {canDeal && (
              <Link to="/crm/deals" className={btnSecondary}>
                <FiPlus /> Deal
              </Link>
            )}
            {canUpdate && (
              <button type="button" className={btnPrimary} onClick={() => setEditOpen(true)}>
                <FiEdit2 /> Edit
              </button>
            )}
            {canDelete && (
              <button type="button" className={btnDanger} onClick={() => setConfirmDelete(true)} aria-label="Delete account">
                <FiTrash2 />
              </button>
            )}
          </div>
        </div>
      </header>
      <div className="mb-4">
        <Notice message={notice} onClose={() => setNotice(null)} />
      </div>

      {view.financials && (
        <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6 mb-6">
          {[
            { label: 'Lifetime value', value: money(view.financials.lifetimeValue) },
            { label: 'Contract value', value: money(view.financials.contractValue) },
            { label: 'MRR', value: money(view.financials.mrr) },
            { label: 'Invoiced', value: money(view.financials.invoiced) },
            { label: 'Outstanding', value: money(view.financials.outstanding) },
            { label: 'Open tickets', value: String(view.financials.openTickets) },
          ].map((m) => (
            <div key={m.label} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-4 py-3">
              <p className="text-[11px] text-[color:var(--text-muted)]">{m.label}</p>
              <p className="text-lg font-bold tabular-nums">{m.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[color:var(--border-subtle)] p-5">
          <h2 className="font-medium mb-3">Contacts</h2>
          <ul className="space-y-2 text-sm mb-4">
            {view.contacts.map((c) => (
              <li key={c._id}>
                {c.name} {c.isPrimary && <span className="text-[color:var(--accent)]">(primary)</span>}
                {c.email && <span className="text-[color:var(--text-muted)]"> — {c.email}</span>}
              </li>
            ))}
            {view.contacts.length === 0 && <li className="text-[color:var(--text-muted)]">No contacts.</li>}
          </ul>
          {canContact && (
            <form onSubmit={addContact} className="space-y-2 border-t border-[color:var(--border-subtle)] pt-3">
              <input className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm" placeholder="Name" value={contactForm.name} onChange={(e) => setContactForm((f) => ({ ...f, name: e.target.value }))} required />
              <div className="grid grid-cols-2 gap-2">
                <input className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm" placeholder="Email" value={contactForm.email} onChange={(e) => setContactForm((f) => ({ ...f, email: e.target.value }))} />
                <input className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm" placeholder="Phone" value={contactForm.phone} onChange={(e) => setContactForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <button type="submit" className="btn-primary px-3 py-1.5 rounded-lg text-xs">Add contact</button>
            </form>
          )}
        </section>

        <section className="rounded-2xl border border-[color:var(--border-subtle)] p-5">
          <h2 className="font-medium mb-3">Deals</h2>
          <ul className="space-y-2 text-sm">
            {view.deals.map((d) => (
              <li key={d._id}>
                <Link to={`/crm/deals/${d._id}`} className="text-[color:var(--accent)] hover:underline">{d.title}</Link>
                {' '}— {money(d.value)} <Chip tone={d.status === 'won' ? 'good' : d.status === 'lost' ? 'bad' : 'accent'}>{prettyLabel(d.status)}</Chip>
              </li>
            ))}
            {view.deals.length === 0 && <li className="text-[color:var(--text-muted)]">No deals.</li>}
          </ul>
        </section>

        <section className="rounded-2xl border border-[color:var(--border-subtle)] p-5">
          <h2 className="font-medium mb-3">Projects</h2>
          <ul className="space-y-2 text-sm mb-3">
            {view.projects.map((p) => (
              <li key={p._id}>
                <Link to={`/projects/${p._id}/dashboard`} className="text-[color:var(--accent)] hover:underline">
                  {p.key} — {p.name}
                </Link>
              </li>
            ))}
            {view.projects.length === 0 && <li className="text-[color:var(--text-muted)]">No linked projects.</li>}
          </ul>
          {canUpdate && (
            <div className="flex gap-2 border-t border-[color:var(--border-subtle)] pt-3">
              <select value={linkProjectId} onChange={(e) => setLinkProjectId(e.target.value)} className="flex-1 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1.5 text-sm">
                <option value="">Link project…</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>{p.key} · {p.name}</option>
                ))}
              </select>
              <button type="button" disabled={!linkProjectId} onClick={() => void linkProject()} className="btn-primary px-3 py-1.5 rounded-lg text-xs disabled:opacity-50">
                Link
              </button>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[color:var(--border-subtle)] p-5">
          <h2 className="font-medium mb-3">Contracts & quotes</h2>
          <ul className="space-y-2 text-sm mb-3">
            {contracts.map((c) => (
              <li key={c._id}>
                <Link to="/crm/contracts" className="text-[color:var(--accent)] hover:underline">{c.title}</Link>
                {' '}— {c.status} · ${c.value}
              </li>
            ))}
            {quotes.map((q) => (
              <li key={q._id}>
                <Link to={`/crm/quotes/${q._id}`} className="text-[color:var(--accent)] hover:underline">{q.title}</Link>
                {' '}— {q.status} · {q.subtotal} {q.currency}
              </li>
            ))}
            {contracts.length === 0 && quotes.length === 0 && (
              <li className="text-[color:var(--text-muted)]">No contracts or quotes.</li>
            )}
          </ul>
          <ul className="space-y-1 text-sm border-t border-[color:var(--border-subtle)] pt-3">
            <li className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Portal requests</li>
            {view.requests.map((r) => (
              <li key={r._id}>{r.title} ({r.status})</li>
            ))}
            {view.requests.length === 0 && <li className="text-[color:var(--text-muted)]">None</li>}
          </ul>
        </section>

        <section className="rounded-2xl border border-[color:var(--border-subtle)] p-5">
          <h2 className="font-medium mb-3">Billing</h2>
          <ul className="space-y-1.5 text-sm mb-3">
            <li className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Subscriptions</li>
            {(view.subscriptions ?? []).map((s) => (
              <li key={s._id} className="flex justify-between">
                <Link to="/billing/subscriptions" className="text-[color:var(--accent)] hover:underline">{s.name}</Link>
                <span className="text-[color:var(--text-muted)]">{money(s.amount, s.currency)} / {s.billingCycle}</span>
              </li>
            ))}
            {(view.subscriptions ?? []).length === 0 && <li className="text-[color:var(--text-muted)]">No subscriptions.</li>}
          </ul>
          <ul className="space-y-1.5 text-sm border-t border-[color:var(--border-subtle)] pt-3">
            <li className="text-[11px] uppercase tracking-wide text-[color:var(--text-muted)]">Recent invoices</li>
            {(view.invoices ?? []).slice(0, 6).map((i) => (
              <li key={i._id} className="flex justify-between">
                <Link to="/billing/invoices" className="text-[color:var(--accent)] hover:underline">{i.number}</Link>
                <span className="text-[color:var(--text-muted)] capitalize">{i.status} · {money(i.total, i.currency)}</span>
              </li>
            ))}
            {(view.invoices ?? []).length === 0 && <li className="text-[color:var(--text-muted)]">No invoices.</li>}
          </ul>
        </section>

        <section className="rounded-2xl border border-[color:var(--border-subtle)] p-5">
          <h2 className="font-medium mb-3">Support tickets</h2>
          <ul className="space-y-2 text-sm">
            {(view.tickets ?? []).map((t) => (
              <li key={t._id} className="flex justify-between gap-2">
                <Link to="/service/tickets" className="text-[color:var(--accent)] hover:underline truncate">{t.subject}</Link>
                <span className="text-[color:var(--text-muted)] capitalize shrink-0">{t.status} · {t.priority}</span>
              </li>
            ))}
            {(view.tickets ?? []).length === 0 && <li className="text-[color:var(--text-muted)]">No tickets.</li>}
          </ul>
        </section>

        <section className="rounded-2xl border border-[color:var(--border-subtle)] p-5">
          <h2 className="font-medium mb-3">Assets</h2>
          <ul className="space-y-2 text-sm">
            {(view.assets ?? []).map((a) => (
              <li key={a._id} className="flex justify-between gap-2">
                <Link to="/assets/inventory" className="text-[color:var(--accent)] hover:underline truncate">{a.name}</Link>
                <span className="text-[color:var(--text-muted)] capitalize shrink-0">{a.assetTag} · {a.status}</span>
              </li>
            ))}
            {(view.assets ?? []).length === 0 && <li className="text-[color:var(--text-muted)]">No assets.</li>}
          </ul>
        </section>

        <section className="rounded-2xl border border-[color:var(--border-subtle)] p-5">
          <h2 className="font-medium mb-3">Documents</h2>
          <ul className="space-y-2 text-sm">
            {(view.documents ?? []).map((d) => (
              <li key={d._id} className="flex justify-between gap-2">
                <Link to="/documents/proposals" className="text-[color:var(--accent)] hover:underline truncate">{d.title}</Link>
                <span className="text-[color:var(--text-muted)] capitalize shrink-0">{d.kind} · {d.status}</span>
              </li>
            ))}
            {(view.documents ?? []).length === 0 && <li className="text-[color:var(--text-muted)]">No documents.</li>}
          </ul>
        </section>

        <section className="rounded-2xl border border-[color:var(--border-subtle)] p-5 lg:col-span-2">
          <h2 className="font-medium mb-3">Timeline</h2>
          {canActivity && (
            <div className="space-y-2 mb-3">
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
                  placeholder="Add note…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <button type="button" onClick={addNote} className="btn-primary px-4 py-2 rounded-lg text-sm">
                  Add
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="date"
                  className="flex-1 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm"
                  value={followDue}
                  onChange={(e) => setFollowDue(e.target.value)}
                />
                <button type="button" onClick={addFollowUp} className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm">
                  Log follow-up
                </button>
              </div>
            </div>
          )}
          <ul className="space-y-2 text-sm">
            {view.activities.map((a) => (
              <li key={a._id}>
                <span className="text-[color:var(--text-muted)]">{a.type}</span> — {a.subject}
              </li>
            ))}
            {view.activities.length === 0 && <li className="text-[color:var(--text-muted)]">No activity yet.</li>}
          </ul>
        </section>
      </div>
      {id && (
        <div className="mt-6">
          <CrmEmailPanel relatedType="account" relatedId={id} />
        </div>
      )}
      {editOpen && (
        <AccountEditModal
          id={id!}
          account={view.account}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            load();
          }}
        />
      )}
      <ConfirmModal
        open={confirmDelete}
        title={`Delete ${view.account.name}?`}
        message="The account and its contacts are deleted. Deals, quotes and contracts are kept."
        confirmLabel="Delete account"
        onConfirm={async () => {
          setConfirmDelete(false);
          const res = await crmApi.deleteAccount(id!, token!);
          if (!res.success) return setNotice(errorOf(res, 'Could not delete the account.'));
          navigate('/crm/accounts');
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function AccountEditModal({
  id,
  account,
  onClose,
  onSaved,
}: {
  id: string;
  account: { name: string; type: string; notes?: string; industry?: string; website?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const [form, setForm] = useState({
    name: account.name,
    type: account.type,
    industry: account.industry ?? '',
    website: account.website ?? '',
    notes: account.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Modal open title="Edit account" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!token || !form.name.trim()) return;
          setSaving(true);
          const res = await crmApi.updateAccount(
            id,
            { name: form.name.trim(), type: form.type, industry: form.industry.trim(), website: form.website.trim(), notes: form.notes.trim() },
            token
          );
          setSaving(false);
          if (!res.success) return setError(errorOf(res, 'Could not save the account.'));
          onSaved();
        }}
      >
        <Field label="Name">
          <input required autoFocus value={form.name} onChange={(e) => set({ name: e.target.value })} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <select value={form.type} onChange={(e) => set({ type: e.target.value })} className={inputCls}>
              {['prospect', 'client', 'partner', 'vendor'].map((t) => (
                <option key={t} value={t}>
                  {prettyLabel(t)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Industry">
            <input value={form.industry} onChange={(e) => set({ industry: e.target.value })} className={inputCls} />
          </Field>
        </div>
        <Field label="Website">
          <input value={form.website} onChange={(e) => set({ website: e.target.value })} className={inputCls} placeholder="example.com" />
        </Field>
        <Field label="Notes">
          <textarea rows={3} value={form.notes} onChange={(e) => set({ notes: e.target.value })} className={inputCls} />
        </Field>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={btnPrimary}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
