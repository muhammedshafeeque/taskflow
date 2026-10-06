import { useEffect, useState } from 'react';
import DOMPurify from 'dompurify';
import { portalKbApi, type PortalKbSuggestion } from '../../lib/api';

/** Shows help articles matching what the customer is typing — many requests answer themselves. */
export default function KbSuggestions({ query, token }: { query: string; token: string }) {
  const [items, setItems] = useState<PortalKbSuggestion[]>([]);
  const [open, setOpen] = useState<{ title: string; body: string } | null>(null);

  const active = query.trim().length >= 6;
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      portalKbApi.search(query, token).then((r) => setItems(r.success && r.data ? r.data : []));
    }, 400);
    return () => clearTimeout(t);
  }, [active, query, token]);

  if (!active || !items.length) return null;

  return (
    <div className="rounded-xl border border-[color:var(--accent)]/30 bg-[color:var(--accent)]/5 p-3 space-y-2">
      <p className="text-xs font-semibold text-[color:var(--text-primary)]">These articles might answer your question</p>
      <ul className="space-y-1.5">
        {items.map((a) => (
          <li key={a._id}>
            <button
              type="button"
              className="text-left text-sm text-[color:var(--accent)] hover:underline"
              onClick={() => portalKbApi.get(a._id, token).then((r) => r.success && r.data && setOpen({ title: r.data.title, body: r.data.body }))}
            >
              {a.title}
            </button>
            <p className="text-[11px] text-[color:var(--text-muted)] line-clamp-2">{a.excerpt}</p>
          </li>
        ))}
      </ul>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(null)}>
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">{open.title}</h2>
              <button type="button" className="text-sm text-[color:var(--text-muted)]" onClick={() => setOpen(null)}>
                Close
              </button>
            </div>
            <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(open.body) }} />
            <p className="mt-4 text-xs text-[color:var(--text-muted)]">Didn&apos;t help? Close this and finish your request.</p>
          </div>
        </div>
      )}
    </div>
  );
}
