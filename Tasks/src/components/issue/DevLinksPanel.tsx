import type { IssueDevLink } from '../../lib/api';

const STATE_TONE: Record<string, string> = {
  merged: 'text-violet-500 border-violet-500/40',
  open: 'text-emerald-600 border-emerald-500/40',
  closed: 'text-[color:var(--text-muted)] border-[color:var(--border-subtle)]',
};

/** Commits and pull requests that mention this issue (linked by the GitHub webhook). */
export default function DevLinksPanel({ links }: { links?: IssueDevLink[] }) {
  if (!links?.length) return null;
  const prs = links.filter((l) => l.kind === 'pr');
  const commits = links.filter((l) => l.kind === 'commit');
  return (
    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 space-y-3">
      <p className="text-xs font-semibold text-[color:var(--text-primary)]">Development</p>
      {prs.length > 0 && (
        <ul className="space-y-1.5">
          {prs.map((l) => (
            <li key={`pr-${l.ref}`} className="flex items-center gap-2 text-xs">
              <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${STATE_TONE[l.state ?? 'open']}`}>
                {l.state ?? 'open'}
              </span>
              <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-[color:var(--accent)] hover:underline">
                {l.ref} {l.title}
              </a>
              {l.author && <span className="shrink-0 text-[10px] text-[color:var(--text-muted)]">@{l.author}</span>}
            </li>
          ))}
        </ul>
      )}
      {commits.length > 0 && (
        <ul className="space-y-1">
          {commits.slice(0, 10).map((l) => (
            <li key={`c-${l.ref}`} className="flex items-center gap-2 text-xs">
              <a href={l.url} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-[11px] text-[color:var(--accent)] hover:underline">
                {l.ref.slice(0, 7)}
              </a>
              <span className="min-w-0 truncate text-[color:var(--text-primary)]">{l.title}</span>
              <span className="shrink-0 text-[10px] text-[color:var(--text-muted)]">{new Date(l.at).toLocaleDateString()}</span>
            </li>
          ))}
          {commits.length > 10 && <li className="text-[10px] text-[color:var(--text-muted)]">+{commits.length - 10} more commits</li>}
        </ul>
      )}
    </div>
  );
}
