import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';

/** Shared look for the no-sign-in hiring pages (AUT-37). */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[color:var(--bg-page)] text-[color:var(--text-primary)] flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-3xl space-y-5">{children}</div>
    </div>
  );
}
const input = 'w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm';
const card = 'rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]';
const day = (v?: string) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '');

type OfferView = {
  company: string;
  name: string;
  designation?: string;
  annualCtc: number;
  currency: string;
  joiningDate?: string;
  expiresAt?: string;
  letter: string;
  status: 'open' | 'accepted' | 'declined' | 'expired' | string;
  response: { decision: string; name?: string; at?: string } | null;
};

/** /offer/:token: the candidate reads the offer and accepts it (typing their name) or declines it. */
export function PublicOffer() {
  const { token = '' } = useParams<{ token: string }>();
  const [offer, setOffer] = useState<OfferView | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'accept' | 'decline' | null>(null);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.get<OfferView>(`/public/offers/${encodeURIComponent(token)}`).then((r) => (r.success && r.data ? setOffer(r.data) : setError(r.message ?? 'This offer link is invalid or has expired.')));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mode) return;
    setBusy(true);
    setError('');
    const r = await api.post<OfferView>(`/public/offers/${encodeURIComponent(token)}/respond`, { decision: mode, name, note: note || undefined });
    setBusy(false);
    if (r.success && r.data) {
      setOffer(r.data);
      setMode(null);
    } else setError(r.message ?? 'Could not save your answer');
  };

  if (!offer) return <Shell><p className="text-center text-sm text-[color:var(--text-muted)]">{error || 'Loading…'}</p></Shell>;
  return (
    <Shell>
      <article className={card}>
        <header className="px-6 py-5 border-b border-[color:var(--border-subtle)]">
          <p className="text-xs uppercase tracking-wider text-[color:var(--text-muted)]">Offer from {offer.company}</p>
          <h1 className="text-xl font-semibold mt-1">{offer.designation}</h1>
          <p className="text-sm text-[color:var(--text-muted)] mt-1">
            {offer.currency} {offer.annualCtc.toLocaleString()} a year{offer.joiningDate ? ` · starting ${day(offer.joiningDate)}` : ''}
            {offer.expiresAt ? ` · please respond by ${day(offer.expiresAt)}` : ''}
          </p>
        </header>
        <div className="px-6 py-5 whitespace-pre-wrap text-sm leading-relaxed">{offer.letter}</div>
        <footer className="px-6 py-5 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]">
          {offer.status === 'accepted' || offer.status === 'declined' ? (
            <p className={`text-sm font-medium ${offer.status === 'accepted' ? 'text-emerald-500' : 'text-red-400'}`} role="status">
              {offer.status === 'accepted' ? 'Accepted' : 'Declined'}
              {offer.response?.name ? ` by ${offer.response.name}` : ''}
              {offer.response?.at ? ` on ${day(offer.response.at)}` : ''}. {offer.status === 'accepted' ? 'Welcome aboard! We will be in touch about your first day.' : 'Thank you for letting us know.'}
            </p>
          ) : offer.status === 'expired' ? (
            <p className="text-sm text-[color:var(--text-muted)]">This offer has expired. Please contact us.</p>
          ) : mode ? (
            <form onSubmit={(e) => void submit(e)} className="space-y-3">
              <label className="block text-xs space-y-1">
                <span className="text-[color:var(--text-muted)]">{mode === 'accept' ? 'Type your full name to accept' : 'Your name'}</span>
                <input required className={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </label>
              {mode === 'decline' && (
                <label className="block text-xs space-y-1">
                  <span className="text-[color:var(--text-muted)]">Anything you'd like to tell us (optional)</span>
                  <textarea rows={2} className={input} value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
              )}
              {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${mode === 'accept' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'}`}>
                  {mode === 'accept' ? 'Accept offer' : 'Decline offer'}
                </button>
                <button type="button" className="rounded-lg px-4 py-2 text-sm border border-[color:var(--border-subtle)]" onClick={() => setMode(null)}>Back</button>
              </div>
            </form>
          ) : (
            <div className="flex gap-3">
              <button type="button" className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700" onClick={() => setMode('accept')}>Accept</button>
              <button type="button" className="rounded-lg px-4 py-2 text-sm border border-[color:var(--border-subtle)]" onClick={() => setMode('decline')}>Decline</button>
            </div>
          )}
        </footer>
      </article>
    </Shell>
  );
}

type Job = { _id: string; title: string; department?: string; location?: string; employmentType?: string; description?: string };

/** /careers/:slug: a company's open, published openings, with an application form for each. */
export function PublicCareers() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [page, setPage] = useState<{ company: string; intro: string; jobs: Job[] } | null>(null);
  const [error, setError] = useState('');
  const [applying, setApplying] = useState<Job | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', resumeUrl: '', coverNote: '', website: '' });
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.get<{ company: string; intro: string; jobs: Job[] }>(`/public/careers/${encodeURIComponent(slug)}`).then((r) => (r.success && r.data ? setPage(r.data) : setError(r.message ?? 'Careers page not found')));
  }, [slug]);

  const apply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!applying) return;
    setBusy(true);
    setError('');
    const r = await api.post(`/public/careers/${encodeURIComponent(slug)}/jobs/${applying._id}/apply`, form);
    setBusy(false);
    if (!r.success) return setError(r.message ?? 'Could not send your application');
    setDone(`Thank you, ${form.name}. Your application for ${applying.title} was received.`);
    setApplying(null);
    setForm({ name: '', email: '', phone: '', resumeUrl: '', coverNote: '', website: '' });
  };

  if (!page) return <Shell><p className="text-center text-sm text-[color:var(--text-muted)]">{error || 'Loading…'}</p></Shell>;
  return (
    <Shell>
      <header>
        <h1 className="text-2xl font-semibold">Careers at {page.company}</h1>
        {page.intro && <p className="mt-2 text-sm text-[color:var(--text-muted)] whitespace-pre-wrap">{page.intro}</p>}
      </header>
      {done && <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-sm" role="status">{done}</p>}
      {page.jobs.length === 0 ? (
        <p className={`${card} p-8 text-center text-sm text-[color:var(--text-muted)]`}>No open positions right now. Please check back later.</p>
      ) : (
        page.jobs.map((j) => (
          <section key={j._id} className={`${card} p-5 space-y-3`}>
            <div>
              <h2 className="text-lg font-semibold">{j.title}</h2>
              <p className="text-sm text-[color:var(--text-muted)]">{[j.department, j.location, j.employmentType?.replace('_', ' ')].filter(Boolean).join(' · ')}</p>
            </div>
            {j.description && <p className="text-sm whitespace-pre-wrap">{j.description}</p>}
            {applying?._id === j._id ? (
              <form onSubmit={(e) => void apply(e)} className="space-y-3 border-t border-[color:var(--border-subtle)] pt-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <input required placeholder="Full name" aria-label="Full name" className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
                  <input required type="email" placeholder="Email" aria-label="Email" className={input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
                  <input placeholder="Phone (optional)" aria-label="Phone" className={input} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" />
                  <input type="url" placeholder="Link to your CV (optional)" aria-label="Link to your CV" className={input} value={form.resumeUrl} onChange={(e) => setForm({ ...form, resumeUrl: e.target.value })} />
                </div>
                <textarea rows={3} placeholder="Why you'd like to join (optional)" aria-label="Cover note" className={input} value={form.coverNote} onChange={(e) => setForm({ ...form, coverNote: e.target.value })} />
                {/* Left empty by people; filled by bots. */}
                <input tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} name="website" />
                {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={busy} className="btn-primary rounded-lg px-4 py-2 text-sm disabled:opacity-50">Send application</button>
                  <button type="button" className="rounded-lg px-4 py-2 text-sm border border-[color:var(--border-subtle)]" onClick={() => setApplying(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <button type="button" className="btn-primary rounded-lg px-4 py-2 text-sm" onClick={() => { setApplying(j); setDone(''); setError(''); }}>Apply</button>
            )}
          </section>
        ))
      )}
    </Shell>
  );
}
