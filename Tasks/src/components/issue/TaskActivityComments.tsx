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
    <section className="mb-8">
      <div className="flex items-center gap-4 mb-3">
        <h2 className="text-xs font-semibold text-[color:var(--text-muted)] uppercase tracking-wider">
          Activity
        </h2>
        <div className="flex rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-0.5">
          <button
            type="button"
            onClick={() => setActiveTab('comments')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'comments'
                ? 'bg-[color:var(--bg-page)] text-[color:var(--text-primary)]'
                : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]'
            }`}
          >
            Comments ({comments.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'history'
                ? 'bg-[color:var(--bg-page)] text-[color:var(--text-primary)]'
                : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]'
            }`}
          >
            History
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('time')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === 'time'
                ? 'bg-[color:var(--bg-page)] text-[color:var(--text-primary)]'
                : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]'
            }`}
          >
            Time
          </button>
        </div>
      </div>

      <div className="rounded-xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
        {activeTab === 'comments' && (
          <div className="p-4">
            <TaskCommentBox
              onSubmit={onAddComment}
              submitting={submittingComment}
              mentionUsers={mentionUsers}
              placeholder="Add a comment… (supports **bold**, *italic*, `code`, images, videos)"
            />
            <ul className="space-y-4 mt-6">
              {comments.length === 0 ? (
                <li className="text-[color:var(--text-muted)] text-xs py-4">No comments yet.</li>
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
          <div className="p-4">
            <TaskHistoryStack issue={issue} />
          </div>
        )}
        {activeTab === 'time' && (
          <div className="p-4 space-y-4">
            <WorkLogInput onAdd={onAddWorkLog} submitting={submittingWorkLog} />
            <WorkLogList
              logs={workLogs}
              currentUserId={currentUserId}
              onDelete={onDeleteWorkLog}
            />
          </div>
        )}
      </div>
    </section>
  );
}
