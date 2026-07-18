import type { RefObject } from 'react';
import { Fragment, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Strip legacy "set to status" line from stored release notes for display */
export function sanitizeReleaseNotesForDisplay(notes: string): string {
  if (!notes || typeof notes !== 'string') return '';
  return notes
    .replace(/\*?Issues in this release have been set to status:[^\n]*\n?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Atrium issue keys: e.g. PROJ-42 or PROJ-a3f2b1 (project key + numeric suffix or last 6 of ObjectId hex).
 */
const ISSUE_KEY_TOKEN_RE = /^[A-Za-z][A-Za-z0-9]{0,20}-(?:\d+|[a-fA-F0-9]{6})$/;

const ISSUE_KEY_SPLIT_RE = /\b([A-Za-z][A-Za-z0-9]{0,20}-(?:\d+|[a-fA-F0-9]{6}))\b/g;

export function isIssueKeyToken(s: string): boolean {
  return ISSUE_KEY_TOKEN_RE.test(s.trim());
}

function linkifyPlainString(s: string, projectId: string): ReactNode {
  if (!projectId || !s) return s;
  const parts = s.split(ISSUE_KEY_SPLIT_RE);
  return parts.map((part, i) => {
    if (part && isIssueKeyToken(part)) {
      return (
        <Link
          key={i}
          to={`/projects/${projectId}/issues/${encodeURIComponent(part)}`}
          className="font-mono text-[color:var(--accent)] hover:underline underline-offset-2"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </Link>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function linkifyNodes(node: ReactNode, projectId: string): ReactNode {
  if (node == null || typeof node === 'boolean') return node;
  if (typeof node === 'string') return linkifyPlainString(node, projectId);
  if (typeof node === 'number') return node;
  if (Array.isArray(node)) {
    return node.map((child, i) => <Fragment key={i}>{linkifyNodes(child, projectId)}</Fragment>);
  }
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (el.type === Link) return el;
  if (el.type === Fragment) {
    const ch = el.props?.children;
    if (ch === undefined || ch === null) return el;
    return <Fragment>{linkifyNodes(ch, projectId)}</Fragment>;
  }
  // Custom markdown components (e.g. strong → issue link) — do not recurse or we double-wrap.
  if (typeof el.type === 'function') return el;
  if (typeof el.type === 'string') {
    const ch = el.props?.children;
    if (ch === undefined || ch === null) return el;
    return cloneElement(el, undefined, linkifyNodes(ch, projectId));
  }
  return el;
}

export function ReleaseNotesMarkdownBody({
  notes,
  projectId,
  contentRef,
  className = '',
}: {
  notes: string;
  projectId?: string;
  contentRef?: RefObject<HTMLDivElement | null>;
  className?: string;
}) {
  const sanitized = sanitizeReleaseNotesForDisplay(notes);
  const pid = projectId ?? '';

  return (
    <div
      ref={contentRef}
      className={`release-notes-markdown text-[color:var(--text-primary)] text-[14px] leading-relaxed ${className}`.trim()}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-lg font-semibold text-[color:var(--text-primary)] mt-6 mb-2 first:mt-0 border-b border-[color:var(--border-subtle)] pb-2">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mt-5 mb-2">{children}</h2>
          ),
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          table: ({ children }) => (
            <div className="overflow-x-auto my-4 rounded-xl border border-[color:var(--border-subtle)]">
              <table className="w-full border-collapse text-left text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] font-medium">{children}</thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-[color:var(--border-subtle)]/70">{children}</tbody>
          ),
          tr: ({ children }) => <tr className="hover:bg-[color:var(--bg-surface)] transition">{children}</tr>,
          th: ({ children }) => (
            <th className="px-4 py-3 text-[color:var(--text-primary)] font-semibold whitespace-nowrap">{children}</th>
          ),
          td: ({ children }) => (
            <td className="px-4 py-3 text-[color:var(--text-primary)] align-top max-w-xl break-words">
              {pid ? linkifyNodes(children, pid) : children}
            </td>
          ),
          ul: ({ children }) => <ul className="list-none space-y-2 my-3">{children}</ul>,
          li: ({ children }) => (
            <li className="flex items-baseline gap-2 pl-0">
              <span className="text-[color:var(--text-muted)] shrink-0">–</span>
              <span className="min-w-0">{children}</span>
            </li>
          ),
          strong: ({ children }) => {
            const raw = Array.isArray(children) ? children : [children];
            const text = raw.every((c) => typeof c === 'string')
              ? raw.join('').trim()
              : typeof children === 'string'
                ? children
                : null;
            if (text && isIssueKeyToken(text) && pid) {
              return (
                <Link
                  to={`/projects/${pid}/issues/${encodeURIComponent(text)}`}
                  className="font-semibold text-[color:var(--accent)] hover:underline underline-offset-2 font-mono"
                  onClick={(e) => e.stopPropagation()}
                >
                  {text}
                </Link>
              );
            }
            return <strong className="font-semibold text-[color:var(--text-primary)]">{children}</strong>;
          },
        }}
      >
        {sanitized}
      </ReactMarkdown>
    </div>
  );
}
