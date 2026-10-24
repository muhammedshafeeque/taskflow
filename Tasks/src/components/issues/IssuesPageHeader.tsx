import type { ReactNode } from 'react';
import { FiCheckSquare, FiEye, FiLayers, FiPlus, FiUser } from 'react-icons/fi';
import type { QuickFilterValue } from './constants';

interface IssuesPageHeaderProps {
  title: string;
  /** Context line under the title, e.g. project name or "Across all projects". */
  context?: string;
  total: number;
  loading: boolean;
  quickFilter: QuickFilterValue;
  totalCounts: { my: number; open: number; all: number } | null;
  onQuickFilter: (q: QuickFilterValue) => void;
  onCreate?: () => void;
  /** Toolbar, saved filters, chips — rendered below the title row inside the sticky header. */
  children?: ReactNode;
}

const SCOPES: { key: QuickFilterValue; label: string; hint: string; Icon: typeof FiUser }[] = [
  { key: 'my', label: 'Assigned to me', hint: 'Open issues assigned to you', Icon: FiUser },
  { key: 'open', label: 'Open', hint: 'All issues that are not done', Icon: FiEye },
  { key: 'all', label: 'All issues', hint: 'Everything, including done', Icon: FiLayers },
];

/** Sticky header shared by the project and global issue lists. */
export function IssuesPageHeader({
  title,
  context,
  total,
  loading,
  quickFilter,
  totalCounts,
  onQuickFilter,
  onCreate,
  children,
}: IssuesPageHeaderProps) {
  return (
    <header className="shrink-0 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]">
      <div className="px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--accent)]/25 bg-gradient-to-br from-[color:var(--accent)]/25 to-[color:var(--accent)]/5">
              <FiCheckSquare className="h-[18px] w-[18px] text-[color:var(--accent)]" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold leading-tight tracking-tight text-[color:var(--text-primary)]">{title}</h1>
              <p className="truncate text-[12px] text-[color:var(--text-muted)]">
                {context && <span className="font-medium text-[color:var(--text-primary)]/80">{context} · </span>}
                {loading ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? 'issue' : 'issues'} in view`}
              </p>
            </div>
          </div>

          {onCreate && (
            <button
              type="button"
              onClick={() => onCreate()}
              className="btn-primary btn-primary-sm inline-flex items-center gap-1.5 font-semibold shadow-md"
              title="Create a new issue"
            >
              <FiPlus className="h-4 w-4" aria-hidden />
              New issue
            </button>
          )}
        </div>

        {/* Scope tabs — underline style so they read as navigation, not filters. */}
        <nav className="-mb-px mt-3 flex gap-1 overflow-x-auto" aria-label="Issue scope">
          {SCOPES.map(({ key, label, hint, Icon }) => {
            const active = quickFilter === key;
            const count = totalCounts?.[key];
            return (
              <button
                key={key}
                type="button"
                title={hint}
                aria-current={active ? 'page' : undefined}
                onClick={() => onQuickFilter(key)}
                className={`group inline-flex shrink-0 items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-[13px] font-medium transition ${
                  active
                    ? 'border-[color:var(--accent)] text-[color:var(--text-primary)]'
                    : 'border-transparent text-[color:var(--text-muted)] hover:border-[color:var(--border-emphasis)] hover:text-[color:var(--text-primary)]'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${active ? 'text-[color:var(--accent)]' : ''}`} aria-hidden />
                {label}
                <span
                  className={`min-w-[1.5rem] rounded-full px-1.5 py-px text-center text-[11px] font-semibold tabular-nums ${
                    active
                      ? 'bg-[color:var(--accent)] text-white'
                      : 'bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)] group-hover:text-[color:var(--text-primary)]'
                  }`}
                >
                  {count ?? '·'}
                </span>
              </button>
            );
          })}
        </nav>
      </div>
      {children && <div className="border-t border-[color:var(--border-subtle)] px-4 sm:px-6">{children}</div>}
    </header>
  );
}
