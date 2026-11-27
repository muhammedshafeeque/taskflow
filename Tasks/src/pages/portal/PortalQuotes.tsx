import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { customerQuotesApi, type CustomerQuoteView } from '../../lib/api';
import { userHasPermission } from '../../utils/permissions';
import { CUSTOMER_PERMISSIONS } from '@shared/constants/permissions';
import QuoteSheet from './QuoteSheet';

/** Portal: quotations sent to the customer's organisation, to accept or decline (AUT-32). */
export default function PortalQuotes() {
  const { token, user } = useAuth();
  const [quotes, setQuotes] = useState<CustomerQuoteView[] | null>(null);
  const [error, setError] = useState('');
  const canRespond = userHasPermission(user?.customerPermissions ?? [], CUSTOMER_PERMISSIONS.QUOTE.QUOTE.RESPOND);

  useEffect(() => {
    if (!token) return;
    void customerQuotesApi.list(token).then((r) => {
      if (r.success && r.data) setQuotes(r.data);
      else setError(r.message ?? 'Could not load quotations');
    });
  }, [token]);

  const waiting = (quotes ?? []).filter((q) => q.canRespond);
  const past = (quotes ?? []).filter((q) => !q.canRespond);

  return (
    <div className="p-4 md:p-8 animate-fade-in space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold">Quotations</h1>
        <p className="text-sm text-[color:var(--text-muted)] mt-1">Review the quotations we've sent you, and accept or decline them here.</p>
      </div>
      {error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-400">{error}</div>
      ) : quotes === null ? (
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      ) : quotes.length === 0 ? (
        <div className="rounded-xl border border-[color:var(--border-subtle)] p-12 text-center text-sm text-[color:var(--text-muted)]">No quotations yet.</div>
      ) : (
        <>
          {waiting.length > 0 && <h2 className="text-sm font-semibold">Waiting for your answer</h2>}
          {waiting.map((q) => (
            <QuoteSheet
              key={q._id}
              quote={q}
              canRespond={canRespond}
              onRespond={async (body) => {
                const r = await customerQuotesApi.respond(q._id, { decision: body.decision, note: body.note }, token!);
                if (r.success && r.data) setQuotes((list) => (list ?? []).map((x) => (x._id === q._id ? r.data! : x)));
                return r.success ? null : r.message ?? 'Could not save your answer.';
              }}
            />
          ))}
          {past.length > 0 && <h2 className="text-sm font-semibold pt-2">Earlier quotations</h2>}
          {past.map((q) => (
            <QuoteSheet key={q._id} quote={q} canRespond={false} onRespond={async () => null} />
          ))}
        </>
      )}
    </div>
  );
}
