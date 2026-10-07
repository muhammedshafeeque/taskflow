import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';

/** Shared look for unauthenticated pages (rating link, status page). */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[color:var(--bg-page)] text-[color:var(--text-primary)] flex items-start justify-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-5">{children}</div>
    </div>
  );
}

export function Stars({ value, onPick, size = 'text-3xl' }: { value: number; onPick?: (n: number) => void; size?: string }) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          disabled={!onPick}
          onClick={() => onPick?.(n)}
          className={`${size} leading-none transition ${n <= value ? 'text-amber-400' : 'text-[color:var(--border-subtle)]'} ${onPick ? 'hover:scale-110' : ''}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

/** /rate/:token?score=n — target of the CSAT email. */
export function PublicRate() {
  const { token } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const [score, setScore] = useState(() => Math.min(5, Math.max(0, Number(params.get('score')) || 0)));
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  const submit = async (s = score, c = comment) => {
    if (!token || !s) return;
    setState('saving');
    const r = await api.post(`/public/csat/${token}`, { score: s, comment: c || undefined });
    if (r.success) setState('done');
    else {
      setState('error');
      setError(r.message ?? 'This link is invalid or has expired.');
    }
  };
  // Clicking a star in the email records the score immediately; a comment can be added after.
  useEffect(() => {
    if (score) void submit(score, '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Shell>
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-8 space-y-4 text-center">
        <h1 className="text-xl font-bold">How did we do?</h1>
        <div className="flex justify-center">
          <Stars value={score} onPick={(n) => setScore(n)} />
        </div>
        {state === 'error' && <p className="text-sm text-rose-500">{error}</p>}
        <textarea
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Anything you'd like to tell us? (optional)"
          className="w-full rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm"
        />
        <button disabled={!score || state === 'saving'} onClick={() => submit()} className="btn-primary px-5 py-2 rounded-lg text-sm disabled:opacity-50">
          {state === 'done' ? 'Update feedback' : 'Send feedback'}
        </button>
        {state === 'done' && <p className="text-sm text-emerald-600">Thank you — your feedback was recorded.</p>}
      </div>
    </Shell>
  );
}

type StatusData = {
  title: string;
  description?: string;
  logoUrl?: string;
  overall: 'operational' | 'degraded' | 'major_outage';
  components: { name: string; status: string; uptimePct14d: number | null; checkedAt: string | null }[];
  incidents: { _id: string; title: string; impact: string; status: string; startedAt: string; resolvedAt?: string; updates: { at: string; status: string; message: string }[] }[];
};

const OVERALL = {
  operational: { label: 'All systems operational', cls: 'bg-emerald-600' },
  degraded: { label: 'Some systems are degraded', cls: 'bg-amber-500' },
  major_outage: { label: 'Major outage', cls: 'bg-rose-600' },
};

/** /status/:slug — public status page configured under Monitor → Status pages. */
export function PublicStatus() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!slug) return;
    const load = () =>
      api.get<StatusData>(`/public/status/${slug}`).then((r) => {
        if (r.success && r.data) {
          setData(r.data);
          document.title = r.data.title;
        } else setError(r.message ?? 'Status page not found');
      });
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [slug]);
  if (error) return <Shell><p className="text-center text-[color:var(--text-muted)]">{error}</p></Shell>;
  if (!data) return <Shell><p className="text-center text-[color:var(--text-muted)]">Loading…</p></Shell>;
  const o = OVERALL[data.overall];
  return (
    <Shell>
      <header className="flex items-center gap-3">
        {data.logoUrl && <img src={data.logoUrl} alt="" className="h-9 w-9 rounded-lg object-contain" />}
        <div>
          <h1 className="text-xl font-bold">{data.title}</h1>
          {data.description && <p className="text-sm text-[color:var(--text-muted)]">{data.description}</p>}
        </div>
      </header>
      <div className={`rounded-2xl px-5 py-4 text-white font-semibold ${o.cls}`}>{o.label}</div>
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] divide-y divide-[color:var(--border-subtle)]">
        {data.components.map((c) => (
          <div key={c.name} className="flex items-center justify-between px-5 py-3 text-sm">
            <span>{c.name}</span>
            <span className="flex items-center gap-3">
              {c.uptimePct14d !== null && <span className="text-[color:var(--text-muted)] tabular-nums">{c.uptimePct14d}% (14d)</span>}
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${c.status === 'operational' ? 'bg-emerald-500/15 text-emerald-600' : c.status === 'down' ? 'bg-rose-500/15 text-rose-600' : 'bg-slate-500/15'}`}>{c.status}</span>
            </span>
          </div>
        ))}
        {data.components.length === 0 && <p className="px-5 py-3 text-sm text-[color:var(--text-muted)]">No components.</p>}
      </div>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Incidents (last 14 days)</h2>
        {data.incidents.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No incidents reported.</p>}
        {data.incidents.map((i) => (
          <div key={i._id} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{i.title}</span>
              <span className="text-[11px] capitalize text-[color:var(--text-muted)]">
                {i.status} · {i.impact}
              </span>
            </div>
            {[...i.updates].reverse().map((u, k) => (
              <div key={k} className="text-sm">
                <span className="text-[11px] text-[color:var(--text-muted)]">
                  {new Date(u.at).toLocaleString()} · {u.status}
                </span>
                <p>{u.message}</p>
              </div>
            ))}
          </div>
        ))}
      </section>
    </Shell>
  );
}
