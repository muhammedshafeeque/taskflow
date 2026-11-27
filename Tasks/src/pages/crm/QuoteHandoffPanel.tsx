import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FiRefreshCw } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { crmApi, type CrmQuote, type QuoteHandoffStep } from '../../lib/api';

const LABEL: Record<QuoteHandoffStep, string> = {
  account: 'Billing account',
  contract: 'Draft contract',
  invoice: 'Draft invoice',
  delivery: 'Customer and project links',
  deal: 'Deal marked won',
};

const LINK: Partial<Record<QuoteHandoffStep, (id: string) => string>> = {
  contract: (id) => `/contracts/${id}`,
  invoice: (id) => `/billing/invoices/${id}`,
  delivery: (id) => `/projects/${id}/dashboard`,
  deal: (id) => `/crm/deals/${id}`,
};

/**
 * What happened after the quotation was accepted (AUT-33): each handoff step, and when one failed,
 * what went wrong with a Retry that finishes the rest without making duplicates.
 */
export default function QuoteHandoffPanel({ quote, canUpdate, onChanged }: { quote: CrmQuote; canUpdate: boolean; onChanged: () => void }) {
  const { token } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const h = quote.handoff;
  if (quote.status !== 'accepted' || !h) return null;
  const failed = h.status === 'failed';
  const steps = h.steps.filter((s) => s.status !== 'skipped');

  return (
    <section
      aria-label="After acceptance"
      className={`rounded-xl border px-4 py-3 text-sm ${failed ? 'border-red-500/50 bg-red-500/5' : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {failed ? `Accepted, but the ${LABEL[h.failedStep!].toLowerCase()} step failed` : 'Handed off to billing and delivery'}
          </p>
          {failed && <p className="mt-0.5 text-[color:var(--text-muted)] break-words">{h.error}</p>}
          <p className="mt-0.5 text-[11px] text-[color:var(--text-muted)]">
            {h.attempts > 1 ? `${h.attempts} attempts · ` : ''}last run {new Date(h.lastAttemptAt).toLocaleString()}
          </p>
        </div>
        {failed && canUpdate && (
          <button
            type="button"
            disabled={busy}
            className="btn-primary inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
            onClick={async () => {
              if (!token) return;
              setBusy(true);
              setMessage('');
              const res = await crmApi.retryQuoteHandoff(quote._id, token);
              setBusy(false);
              if (!res.success) setMessage(res.message ?? 'Retry failed');
              else if (res.data?.handoff.status === 'failed') setMessage(`Still failing: ${res.data.handoff.error ?? 'unknown error'}`);
              onChanged();
            }}
          >
            <FiRefreshCw className={busy ? 'animate-spin' : ''} /> Retry
          </button>
        )}
      </div>
      <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        {steps.map((s) => {
          const to = s.status === 'done' && s.refId ? LINK[s.key]?.(s.refId) : undefined;
          const mark = s.status === 'done' ? '✓' : '✕';
          return (
            <li key={s.key} className={s.status === 'failed' ? 'text-red-400' : 'text-[color:var(--text-muted)]'}>
              <span aria-hidden>{mark} </span>
              {to ? <Link className="hover:underline" to={to}>{LABEL[s.key]}</Link> : LABEL[s.key]}
              <span className="sr-only">: {s.status}</span>
            </li>
          );
        })}
        {failed && <li className="text-[color:var(--text-muted)]">Later steps run on retry</li>}
      </ol>
      {message && <p className="mt-2 text-[12px] text-red-400" role="alert">{message}</p>}
    </section>
  );
}
