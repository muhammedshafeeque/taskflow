import { Link } from 'react-router-dom';
import type { Issue } from '../../lib/api';
import { getIssueKey } from '../../lib/api';

interface TaskSubtasksProps {
  issueId: string;
  projectId: string | undefined;
  subtasks: Issue[];
  getStatusMeta: (name: string) => { color?: string; icon?: string } | undefined;
}

export default function TaskSubtasks({
  issueId,
  projectId,
  subtasks,
  getStatusMeta,
}: TaskSubtasksProps) {
  const addSubtaskUrl = projectId
    ? `/projects/${projectId}/issues?create=1&parent=${issueId}`
    : '#';

  return (
    <div className="rounded-xl border border-[color:var(--border-subtle)]/90 bg-[color:var(--bg-surface)] p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[10px] font-semibold text-[color:var(--text-muted)] uppercase tracking-[0.1em]">
          Subtasks
        </h3>
        {projectId && (
          <Link
            to={addSubtaskUrl}
            className="text-xs font-medium px-3 py-1.5 rounded-lg text-[color:var(--accent)] hover:bg-[color:var(--accent)]/10 transition-colors"
          >
            Add subtask
          </Link>
        )}
      </div>
      {subtasks.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)] py-1">No subtasks yet.</p>
      ) : (
        <ul className="space-y-2">
          {subtasks.map((st) => {
            const meta = getStatusMeta(st.status);
            return (
              <li
                key={st._id}
                className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-[color:var(--bg-page)]"
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
    </div>
  );
}
