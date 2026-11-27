import { useState } from 'react';
import type { CustomerQuoteView } from '../../lib/api';

const money = (n: number | undefined, currency: string) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(n ?? 0);
const day = (v?: string) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

type Body = { decision: 'accept' | 'reject'; name?: string; email?: string; note?: string };

/**
 * One quotation as the customer sees it, with Accept / Decline (AUT-32). Used by the emailed link
 * (asks for name and email) and by the customer portal (the signed-in person answers).
 */
export default function QuoteSheet({
  quote,
  askName,
  canRespond = true,
  onRespond,
}: {
  quote: CustomerQuoteView;
  askName?: boolean;
  canRespond?: boolean;
  onRespond: (body: Body) => Promise<string | null>;
}) {
  const [mode, setMode] = useState<'accept' | 'reject' | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!mode) return;
    if (askName && !name.trim()) return setError('Enter your name.');
    if (mode === 'reject' && !note.trim()) return setError('Tell us why, so we can do better.');
    setBusy(true);
    setError('');
    const err = await onRespond({ decision: mode, name: askName ? name.trim() : undefined, email: askName ? email.trim() || undefined : undefined, note: note.trim() || undefined });
    setBusy(false);
    if (err) setError(err);
    else setMode(null);
  }

  const done = quote.response;
  return (
    <article className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
      <header className="px-6 py-5 border-b border-[color:var(--border-subtle)]">
        <p className="text-xs uppercase tracking-wider text-[color:var(--text-muted)]">Quotation from {quote.company}</p>
        <h1 className="text-xl font-semibold mt-1">{quote.title}</h1>
        <p className="text-sm text-[color:var(--text-muted)] mt-1">
          {quote.customer ? `For ${quote.customer} · ` : ''}Issued {day(quote.issueDate)}
          {quote.validUntil ? ` · Valid until ${day(quote.validUntil)}` : ''}
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-[color:var(--text-muted)]">
            <tr>
              <th className="px-6 py-2 font-medium">Item</th>
              <th className="px-3 py-2 font-medium text-right">Qty</th>
              <th className="px-3 py-2 font-medium text-right">Rate</th>
              <th className="px-6 py-2 font-medium text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {quote.lineItems.map((l, i) => (
              <tr key={i} className="border-t border-[color:var(--border-subtle)]">
                <td className="px-6 py-2">
                  {l.description}
                  {l.discountPercent ? <span className="ml-2 text-xs text-[color:var(--text-muted)]">{l.discountPercent}% off</span> : null}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{l.quantity ?? 1}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(l.unitPrice, quote.currency)}</td>
                <td className="px-6 py-2 text-right tabular-nums">{money(l.amount, quote.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="px-6 py-4 border-t border-[color:var(--border-subtle)] text-sm space-y-1 ml-auto max-w-xs">
        <div className="flex justify-between"><dt className="text-[color:var(--text-muted)]">Subtotal</dt><dd className="tabular-nums">{money(quote.subtotal, quote.currency)}</dd></div>
        {quote.discountAmount ? <div className="flex justify-between"><dt className="text-[color:var(--text-muted)]">Discount</dt><dd className="tabular-nums">−{money(quote.discountAmount, quote.currency)}</dd></div> : null}
        {quote.taxTotal ? <div className="flex justify-between"><dt className="text-[color:var(--text-muted)]">Tax</dt><dd className="tabular-nums">{money(quote.taxTotal, quote.currency)}</dd></div> : null}
        <div className="flex justify-between font-semibold text-base pt-1"><dt>Total</dt><dd className="tabular-nums">{money(quote.total, quote.currency)}</dd></div>
      </dl>
      {quote.notes && <p className="px-6 pb-4 text-sm whitespace-pre-wrap text-[color:var(--text-muted)]">{quote.notes}</p>}

      <footer className="px-6 py-5 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]">
        {done ? (
          <p className={`text-sm font-medium ${done.decision === 'accepted' ? 'text-emerald-500' : 'text-red-400'}`} role="status">
            {done.decision === 'accepted' ? 'Accepted' : 'Declined'}
            {done.name ? ` by ${done.name}` : ''} on {day(done.at)}. {done.decision === 'accepted' ? 'Thank you, we will be in touch about next steps.' : 'Thank you for letting us know.'}
          </p>
        ) : quote.status === 'expired' ? (
          <p className="text-sm text-[color:var(--text-muted)]">This quotation has expired. Please contact us for an updated one.</p>
        ) : !quote.canRespond ? (
          <p className="text-sm text-[color:var(--text-muted)]">This quotation is {quote.status}.</p>
        ) : !canRespond ? (
          <p className="text-sm text-[color:var(--text-muted)]">Ask someone in your organisation who can approve quotations to accept it.</p>
        ) : mode ? (
          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            <p className="text-sm font-medium">{mode === 'accept' ? `Accept this quotation for ${money(quote.total, quote.currency)}` : 'Decline this quotation'}</p>
            {askName && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs space-y-1 block">
                  <span className="text-[color:var(--text-muted)]">Your name</span>
                  <input required className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                </label>
                <label className="text-xs space-y-1 block">
                  <span className="text-[color:var(--text-muted)]">Email (optional)</span>
                  <input type="email" className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                </label>
              </div>
            )}
            <label className="text-xs space-y-1 block">
              <span className="text-[color:var(--text-muted)]">{mode === 'reject' ? 'Why are you declining?' : 'Note (optional)'}</span>
              <textarea rows={2} required={mode === 'reject'} className="w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${mode === 'accept' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'} disabled:opacity-50`}>
                {mode === 'accept' ? 'Confirm acceptance' : 'Decline quotation'}
              </button>
              <button type="button" className="rounded-lg px-4 py-2 text-sm border border-[color:var(--border-subtle)]" onClick={() => { setMode(null); setError(''); }}>
                Back
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="rounded-lg px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700" onClick={() => setMode('accept')}>
              Accept quotation
            </button>
            <button type="button" className="rounded-lg px-4 py-2 text-sm border border-[color:var(--border-subtle)]" onClick={() => setMode('reject')}>
              Decline
            </button>
          </div>
        )}
      </footer>
    </article>
  );
}
