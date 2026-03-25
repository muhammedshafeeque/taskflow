import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Issue } from '../../lib/api';
import { getIssueKey } from '../../lib/api';
import { MetaBadge } from '../MetaBadge';

const actionBtnClass =
  'inline-flex items-center justify-center text-center text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] bg-[color:var(--bg-elevated)]/50 hover:bg-[color:var(--bg-elevated)] hover:border-[color:var(--text-muted)]/25 transition-colors disabled:opacity-40 disabled:pointer-events-none';

interface TaskHeaderProps {
  issue: Issue;
  issueId: string;
  projectId?: string;
  /** When false, link/relation/attach actions are disabled (e.g. not signed in). */
  canLinkAndAttach?: boolean;
  onOpenLinkModal?: () => void;
  onAttach?: () => void;
  getTypeMeta?: (name: string) => { icon?: string; color?: string } | undefined;
  getPriorityMeta?: (name: string) => { icon?: string; color?: string } | undefined;
  getStatusMeta?: (name: string) => { icon?: string; color?: string } | undefined;
  onUpdateTitle?: (title: string) => void;
}

export default function TaskHeader({
  issue,
  issueId,
  projectId,
  canLinkAndAttach = true,
  onOpenLinkModal,
  onAttach,
  getTypeMeta,
  getPriorityMeta,
  getStatusMeta,
  onUpdateTitle,
}: TaskHeaderProps) {
  const issueKey = getIssueKey(issue);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(issue.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitleValue(issue.title);
  }, [issue.title]);

  useEffect(() => {
    if (editingTitle) inputRef.current?.focus();
  }, [editingTitle]);

  function saveTitle() {
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== issue.title && onUpdateTitle) {
      onUpdateTitle(trimmed);
    }
    setTitleValue(issue.title);
    setEditingTitle(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveTitle();
    }
    if (e.key === 'Escape') {
      setTitleValue(issue.title);
      setEditingTitle(false);
      inputRef.current?.blur();
    }
  }

  return (
    <div>
      <span className="text-xs text-[color:var(--text-muted)] font-medium font-mono tracking-tight">{issueKey}</span>
      {editingTitle ? (
        <input
          ref={inputRef}
          type="text"
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={handleKeyDown}
          className="mt-1.5 block w-full text-xl sm:text-2xl font-semibold text-[color:var(--text-primary)] leading-snug bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40 focus:border-[color:var(--accent)]"
          placeholder="Issue title"
        />
      ) : (
        <h1
          className="text-xl sm:text-2xl font-semibold text-[color:var(--text-primary)] leading-snug mt-1.5 break-words cursor-text hover:ring-1 hover:ring-[color:var(--border-subtle)] hover:rounded-lg px-1 -mx-1 transition-colors"
          onClick={() => onUpdateTitle && setEditingTitle(true)}
          title={onUpdateTitle ? 'Click to edit title' : undefined}
        >
          {issue.title}
        </h1>
      )}
      {(getTypeMeta || getPriorityMeta || getStatusMeta) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
          {getTypeMeta && <MetaBadge label={issue.type} meta={getTypeMeta(issue.type)} />}
          {getPriorityMeta && <MetaBadge label={issue.priority} meta={getPriorityMeta(issue.priority)} />}
          {getStatusMeta && <MetaBadge label={issue.status} meta={getStatusMeta(issue.status)} />}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-[color:var(--border-subtle)]/60 relative z-10">
        {projectId ? (
          <Link
            to={`/projects/${projectId}/issues?create=1&parent=${issueId}`}
            className={actionBtnClass}
          >
            + Add sub-work item
          </Link>
        ) : (
          <button type="button" disabled className={actionBtnClass} title="Project context required">
            + Add sub-work item
          </button>
        )}
        <button
          type="button"
          className={actionBtnClass}
          disabled={!canLinkAndAttach}
          title={!canLinkAndAttach ? 'Sign in required' : 'Link another issue (blocks, relates, etc.)'}
          onClick={() => onOpenLinkModal?.()}
        >
          Add relation
        </button>
        <button
          type="button"
          className={actionBtnClass}
          disabled={!canLinkAndAttach}
          title={!canLinkAndAttach ? 'Sign in required' : 'Link another issue'}
          onClick={() => onOpenLinkModal?.()}
        >
          Add link
        </button>
        <button
          type="button"
          className={actionBtnClass}
          disabled={!canLinkAndAttach}
          title={!canLinkAndAttach ? 'Sign in required' : 'Attach a file'}
          onClick={() => onAttach?.()}
        >
          Attach
        </button>
      </div>
    </div>
  );
}
