import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FiArrowLeft,
  FiChevronRight,
  FiCornerDownRight,
  FiGitMerge,
  FiLink,
  FiPaperclip,
  FiPlus,
} from 'react-icons/fi';
import type { Issue } from '../../lib/api';
import { getIssueKey } from '../../lib/api';
import { MetaBadge } from '../MetaBadge';

const ghostBtnClass =
  'inline-flex items-center justify-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)] transition-colors disabled:opacity-40 disabled:pointer-events-none';

const actionIcon = 'h-3.5 w-3.5 shrink-0';

interface TaskHeaderProps {
  issue: Issue;
  issueId: string;
  projectId?: string;
  projectName?: string;
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
  projectName,
  canLinkAndAttach = true,
  onOpenLinkModal,
  onAttach,
  getTypeMeta,
  getPriorityMeta,
  getStatusMeta,
  onUpdateTitle,
}: TaskHeaderProps) {
  const navigate = useNavigate();
  const issueKey = getIssueKey(issue);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(issue.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTitleValue(issue.title); }, [issue.title]);
  useEffect(() => { if (editingTitle) inputRef.current?.focus(); }, [editingTitle]);

  function saveTitle() {
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== issue.title && onUpdateTitle) onUpdateTitle(trimmed);
    setTitleValue(issue.title);
    setEditingTitle(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); saveTitle(); }
    if (e.key === 'Escape') { setTitleValue(issue.title); setEditingTitle(false); inputRef.current?.blur(); }
  }

  return (
    <div className="space-y-3">

      {/* Row 1: breadcrumb left | actions right */}
      <div className="flex items-center justify-between gap-4">

        {/* Back + breadcrumb */}
        <div className="flex items-center gap-1.5 min-w-0 text-[12px] text-[color:var(--text-muted)]">
          {projectId ? (
            <Link
              to={`/projects/${projectId}/issues`}
              className="inline-flex items-center gap-1 font-medium text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors shrink-0"
            >
              <FiArrowLeft className="h-3.5 w-3.5" />
              <span>{projectName ?? 'Issues'}</span>
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-1 font-medium text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors shrink-0"
            >
              <FiArrowLeft className="h-3.5 w-3.5" />
              <span>Back</span>
            </button>
          )}
          <FiChevronRight className="h-3 w-3 opacity-40 shrink-0" />
          <span className="hidden sm:inline shrink-0">Work items</span>
          <FiChevronRight className="hidden sm:block h-3 w-3 opacity-40 shrink-0" />
          <span className="font-mono font-semibold text-[color:var(--text-primary)]">{issueKey}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {projectId ? (
            <Link
              to={`?create=1`}
              className="btn-primary btn-primary-sm h-7 px-3 text-[11px] font-semibold inline-flex items-center gap-1.5"
            >
              <FiPlus className={actionIcon} />
              New issue
            </Link>
          ) : (
            <button type="button" disabled className="btn-primary btn-primary-sm h-7 px-3 text-[11px] font-semibold inline-flex items-center gap-1.5">
              <FiPlus className={actionIcon} />
              New issue
            </button>
          )}

          <div className="w-px h-4 bg-[color:var(--border-subtle)] mx-1 shrink-0" />

          {projectId ? (
            <Link to={`?create=1&parent=${issueId}`} className={ghostBtnClass} title="Add sub-work item">
              <FiCornerDownRight className={actionIcon} />
              <span className="hidden lg:inline">Sub-item</span>
            </Link>
          ) : (
            <button type="button" disabled className={ghostBtnClass} title="Add sub-work item">
              <FiCornerDownRight className={actionIcon} />
              <span className="hidden lg:inline">Sub-item</span>
            </button>
          )}
          <button type="button" className={ghostBtnClass} disabled={!canLinkAndAttach}
            title={canLinkAndAttach ? 'Add relation' : 'Sign in required'} onClick={() => onOpenLinkModal?.()}>
            <FiGitMerge className={actionIcon} />
            <span className="hidden lg:inline">Relation</span>
          </button>
          <button type="button" className={ghostBtnClass} disabled={!canLinkAndAttach}
            title={canLinkAndAttach ? 'Add link' : 'Sign in required'} onClick={() => onOpenLinkModal?.()}>
            <FiLink className={actionIcon} />
            <span className="hidden lg:inline">Link</span>
          </button>
          <button type="button" className={ghostBtnClass} disabled={!canLinkAndAttach}
            title={canLinkAndAttach ? 'Attach a file' : 'Sign in required'} onClick={() => onAttach?.()}>
            <FiPaperclip className={actionIcon} />
            <span className="hidden lg:inline">Attach</span>
          </button>
        </div>
      </div>

      {/* Row 2: title */}
      {editingTitle ? (
        <input
          ref={inputRef}
          type="text"
          value={titleValue}
          onChange={(e) => setTitleValue(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={handleKeyDown}
          className="block w-full text-2xl sm:text-3xl font-bold text-[color:var(--text-primary)] leading-tight bg-transparent border-b-2 border-[color:var(--accent)] pb-1 focus:outline-none"
          placeholder="Issue title"
        />
      ) : (
        <h1
          className="text-2xl sm:text-3xl font-bold text-[color:var(--text-primary)] leading-tight break-words cursor-text"
          onClick={() => onUpdateTitle && setEditingTitle(true)}
          title={onUpdateTitle ? 'Click to edit' : undefined}
        >
          {issue.title}
        </h1>
      )}

      {/* Row 3: meta badges */}
      {(getTypeMeta || getPriorityMeta || getStatusMeta) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {getTypeMeta && <MetaBadge label={issue.type} meta={getTypeMeta(issue.type)} />}
          {getPriorityMeta && <MetaBadge label={issue.priority} meta={getPriorityMeta(issue.priority)} />}
          {getStatusMeta && <MetaBadge label={issue.status} meta={getStatusMeta(issue.status)} />}
        </div>
      )}
    </div>
  );
}
