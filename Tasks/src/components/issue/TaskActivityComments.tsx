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
  submittingComment: boolean;
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
  submittingComment,
  mentionUsers,
  workLogs,
  currentUserId,
  onAddWorkLog,
  onDeleteWorkLog,
  submittingWorkLog,
}: TaskActivityCommentsProps) {
  const [activeTab, setActiveTab] = useState<Tab>('comments');

  return (
    <section className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
        <span className="type-label-caps shrink-0">
          Activity
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('comments')}
            className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
              activeTab === 'comments'
                ? 'bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] border border-[color:var(--border-subtle)] shadow-sm font-semibold'
                : 'font-normal text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]'
            }`}
          >
            Comments ({comments.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
              activeTab === 'history'
                ? 'bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] border border-[color:var(--border-subtle)] shadow-sm font-semibold'
                : 'font-normal text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]'
            }`}
          >
            History
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('time')}
            className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
              activeTab === 'time'
                ? 'bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] border border-[color:var(--border-subtle)] shadow-sm font-semibold'
                : 'font-normal text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]'
            }`}
          >
            Time
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
              <li className="type-meta py-4 text-center italic">No comments yet.</li>
            ) : (
              comments.map((c) => (
                <li key={c._id}>
                  <TaskCommentItem comment={c} />
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
