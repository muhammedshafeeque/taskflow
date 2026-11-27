import { useState } from 'react';
import { FiCopy } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { crmApi, type CrmQuote } from '../../lib/api';

const VIA: Record<string, string> = { staff: 'by staff', link: 'online, from the emailed link', portal: 'in the customer portal' };

/**
 * Quote page (AUT-32): how the customer answered, or, while the quotation is out, the link they use
 * to accept or decline it, for sharing another way than email.
 */
export default function QuoteResponsePanel({ quote, canUpdate }: { quote: CrmQuote; canUpdate: boolean }) {
  const { token } = useAuth();
  const [copied, setCopied] = useState('');
  const r = quote.response;
  if (r) {
    return (
      <div className={`rounded-xl border px-4 py-3 text-sm ${r.decision === 'accepted' ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
        <p className="font-semibold">
          {r.decision === 'accepted' ? 'Accepted' : 'Rejected'} {VIA[r.via] ?? ''}
          {r.name ? ` by ${r.name}` : ''}
          {r.email ? ` (${r.email})` : ''} on {new Date(r.at).toLocaleDateString()}
        </p>
        {r.note && <p className="mt-1 text-[color:var(--text-muted)] whitespace-pre-wrap">{r.note}</p>}
      </div>
    );
  }
  if (quote.status !== 'sent' || !canUpdate) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-4 py-3 text-sm">
      <p className="text-[color:var(--text-muted)]">The customer can accept or decline online, from the link in the email or in their portal.</p>
      <button
        type="button"
        className="inline-flex items-center gap-1.5 text-[color:var(--accent)] hover:underline"
        onClick={async () => {
          if (!token) return;
          const res = await crmApi.quoteResponseLink(quote._id, token);
          if (!res.success || !res.data) return setCopied(res.message ?? 'Could not get the link');
          try {
            await navigator.clipboard.writeText(res.data.url);
            setCopied('Link copied');
          } catch {
            setCopied(res.data.url);
          }
        }}
      >
        <FiCopy /> Copy customer link
      </button>
      {copied && <p className="w-full text-xs text-[color:var(--text-muted)] break-all" role="status">{copied}</p>}
    </div>
  );
}
