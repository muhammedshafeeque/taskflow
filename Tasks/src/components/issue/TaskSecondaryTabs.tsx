import { useState, forwardRef, useImperativeHandle, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { Issue, Attachment, IssueLink } from '../../lib/api';
import TaskSubtasks from './TaskSubtasks';
import TaskIssueLinks, { type TaskIssueLinksHandle } from './TaskIssueLinks';
import TaskAttachments, { type TaskAttachmentsHandle } from './TaskAttachments';

interface TaskSecondaryTabsProps {
  issue: Issue;
  projectId: string | undefined;
  token: string | null;
  
  // Subtasks
  subtasks: Issue[];
  getStatusMeta: (name: string) => { color?: string; icon?: string } | undefined;

  // Links
  links: IssueLink[];
  onLinksChange: () => void;
  onParentRemoved?: () => void;

  // Attachments
  attachments: Attachment[];
  onAttachmentsChange: () => void;

  currentUserId?: string;
}

export type TaskSecondaryTabsHandle = {
  openLinkModal: () => void;
  openFilePicker: () => void;
};

type Tab = 'subtasks' | 'links' | 'attachments';

const TaskSecondaryTabs = forwardRef<TaskSecondaryTabsHandle, TaskSecondaryTabsProps>(function TaskSecondaryTabs(props, ref) {
  const {
    issue,
    projectId,
    token,
    subtasks,
    getStatusMeta,
    links,
    onLinksChange,
    onParentRemoved,
    attachments,
    onAttachmentsChange,
    currentUserId,
  } = props;

  const [activeTab, setActiveTab] = useState<Tab>('subtasks');
  const issueLinksRef = useRef<TaskIssueLinksHandle>(null);
  const attachmentsRef = useRef<TaskAttachmentsHandle>(null);

  useImperativeHandle(ref, () => ({
    openLinkModal: () => {
      setActiveTab('links');
      setTimeout(() => issueLinksRef.current?.openLinkModal(), 0);
    },
    openFilePicker: () => {
      setActiveTab('attachments');
      setTimeout(() => attachmentsRef.current?.openFilePicker(), 0);
    },
  }));

  const addSubtaskUrl = projectId
    ? `?create=1&parent=${issue._id}`
    : '#';

  return (
    <section className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] overflow-x-auto no-scrollbar">
        <div className="flex gap-1 min-w-max">
          <button
            type="button"
            onClick={() => setActiveTab('subtasks')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'subtasks'
                ? 'bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] border border-[color:var(--border-subtle)] shadow-sm font-semibold'
                : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]'
            }`}
          >
            Subtasks ({subtasks.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('links')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'links'
                ? 'bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] border border-[color:var(--border-subtle)] shadow-sm font-semibold'
                : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]'
            }`}
          >
            Links ({links.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('attachments')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'attachments'
                ? 'bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] border border-[color:var(--border-subtle)] shadow-sm font-semibold'
                : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]'
            }`}
          >
            Attachments ({attachments.length})
          </button>
        </div>

        <div className="ml-4 shrink-0">
          {activeTab === 'subtasks' && projectId && (
            <Link
              to={addSubtaskUrl}
              className="text-[11px] font-medium px-2 py-1 rounded bg-[color:var(--accent)] text-white hover:bg-[color:var(--accent)]/90 transition-colors"
            >
              Add subtask
            </Link>
          )}
          {activeTab === 'links' && token && (
            <button
              type="button"
              onClick={() => issueLinksRef.current?.openLinkModal()}
              className="text-[11px] font-medium px-2 py-1 rounded bg-[color:var(--accent)] text-white hover:bg-[color:var(--accent)]/90 transition-colors"
            >
              Link issue
            </button>
          )}
          {activeTab === 'attachments' && token && (
            <button
              type="button"
              onClick={() => attachmentsRef.current?.openFilePicker()}
              className="text-[11px] font-medium px-2 py-1 rounded bg-[color:var(--accent)] text-white hover:bg-[color:var(--accent)]/90 transition-colors"
            >
              Add attachment
            </button>
          )}
        </div>
      </div>

      <div className="min-h-[100px]">
        {activeTab === 'subtasks' && (
          <TaskSubtasks
            issueId={issue._id}
            projectId={projectId}
            subtasks={subtasks}
            getStatusMeta={getStatusMeta}
            noWrapper
          />
        )}
        {activeTab === 'links' && (
          <TaskIssueLinks
            ref={issueLinksRef}
            issueId={issue._id}
            projectId={projectId}
            links={links}
            token={token}
            onLinksChange={onLinksChange}
            onParentRemoved={onParentRemoved}
            noWrapper
          />
        )}
        {activeTab === 'attachments' && (
          <TaskAttachments
            ref={attachmentsRef}
            issueId={issue._id}
            attachments={attachments}
            currentUserId={currentUserId}
            token={token}
            onAttachmentsChange={onAttachmentsChange}
            noWrapper
          />
        )}
      </div>
    </section>
  );
});

export default TaskSecondaryTabs;
