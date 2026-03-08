import { useState, useRef, useEffect } from 'react';
import type { Issue } from '../../lib/api';
import { getIssueKey } from '../../lib/api';
import { MetaBadge } from '../MetaBadge';

interface TaskHeaderProps {
  issue: Issue;
  getTypeMeta?: (name: string) => { icon?: string; color?: string } | undefined;
  getPriorityMeta?: (name: string) => { icon?: string; color?: string } | undefined;
  getStatusMeta?: (name: string) => { icon?: string; color?: string } | undefined;
  onUpdateTitle?: (title: string) => void;
}

export default function TaskHeader({ issue, getTypeMeta, getPriorityMeta, getStatusMeta, onUpdateTitle }: TaskHeaderProps) {
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
    <div className="mb-6">
      <span className="text-[13px] text-[color:var(--text-muted)] font-medium">{issueKey}</span>
      {editingTitle ? (
        <input
          ref={inputRef}
          type="text"
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={handleKeyDown}
          className="mt-1 block w-full text-xl font-semibold text-[color:var(--text-primary)] bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40 focus:border-[color:var(--accent)]"
          placeholder="Issue title"
        />
      ) : (
        <h1
          className="text-xl font-semibold text-[color:var(--text-primary)] mt-1 break-words cursor-text hover:ring-1 hover:ring-[color:var(--border-subtle)] hover:rounded px-1 -mx-1 transition-colors"
          onClick={() => onUpdateTitle && setEditingTitle(true)}
          title={onUpdateTitle ? 'Click to edit title' : undefined}
        >
          {issue.title}
        </h1>
      )}
      {(getTypeMeta || getPriorityMeta || getStatusMeta) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-3">
          {getTypeMeta && <MetaBadge label={issue.type} meta={getTypeMeta(issue.type)} />}
          {getPriorityMeta && <MetaBadge label={issue.priority} meta={getPriorityMeta(issue.priority)} />}
          {getStatusMeta && <MetaBadge label={issue.status} meta={getStatusMeta(issue.status)} />}
        </div>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        <button
          type="button"
          className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors"
        >
          + Add sub-work item
        </button>
        <span className="text-[color:var(--text-muted)]">·</span>
        <button
          type="button"
          className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors"
        >
          Add relation
        </button>
        <span className="text-[color:var(--text-muted)]">·</span>
        <button
          type="button"
          className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors"
        >
          Add link
        </button>
        <span className="text-[color:var(--text-muted)]">·</span>
        <button
          type="button"
          className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors"
        >
          Attach
        </button>
      </div>
    </div>
  );
}
