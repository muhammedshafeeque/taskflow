import { useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Link } from 'react-router-dom';
import type { IssueLink, IssueLinkType, IssueLinkTypeWithVirtual } from '../../lib/api';
import { issuesApi, getIssueKey } from '../../lib/api';

const LINK_TYPE_LABELS: Record<IssueLinkTypeWithVirtual, string> = {
  blocks: 'Blocks',
  is_blocked_by: 'Blocked by',
  duplicates: 'Duplicates',
  is_duplicated_by: 'Is duplicated by',
  relates_to: 'Relates to',
  is_subtask_of: 'Parent task',
};

const MANUAL_LINK_TYPES: IssueLinkType[] = ['blocks', 'is_blocked_by', 'duplicates', 'is_duplicated_by', 'relates_to'];

interface TaskIssueLinksProps {
  issueId: string;
  projectId: string | undefined;
  links: IssueLink[];
  token: string | null;
  onLinksChange: () => void;
  /** Called after clearing Issue.parent via the virtual parent link (refresh issue for sidebar). */
  onParentRemoved?: () => void;
  noWrapper?: boolean;
}

export type TaskIssueLinksHandle = {
  openLinkModal: () => void;
};

const TaskIssueLinks = forwardRef<TaskIssueLinksHandle, TaskIssueLinksProps>(function TaskIssueLinks(
  {
  issueId,
  projectId,
  links,
  token,
  onLinksChange,
  onParentRemoved,
  noWrapper = false,
},
  ref
) {
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<import('../../lib/api').Issue[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<import('../../lib/api').Issue | null>(null);
  const [selectedLinkType, setSelectedLinkType] = useState<IssueLinkType>('relates_to');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!searchQuery.trim() || !token) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(() => {
      setSearching(true);
      issuesApi
        .searchGlobal(searchQuery, 1, 10, token, issueId)
        .then((res) => {
          if (res.success && res.data) setSearchResults(res.data.data ?? []);
        })
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, token, issueId]);

  useImperativeHandle(
    ref,
    () => ({
      openLinkModal: () => {
        if (!token) return;
        setLinkModalOpen(true);
      },
    }),
    [token]
  );

  async function handleAddLink() {
    if (!token || !selectedIssue) return;
    setSubmitting(true);
    const res = await issuesApi.addLink(issueId, { targetIssueId: selectedIssue._id, linkType: selectedLinkType }, token);
    setSubmitting(false);
    if (res.success) {
      setLinkModalOpen(false);
      setSearchQuery('');
      setSelectedIssue(null);
      setSelectedLinkType('relates_to');
      onLinksChange();
    } else {
      alert((res as { message?: string }).message ?? 'Failed to add link');
    }
  }

  async function handleRemoveLink(linkId: string) {
    if (!token) return;
    if (linkId.startsWith('__parent__')) {
      const res = await issuesApi.update(issueId, { parent: null }, token);
      if (res.success) {
        onLinksChange();
        onParentRemoved?.();
      } else {
        alert((res as { message?: string }).message ?? 'Could not remove parent');
      }
      return;
    }
    const res = await issuesApi.removeLink(issueId, linkId, token);
    if (res.success) onLinksChange();
  }

  function getIssueUrl(link: IssueLink): string {
    const proj = link.issue.project;
    const projId = proj?._id ?? projectId;
    if (!projId) return '#';
    return `/projects/${projId}/issues/${encodeURIComponent(link.issue.key)}`;
  }

  const content = (
    <>
      {links.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)] italic py-6 text-center px-4">No links yet.</p>
      ) : (
        <ul className="px-4 py-3 space-y-1.5">
          {links.map((link) => (
            <li
              key={link._id}
              className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md border-l-2 border-l-transparent hover:border-l-[color:var(--accent)] hover:bg-[color:var(--bg-page)] transition-all group"
            >
              <Link
                to={getIssueUrl(link)}
                className="flex-1 min-w-0 flex items-center gap-2"
              >
                <span className="text-[10px] text-[color:var(--text-muted)] shrink-0">
                  {LINK_TYPE_LABELS[link.linkType]}
                </span>
                <span className="font-mono text-xs text-[color:var(--accent)] hover:underline shrink-0">
                  {link.issue.key}
                </span>
                {link.issue.project && link.issue.project._id !== projectId && (
                  <span className="text-[10px] text-[color:var(--text-muted)] shrink-0" title={link.issue.project.name}>
                    ({link.issue.project.key})
                  </span>
                )}
                <span className="text-xs text-[color:var(--text-primary)] truncate">
                  {link.issue.title}
                </span>
              </Link>
              <button
                type="button"
                onClick={() => handleRemoveLink(link._id)}
                className="opacity-0 group-hover:opacity-100 text-[10px] text-red-400 hover:text-red-300 shrink-0"
                aria-label={link._id.startsWith('__parent__') ? 'Clear parent task' : 'Remove link'}
              >
                {link._id.startsWith('__parent__') ? 'Clear parent' : 'Remove'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {linkModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setLinkModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[color:var(--text-primary)] mb-3">Link issue</h3>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by key or title…"
              className="w-full px-3 py-2 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] mb-2"
            />
            {searching && <p className="text-[11px] text-[color:var(--text-muted)] mb-2">Searching…</p>}
            {searchQuery.trim() && !searching && (
              <ul className="max-h-32 overflow-auto rounded-md border border-[color:var(--border-subtle)] mb-3">
                {searchResults.map((issue) => (
                  <li key={issue._id}>
                    <button
                      type="button"
                      onClick={() => setSelectedIssue(issue)}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-[color:var(--bg-page)] ${
                        selectedIssue?._id === issue._id ? 'bg-[color:var(--accent)]/20' : ''
                      }`}
                    >
                      <span className="font-mono text-[color:var(--accent)]">{getIssueKey(issue)}</span>
                      {' · '}
                      <span className="text-[color:var(--text-primary)] truncate">{issue.title}</span>
                    </button>
                  </li>
                ))}
                {searchResults.length === 0 && (
                  <li className="px-3 py-2 text-[11px] text-[color:var(--text-muted)]">No issues found</li>
                )}
              </ul>
            )}
            <div className="mb-3">
              <label className="block text-[11px] font-medium text-[color:var(--text-muted)] mb-1">Link type</label>
              <select
                value={selectedLinkType}
                onChange={(e) => setSelectedLinkType(e.target.value as IssueLinkType)}
                className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)]"
              >
                {MANUAL_LINK_TYPES.map((t) => (
                  <option key={t} value={t}>{LINK_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setLinkModalOpen(false)}
                className="px-3 py-1.5 rounded text-xs border border-[color:var(--border-subtle)] text-[color:var(--text-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddLink}
                disabled={!selectedIssue || submitting}
                className="px-3 py-1.5 rounded text-xs bg-[color:var(--accent)] text-white font-medium disabled:opacity-50"
              >
                {submitting ? 'Linking…' : 'Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  if (noWrapper) return content;

  return (
    <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--text-muted)]">
          Links{' '}
          <span className="ml-1 bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] px-1.5 py-0.5 rounded-full text-[10px] font-semibold">
            {links.length}
          </span>
        </span>
        {token && (
          <button
            type="button"
            onClick={() => setLinkModalOpen(true)}
            className="text-xs font-medium px-2.5 py-1 rounded-md text-[color:var(--accent)] hover:bg-[color:var(--accent)]/10 transition-colors"
          >
            Link issue
          </button>
        )}
      </div>
      {content}
    </div>
  );
});

export default TaskIssueLinks;
