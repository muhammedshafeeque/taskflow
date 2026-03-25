import { Link, useNavigate } from 'react-router-dom';

interface TaskBreadcrumbProps {
  projectId?: string;
  projectName: string;
  issueKey: string;
  onDelete: () => void;
}

export default function TaskBreadcrumb({
  projectId,
  projectName,
  issueKey,
  onDelete,
}: TaskBreadcrumbProps) {
  const navigate = useNavigate();

  return (
    <div className="mb-4 sm:mb-5">
      {projectId ? (
        <Link
          to={`/projects/${projectId}/issues`}
          className="text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors inline-flex items-center gap-1"
        >
          ← Back to issues
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors"
        >
          ← Back
        </button>
      )}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mt-2">
        <nav className="text-sm text-[color:var(--text-muted)] leading-relaxed">
          <span className="text-[color:var(--text-primary)]/90">{projectName}</span>
          <span className="mx-2 opacity-50">/</span>
          <span>Work items</span>
          <span className="mx-2 opacity-50">/</span>
          <span className="font-mono font-medium text-[color:var(--text-primary)]">{issueKey}</span>
        </nav>
        <button
          type="button"
          onClick={onDelete}
          className="text-xs font-medium px-3 py-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0 self-start"
        >
          Delete issue
        </button>
      </div>
    </div>
  );
}
