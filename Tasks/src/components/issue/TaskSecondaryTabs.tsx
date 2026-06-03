import { useState, forwardRef, useImperativeHandle, useRef } from 'react';
import { Link } from 'react-router-dom';
import { FiPlus } from 'react-icons/fi';
import type { Issue, Attachment, IssueLink } from '../../lib/api';
import TaskSubtasks from './TaskSubtasks';
import TaskIssueLinks, { type TaskIssueLinksHandle } from './TaskIssueLinks';
import TaskAttachments, { type TaskAttachmentsHandle } from './TaskAttachments';
import IssueGraphMini from './IssueGraphMini';

interface TaskSecondaryTabsProps {
  issue: Issue;
  projectId: string | undefined;
  token: string | null;
  subtasks: Issue[];
  getStatusMeta: (name: string) => { color?: string; icon?: string } | undefined;
  links: IssueLink[];
  onLinksChange: () => void;
  onParentRemoved?: () => void;
  attachments: Attachment[];
  onAttachmentsChange: () => void;
  currentUserId?: string;
}

export type TaskSecondaryTabsHandle = {
  openLinkModal: () => void;
  openFilePicker: () => void;
};

type Tab = 'subtasks' | 'links' | 'attachments' | 'graph';

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

  const addSubtaskUrl = projectId ? `?create=1&parent=${issue._id}` : '#';

  const tabClass = (tab: Tab) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
      activeTab === tab
        ? 'bg-[color:var(--accent)] text-white font-semibold shadow-sm'
        : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] hover:text-[color:var(--text-primary)]'
    }`;

  const badgeClass = (tab: Tab) =>
    `min-w-[1.1rem] h-[1.1rem] px-1 inline-flex items-center justify-center rounded-full text-[9px] font-bold ${
      activeTab === tab
        ? 'bg-white/25 text-white'
        : 'bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)]'
    }`;

  return (
    <section className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] overflow-x-auto no-scrollbar">
        <div className="flex gap-1 min-w-max">
          <button type="button" onClick={() => setActiveTab('subtasks')} className={tabClass('subtasks')}>
            Subtasks
            <span className={badgeClass('subtasks')}>{subtasks.length}</span>
          </button>
          <button type="button" onClick={() => setActiveTab('links')} className={tabClass('links')}>
            Links
            <span className={badgeClass('links')}>{links.length}</span>
          </button>
          <button type="button" onClick={() => setActiveTab('attachments')} className={tabClass('attachments')}>
            Attachments
            <span className={badgeClass('attachments')}>{attachments.length}</span>
          </button>
          {projectId && token && (
            <button type="button" onClick={() => setActiveTab('graph')} className={tabClass('graph')}>
              Graph
            </button>
          )}
        </div>

        <div className="ml-3 shrink-0">
          {activeTab === 'subtasks' && projectId && (
            <Link
              to={addSubtaskUrl}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md bg-[color:var(--accent)] text-white hover:opacity-90 transition-opacity"
            >
              <FiPlus className="h-3 w-3" />
              Add subtask
            </Link>
          )}
          {activeTab === 'links' && token && (
            <button
              type="button"
              onClick={() => issueLinksRef.current?.openLinkModal()}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md bg-[color:var(--accent)] text-white hover:opacity-90 transition-opacity"
            >
              <FiPlus className="h-3 w-3" />
              Link issue
            </button>
          )}
          {activeTab === 'attachments' && token && (
            <button
              type="button"
              onClick={() => attachmentsRef.current?.openFilePicker()}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md bg-[color:var(--accent)] text-white hover:opacity-90 transition-opacity"
            >
              <FiPlus className="h-3 w-3" />
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
        {activeTab === 'graph' && projectId && token && (
          <div className="p-4">
            <IssueGraphMini projectId={projectId} issue={issue} token={token} />
          </div>
        )}
      </div>
    </section>
  );
});

export default TaskSecondaryTabs;
