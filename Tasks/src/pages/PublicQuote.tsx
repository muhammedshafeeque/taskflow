import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { publicQuoteApi, type CustomerQuoteView } from '../lib/api';
import QuoteSheet from './portal/QuoteSheet';

/** /quote/:token: the customer reviews a quotation and accepts or declines it (AUT-32). No sign-in. */
export default function PublicQuote() {
  const { token = '' } = useParams<{ token: string }>();
  const [quote, setQuote] = useState<CustomerQuoteView | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void publicQuoteApi.get(token).then((r) => {
      if (r.success && r.data) setQuote(r.data);
      else setError(r.message ?? 'This link is invalid or has expired.');
    });
  }, [token]);

  return (
    <div className="min-h-screen bg-[color:var(--bg-page)] text-[color:var(--text-primary)] flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-3xl space-y-5">
        {error ? (
          <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-8 text-center">
            <p className="font-semibold">We couldn't open this quotation</p>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">{error}</p>
          </div>
        ) : !quote ? (
          <p className="text-center text-sm text-[color:var(--text-muted)]">Loading…</p>
        ) : (
          <QuoteSheet
            quote={quote}
            askName
            onRespond={async (body) => {
              const r = await publicQuoteApi.respond(token, { ...body, name: body.name ?? '' });
              if (r.success && r.data) setQuote(r.data);
              return r.success ? null : r.message ?? 'Could not save your answer.';
            }}
          />
        )}
      </div>
    </div>
  );
}
