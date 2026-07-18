import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { searchApi, type SearchHit } from '../lib/api';

const TYPE_LABELS: Record<string, string> = {
  account: 'Account', contact: 'Contact', deal: 'Deal', contract: 'Contract',
  invoice: 'Invoice', ticket: 'Ticket', project: 'Project',
};

const TYPE_TONES: Record<string, string> = {
  account: 'text-sky-500', contact: 'text-violet-500', deal: 'text-emerald-500',
  contract: 'text-amber-500', invoice: 'text-indigo-500', ticket: 'text-rose-500', project: 'text-teal-500',
};

/** Workspace-wide command palette (⌘K / Ctrl+K) that searches across every module. */
export default function CommandPalette() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('atrium:open-command-palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('atrium:open-command-palette', onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 20);
    } else {
      setQuery('');
      setHits([]);
      setActive(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !token || query.trim().length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      searchApi.query(query.trim(), token).then((res) => {
        setLoading(false);
        setActive(0);
        if (res.success && res.data) setHits(res.data.hits);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [query, token, open]);

  const go = (hit: SearchHit) => {
    setOpen(false);
    navigate(hit.link);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-xl rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] shadow-2xl overflow-hidden animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[color:var(--border-subtle)] px-4">
          <span className="text-[color:var(--text-muted)]">🔎</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === 'Enter' && hits[active]) go(hits[active]);
            }}
            placeholder="Search accounts, deals, contracts, invoices, tickets, projects…"
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder-[color:var(--text-muted)]"
          />
          <kbd className="text-[10px] text-[color:var(--text-muted)] border border-[color:var(--border-subtle)] rounded px-1.5 py-0.5">ESC</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {loading && <p className="px-4 py-6 text-center text-sm text-[color:var(--text-muted)]">Searching…</p>}
          {!loading && query.trim().length >= 2 && hits.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-[color:var(--text-muted)]">No matches for “{query}”.</p>
          )}
          {!loading && query.trim().length < 2 && (
            <p className="px-4 py-6 text-center text-sm text-[color:var(--text-muted)]">Type at least 2 characters to search across all modules.</p>
          )}
          {hits.map((h, i) => (
            <button
              key={`${h.type}-${h.id}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(h)}
              className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition ${i === active ? 'bg-[color:var(--bg-page)]' : ''}`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{h.title}</p>
                {h.subtitle && <p className="text-[11px] text-[color:var(--text-muted)] capitalize truncate">{h.subtitle}</p>}
              </div>
              <span className={`text-[10px] font-semibold uppercase tracking-wide shrink-0 ${TYPE_TONES[h.type] ?? 'text-[color:var(--text-muted)]'}`}>
                {TYPE_LABELS[h.type] ?? h.type}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
