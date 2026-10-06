import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { aiApi, type AiIssueDraft, type SimilarIssue } from '../../lib/api';
import { useAiStatus } from './aiStatus';

const btn =
  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs font-medium text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] disabled:opacity-50 transition';
const card = 'rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4';
const markdown = 'prose prose-sm max-w-none text-[color:var(--text-primary)] dark:prose-invert [&_ul]:my-1 [&_h2]:text-sm [&_h3]:text-sm';

function SimilarList({ items, projectId }: { items: SimilarIssue[]; projectId: string }) {
  return (
    <ul className="space-y-1">
      {items.map((s) => (
        <li key={s._id} className="flex items-center justify-between gap-2 text-xs">
          <Link
            to={`/projects/${projectId}/issues/${encodeURIComponent(s.key ?? s._id)}`}
            className="min-w-0 truncate text-[color:var(--accent)] hover:underline"
          >
            {s.key ? `${s.key} · ` : ''}
            {s.title}
          </Link>
          <span className="shrink-0 text-[10px] text-[color:var(--text-muted)]">
            {s.status} · {Math.round(s.score * 100)}% match
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Issue page: AI summary on demand + "possibly related" issues (keyword match, no AI cost). */
export function IssueAiPanel({ issueId, projectId, token }: { issueId: string; projectId: string; token: string }) {
  const ai = useAiStatus(token);
  const [summary, setSummary] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [similar, setSimilar] = useState<SimilarIssue[]>([]);

  // Parent remounts this panel per issue (key={issueId}), so local state starts fresh.
  useEffect(() => {
    let alive = true;
    aiApi.similarToIssue(issueId, token).then((r) => alive && setSimilar(r.success && r.data ? r.data : []));
    return () => {
      alive = false;
    };
  }, [issueId, token]);

  async function summarize() {
    setLoading(true);
    setError('');
    const r = await aiApi.summarizeIssue(issueId, token);
    setLoading(false);
    if (r.success && r.data) setSummary(r.data.summary);
    else setError(r.message ?? 'Summary failed');
  }

  if (!ai?.enabled && !similar.length) return null;

  return (
    <div className={`${card} space-y-3`}>
      {ai?.enabled && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-[color:var(--text-primary)]">✨ AI summary</p>
            <button type="button" className={btn} onClick={summarize} disabled={loading}>
              {loading ? 'Summarizing…' : summary ? 'Refresh' : 'Summarize thread'}
            </button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          {summary && (
            <div className={markdown}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
      {similar.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-[color:var(--text-primary)]">Possibly related or duplicate</p>
          <SimilarList items={similar} projectId={projectId} />
        </div>
      )}
    </div>
  );
}

/** Create-issue helper: turn rough notes into a structured draft, and warn about likely duplicates. */
export function IssueDraftHelper({
  projectId,
  token,
  currentTitle,
  onApply,
}: {
  projectId: string;
  token: string;
  currentTitle: string;
  onApply: (draft: AiIssueDraft) => void;
}) {
  const ai = useAiStatus(token);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dupes, setDupes] = useState<SimilarIssue[]>([]);

  const checkDupes = Boolean(projectId) && currentTitle.trim().length >= 8;
  useEffect(() => {
    if (!checkDupes) return;
    const t = setTimeout(() => {
      aiApi.similarToText(projectId, currentTitle, token).then((r) => setDupes(r.success && r.data ? r.data : []));
    }, 500);
    return () => clearTimeout(t);
  }, [checkDupes, projectId, currentTitle, token]);
  const visibleDupes = checkDupes ? dupes : [];

  async function draft() {
    setLoading(true);
    setError('');
    const r = await aiApi.draftIssue(projectId, notes, token);
    setLoading(false);
    if (r.success && r.data) {
      onApply(r.data);
      setOpen(false);
      setNotes('');
    } else setError(r.message ?? 'Draft failed');
  }

  return (
    <div className="space-y-2">
      {visibleDupes.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 space-y-1">
          <p className="text-[11px] font-semibold text-amber-600">Similar issues already exist</p>
          <SimilarList items={visibleDupes} projectId={projectId} />
        </div>
      )}
      {ai?.enabled &&
        (open ? (
          <div className="rounded-lg border border-[color:var(--accent)]/40 p-2.5 space-y-2">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Paste a customer message, Slack thread or rough notes — AI fills in title, description, type, priority and checklist."
              className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-2 text-xs"
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className={btn} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className={btn} onClick={draft} disabled={loading || !notes.trim()}>
                {loading ? 'Drafting…' : 'Fill the form'}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className={btn} onClick={() => setOpen(true)}>
            ✨ Draft with AI
          </button>
        ))}
    </div>
  );
}

/** Service desk: draft the next customer reply from the thread + knowledge base. */
export function TicketReplySuggest({ ticketId, token, onUse }: { ticketId: string; token: string; onUse: (text: string) => void }) {
  const ai = useAiStatus(token);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [articles, setArticles] = useState<Array<{ _id: string; title: string }>>([]);

  if (!ai?.enabled) return null;

  async function suggest() {
    setLoading(true);
    setError('');
    const r = await aiApi.suggestTicketReply(ticketId, token);
    setLoading(false);
    if (r.success && r.data) {
      onUse(r.data.reply);
      setArticles(r.data.articles);
    } else setError(r.message ?? 'Suggestion failed');
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={btn} onClick={suggest} disabled={loading}>
        {loading ? 'Drafting…' : '✨ Suggest reply'}
      </button>
      {articles.length > 0 && (
        <span className="text-[10px] text-[color:var(--text-muted)]">Used KB: {articles.map((a) => a.title).join(', ')}</span>
      )}
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}

/** Sprint report: draft a retrospective from what was completed and carried over. */
export function SprintRetroPanel({ sprintId, token }: { sprintId: string; token: string }) {
  const ai = useAiStatus(token);
  const [retro, setRetro] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  if (!ai?.enabled) return null;

  async function run() {
    setLoading(true);
    setError('');
    const r = await aiApi.sprintRetro(sprintId, token);
    setLoading(false);
    if (r.success && r.data) setRetro(r.data.retro);
    else setError(r.message ?? 'Retro failed');
  }

  return (
    <div className={`${card} space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[color:var(--text-primary)]">✨ Retrospective draft</p>
        <div className="flex gap-2">
          {retro && (
            <button type="button" className={btn} onClick={() => void navigator.clipboard?.writeText(retro)}>
              Copy
            </button>
          )}
          <button type="button" className={btn} onClick={run} disabled={loading}>
            {loading ? 'Drafting…' : retro ? 'Regenerate' : 'Draft retro'}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {retro ? (
        <div className={markdown}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{retro}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-xs text-[color:var(--text-muted)]">Generates went-well / didn't / actions from this sprint's completed and carried-over work.</p>
      )}
    </div>
  );
}
