import { Link } from 'react-router-dom';
import type { Issue } from '../../lib/api';
import { getIssueKey } from '../../lib/api';

interface TaskSubtasksProps {
  issueId: string;
  projectId: string | undefined;
  subtasks: Issue[];
  getStatusMeta: (name: string) => { color?: string; icon?: string } | undefined;
  noWrapper?: boolean;
}

export default function TaskSubtasks({
  issueId,
  projectId,
  subtasks,
  getStatusMeta,
  noWrapper = false,
}: TaskSubtasksProps) {
  const addSubtaskUrl = projectId
    ? `/projects/${projectId}/issues?create=1&parent=${issueId}`
    : '#';

  const content = (
    <>
      {subtasks.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)] italic py-6 text-center px-4">No subtasks yet.</p>
      ) : (
        <ul className="px-4 py-3 space-y-1.5">
          {subtasks.map((st) => {
            const meta = getStatusMeta(st.status);
            return (
              <li
                key={st._id}
                className="flex items-center gap-3 py-2 px-2 rounded-md border-l-2 border-l-transparent hover:border-l-[color:var(--color-inprogress)] hover:bg-[color:var(--bg-page)] transition-all"
              >
                <Link
                  to={`/projects/${projectId}/issues/${encodeURIComponent(getIssueKey(st))}`}
                  className="font-mono text-xs font-medium text-[color:var(--accent)] hover:underline shrink-0"
                >
                  {getIssueKey(st)}
                </Link>
                <span className="flex-1 min-w-0 text-xs text-[color:var(--text-primary)] truncate">
                  {st.title}
                </span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                  style={{
                    backgroundColor: meta?.color ? `${meta.color}20` : undefined,
                    color: meta?.color ?? 'var(--text-muted)',
                  }}
                >
                  {st.status}
                </span>
                {st.assignee && (
                  <span className="text-[10px] text-[color:var(--text-muted)] shrink-0">
                    {st.assignee.name}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );

  if (noWrapper) return content;

  return (
    <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--text-muted)]">
          Subtasks{' '}
          <span className="ml-1 bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] px-1.5 py-0.5 rounded-full text-[10px] font-semibold">
            {subtasks.length}
          </span>
        </span>
        {projectId && (
          <Link
            to={addSubtaskUrl}
            className="text-xs font-medium px-2.5 py-1 rounded-md text-[color:var(--accent)] hover:bg-[color:var(--accent)]/10 transition-colors"
          >
            Add subtask
          </Link>
        )}
      </div>
      {content}
    </div>
  );
}
