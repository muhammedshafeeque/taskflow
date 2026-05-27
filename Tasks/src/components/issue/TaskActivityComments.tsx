import { useState } from 'react';
import type { Issue, Comment, WorkLog } from '../../lib/api';
import TaskHistoryStack from './TaskHistoryStack';
import TaskCommentBox from './TaskCommentBox';
import TaskCommentItem from './TaskCommentItem';
import WorkLogInput from './WorkLogInput';
import WorkLogList from './WorkLogList';

interface TaskActivityCommentsProps {
  issue: Issue;
  comments: Comment[];
  onAddComment: (body: string) => void;
  onUpdateComment?: (commentId: string, body: string) => void | Promise<void>;
  submittingComment: boolean;
  editingCommentId?: string | null;
  mentionUsers?: Array<{ _id: string; name: string; email: string }>;
  workLogs: WorkLog[];
  currentUserId?: string;
  onAddWorkLog: (payload: { minutesSpent: number; date: string; description?: string }) => void;
  onDeleteWorkLog: (id: string) => void;
  submittingWorkLog: boolean;
}

type Tab = 'comments' | 'history' | 'time';

export default function TaskActivityComments({
  issue,
  comments,
  onAddComment,
  onUpdateComment,
  submittingComment,
  editingCommentId,
  mentionUsers,
  workLogs,
  currentUserId,
  onAddWorkLog,
  onDeleteWorkLog,
  submittingWorkLog,
}: TaskActivityCommentsProps) {
  const [activeTab, setActiveTab] = useState<Tab>('comments');

  const tabClass = (tab: Tab) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors whitespace-nowrap ${
      activeTab === tab
        ? 'bg-[color:var(--accent)] text-white font-semibold shadow-sm'
        : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] hover:text-[color:var(--text-primary)]'
    }`;

  const badgeClass = (active: boolean) =>
    `min-w-[1.1rem] h-[1.1rem] px-1 inline-flex items-center justify-center rounded-full text-[9px] font-bold ${
      active ? 'bg-white/25 text-white' : 'bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)]'
    }`;

  return (
    <section className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
        <span className="type-label-caps shrink-0">Activity</span>
        <div className="flex gap-1">
          <button type="button" onClick={() => setActiveTab('comments')} className={tabClass('comments')}>
            Comments
            {comments.length > 0 && (
              <span className={badgeClass(activeTab === 'comments')}>{comments.length}</span>
            )}
          </button>
          <button type="button" onClick={() => setActiveTab('history')} className={tabClass('history')}>
            History
          </button>
          <button type="button" onClick={() => setActiveTab('time')} className={tabClass('time')}>
            Time
            {workLogs.length > 0 && (
              <span className={badgeClass(activeTab === 'time')}>{workLogs.length}</span>
            )}
          </button>
        </div>
      </div>

      {activeTab === 'comments' && (
        <div className="px-4 py-4">
          <TaskCommentBox
            onSubmit={onAddComment}
            submitting={submittingComment}
            mentionUsers={mentionUsers}
            placeholder="Add a comment… (supports **bold**, *italic*, `code`, images, videos)"
          />
          <ul className="space-y-3 mt-4">
            {comments.length === 0 ? (
              <li className="type-meta py-6 text-center italic">No comments yet.</li>
            ) : (
              comments.map((c) => (
                <li key={c._id}>
                  <TaskCommentItem
                    comment={c}
                    currentUserId={currentUserId}
                    mentionUsers={mentionUsers}
                    onUpdate={onUpdateComment}
                    submittingEdit={submittingComment && editingCommentId === c._id}
                  />
                </li>
              ))
            )}
          </ul>
        </div>
      )}
      {activeTab === 'history' && (
        <div className="px-4 py-4">
          <TaskHistoryStack issue={issue} />
        </div>
      )}
      {activeTab === 'time' && (
        <div className="px-4 py-4 space-y-4">
          <WorkLogInput onAdd={onAddWorkLog} submitting={submittingWorkLog} />
          <WorkLogList
            logs={workLogs}
            currentUserId={currentUserId}
            onDelete={onDeleteWorkLog}
          />
        </div>
      )}
    </section>
  );
}
