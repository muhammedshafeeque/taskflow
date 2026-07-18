import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
      <Link to="/crm/accounts" className="text-sm text-[color:var(--accent)] hover:underline">← Accounts</Link>
      <h1 className="text-xl font-semibold mt-2 mb-1">{view.account.name}</h1>
      <p className="text-[color:var(--text-muted)] text-sm mb-6 capitalize">
        {view.account.type}
        {view.account.industry ? ` · ${view.account.industry}` : ''}
        {view.account.website ? ` · ${view.account.website}` : ''}
      </p>

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
                <Link to="/crm/deals" className="text-[color:var(--accent)] hover:underline">{d.title}</Link>
                {' '}— ${d.value} ({d.status})
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
                <Link to="/crm/quotes" className="text-[color:var(--accent)] hover:underline">{q.title}</Link>
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
            <div className="flex gap-2 mb-3">
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
    </div>
  );
}
