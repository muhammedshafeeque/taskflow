import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FiFileText, FiLock } from 'react-icons/fi';
import RichTextContent from '../richText/RichTextContent';
import { Avatar, RelativeDate } from '../issues/issueUi';
import { docsApi, type DocIssueRef, type DocPageCard, type DocPersonRef, type DocProjectRef, type DocSpaceRole, type DocTreeNode } from '../../lib/docsApi';

export const SPACE_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#64748b'];

export const ROLE_LABEL: Record<DocSpaceRole, string> = { admin: 'Admin', editor: 'Can edit', viewer: 'Can view' };

export function spaceColor(color?: string) {
  return color || 'var(--accent)';
}

/** Docs home and project docs fill the content area with the app's standard gutters, like other list pages. */
export const DOCS_INDEX = 'w-full px-4 sm:px-6 lg:px-8';

/**
 * Page layout shared by the reader and the editor, so text stays in the same place when switching modes.
 * Pages fill the reading pane (outline rail on wide screens); `narrow` pages use a ~820px reading column.
 */
export function docLayout(narrow: boolean) {
  return {
    shell: `mx-auto w-full px-4 pb-24 sm:px-6 lg:px-10 ${narrow ? 'max-w-[1140px]' : 'max-w-none'}`,
    grid: 'grid gap-10 xl:grid-cols-[minmax(0,1fr)_220px]',
    column: `mx-auto w-full min-w-0 ${narrow ? 'max-w-[820px]' : 'max-w-none'}`,
    rail: 'hidden xl:block',
  };
}

export function pagePath(spaceKey: string | undefined, pageId: string, edit = false) {
  return `/docs/${spaceKey ?? '_'}/pages/${pageId}${edit ? '?edit=1' : ''}`;
}

/** Square badge showing the space emoji, or its key's first letter on the space colour. */
export function SpaceBadge({ icon, name, color, size = 32 }: { icon?: string; name: string; color?: string; size?: number }) {
  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-lg font-bold text-white"
      style={{ width: size, height: size, fontSize: icon ? size * 0.55 : size * 0.42, background: icon ? 'var(--bg-elevated)' : spaceColor(color) }}
      aria-hidden
    >
      {icon || name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function PageGlyph({ emoji, locked, className = '' }: { emoji?: string; locked?: boolean; className?: string }) {
  return (
    <span className={`relative inline-grid w-5 shrink-0 place-items-center ${className}`}>
      {emoji ? <span className="text-[15px] leading-none">{emoji}</span> : <FiFileText className="h-3.5 w-3.5 text-[color:var(--text-muted)]" />}
      {locked && <FiLock className="absolute -bottom-1 -right-1 h-2.5 w-2.5 text-amber-400" />}
    </span>
  );
}

export interface TreeItem extends DocTreeNode {
  children: TreeItem[];
}

/** Nests the flat page list; pages whose parent is hidden (another user's draft) go to the top level. */
export function buildTree(nodes: DocTreeNode[]): TreeItem[] {
  const byId = new Map<string, TreeItem>(nodes.map((n) => [n.id, { ...n, children: [] }]));
  const roots: TreeItem[] = [];
  for (const item of byId.values()) {
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    (parent ? parent.children : roots).push(item);
  }
  const sort = (list: TreeItem[]) => {
    list.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
    list.forEach((c) => sort(c.children));
  };
  sort(roots);
  return roots;
}

/** Ids of a page and every page above it, for expanding the tree to the open page. */
export function ancestorIds(nodes: DocTreeNode[], id: string | undefined): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: string[] = [];
  let cur = id ? byId.get(id) : undefined;
  while (cur?.parentId && !out.includes(cur.parentId)) {
    out.push(cur.parentId);
    cur = byId.get(cur.parentId);
  }
  return out;
}

export interface OutlineItem {
  id: string;
  text: string;
  level: number;
}

const KEY_RE = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;

/**
 * Prepares stored page HTML for reading: gives headings anchors for the outline and turns
 * known issue keys into links to the issue.
 */
export function preparePageHtml(html: string, issues: DocIssueRef[]): { html: string; outline: OutlineItem[] } {
  if (!html?.trim() || typeof DOMParser === 'undefined') return { html, outline: [] };
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root');
  if (!root) return { html, outline: [] };
  const outline: OutlineItem[] = [];
  const used = new Set<string>();
  root.querySelectorAll('h1, h2, h3').forEach((h) => {
    const text = h.textContent?.trim() ?? '';
    if (!text) return;
    let id = `h-${text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'section'}`;
    for (let n = 2; used.has(id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`;
    used.add(id);
    h.id = id;
    outline.push({ id, text, level: Number(h.tagName[1]) });
  });
  const byKey = new Map(issues.filter((i) => i.key && i.projectId).map((i) => [i.key!, i]));
  if (byKey.size) {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node.parentElement?.closest('a, code, pre') ?? null) === null && KEY_RE.test(node.nodeValue ?? '')) targets.push(node as Text);
      KEY_RE.lastIndex = 0;
    }
    for (const text of targets) {
      const value = text.nodeValue ?? '';
      const frag = doc.createDocumentFragment();
      let last = 0;
      for (const m of value.matchAll(KEY_RE)) {
        const issue = byKey.get(m[1]);
        if (!issue) continue;
        frag.append(value.slice(last, m.index));
        const a = doc.createElement('a');
        a.href = `/projects/${issue.projectId}/issues/${encodeURIComponent(m[1])}`;
        a.textContent = m[1];
        a.title = issue.hidden ? m[1] : `${m[1]} · ${issue.title ?? ''}${issue.status ? ` (${issue.status})` : ''}`;
        a.className = 'doc-issue-key';
        frag.append(a);
        last = (m.index ?? 0) + m[0].length;
      }
      if (last === 0) continue;
      frag.append(value.slice(last));
      text.replaceWith(frag);
    }
  }
  return { html: root.innerHTML, outline };
}

/** Typography shared by the reader and the editor so a page looks the same in both. */
export const DOC_PROSE = [
  'text-[color:var(--text-primary)]',
  '[&_h1]:text-[1.75rem] [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:mt-10 [&_h1]:mb-3 [&_h1]:scroll-mt-20',
  '[&_h2]:text-[1.35rem] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:mt-9 [&_h2]:mb-2 [&_h2]:pb-1.5 [&_h2]:border-b [&_h2]:border-[color:var(--border-subtle)] [&_h2]:scroll-mt-20',
  '[&_h3]:text-[1.1rem] [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-1.5 [&_h3]:scroll-mt-20',
  '[&_p]:my-2.5 [&_li]:my-1 [&_li>p]:my-0',
  '[&_blockquote]:my-4 [&_blockquote]:rounded-r-lg [&_blockquote]:border-l-4 [&_blockquote]:border-[color:var(--accent)] [&_blockquote]:bg-[color:var(--accent-subtle)] [&_blockquote]:px-4 [&_blockquote]:py-2 [&_blockquote]:not-italic',
  '[&_pre]:my-4 [&_pre]:rounded-xl [&_pre]:bg-[color:var(--bg-elevated)] [&_pre]:p-4 [&_pre]:text-[13px] [&_pre]:font-mono [&_pre]:overflow-x-auto',
  '[&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:bg-[color:var(--bg-elevated)] [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-[0.85em] [&_:not(pre)>code]:font-mono',
  '[&_table]:my-5 [&_table]:w-full [&_table]:overflow-hidden [&_table]:rounded-xl [&_table]:text-sm [&_th]:bg-[color:var(--bg-elevated)] [&_th]:text-left [&_th]:font-semibold',
  '[&_hr]:my-8 [&_hr]:border-[color:var(--border-subtle)] [&_img]:rounded-xl [&_img]:my-3',
  '[&_a]:text-[color:var(--accent)] [&_a]:underline-offset-2 hover:[&_a]:underline',
  '[&_.doc-issue-key]:inline-flex [&_.doc-issue-key]:items-center [&_.doc-issue-key]:rounded-md [&_.doc-issue-key]:border [&_.doc-issue-key]:border-[color:var(--accent)]/30 [&_.doc-issue-key]:bg-[color:var(--accent-subtle)] [&_.doc-issue-key]:px-1.5 [&_.doc-issue-key]:font-mono [&_.doc-issue-key]:text-[0.8em] [&_.doc-issue-key]:font-semibold [&_.doc-issue-key]:no-underline',
].join(' ');

/** Banner across the top of a page, tinted with the space colour. */
export function PageCover({ color, compact }: { color?: string; compact?: boolean }) {
  const c = color || 'var(--accent)';
  return (
    // Isolation keeps the cover’s absolute washes from painting over the title that overlaps via negative margin.
    <div
      className={`pointer-events-none relative isolate w-full overflow-hidden ${compact ? 'h-16 sm:h-20' : 'h-36 sm:h-44'}`}
      style={{
        background: `radial-gradient(ellipse 60% 120% at 15% 0%, color-mix(in srgb, ${c} 55%, transparent), transparent 60%), radial-gradient(ellipse 50% 120% at 90% 100%, color-mix(in srgb, ${c} 35%, transparent), transparent 60%), linear-gradient(135deg, color-mix(in srgb, ${c} 22%, var(--bg-surface)), var(--bg-surface))`,
      }}
      aria-hidden
    >
      <div className="absolute inset-0 opacity-[0.15]" style={{ backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '18px 18px', color: c }} />
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[color:var(--bg-page)] to-transparent" />
    </div>
  );
}

/** Jira-style issue chip: key, title and status. */
export function IssueChip({ issue, onRemove }: { issue: DocIssueRef; onRemove?: () => void }) {
  const href = issue.projectId && issue.key && !issue.hidden ? `/projects/${issue.projectId}/issues/${encodeURIComponent(issue.key)}` : undefined;
  const inner = (
    <>
      <span className="font-mono text-[11px] font-semibold text-[color:var(--accent)]">{issue.key}</span>
      {!issue.hidden && issue.title && <span className="max-w-[220px] truncate text-[12px] text-[color:var(--text-primary)]">{issue.title}</span>}
      {issue.status && <span className="rounded-full bg-[color:var(--bg-elevated)] px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">{issue.status}</span>}
    </>
  );
  const cls = 'group/chip inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1 transition';
  return (
    <span className={`${cls} ${href ? 'hover:border-[color:var(--accent)]/50 hover:shadow-sm' : ''}`}>
      {href ? (
        <Link to={href} className="inline-flex items-center gap-1.5">
          {inner}
        </Link>
      ) : (
        inner
      )}
      {onRemove && (
        <button type="button" onClick={onRemove} className="ml-0.5 text-[color:var(--text-muted)] hover:text-red-400" aria-label={`Unlink ${issue.key}`}>
          ×
        </button>
      )}
    </span>
  );
}

/** Renders page HTML; in-app links navigate without a full page load. */
export function DocContent({ html }: { html: string }) {
  const navigate = useNavigate();
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!a || !href) return;
    if (href.startsWith('#')) {
      e.preventDefault();
      document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (href.startsWith('/') && !href.startsWith('//') && !e.metaKey && !e.ctrlKey && a.target !== '_blank') {
      e.preventDefault();
      navigate(href);
    }
  };
  return (
    <div
      onClick={onClick}
      className={`doc-content text-[16px] leading-[1.8] ${DOC_PROSE}`}
    >
      <RichTextContent body={html} />
    </div>
  );
}

export function PersonLine({ person, prefix, at }: { person?: DocPersonRef | null; prefix?: string; at?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[color:var(--text-muted)]">
      <Avatar name={person?.name ?? person?.email} size={18} />
      <span>
        {prefix} <span className="text-[color:var(--text-primary)]">{person?.name ?? 'Someone'}</span>
      </span>
      {at && (
        <>
          <span>·</span>
          <RelativeDate value={at} />
        </>
      )}
    </span>
  );
}

/** Compact page row used on the docs home, search results and link panels. */
export function PageCardRow({ page, right, showSpace = true }: { page: DocPageCard; right?: ReactNode; showSpace?: boolean }) {
  return (
    <div className="group flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-[color:var(--bg-elevated)]/70 transition">
      <PageGlyph emoji={page.emoji} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <Link to={pagePath(page.space?.key, page.id)} className="flex items-center gap-2 font-medium text-sm text-[color:var(--text-primary)] hover:text-[color:var(--accent)]">
          <span className="truncate">{page.title}</span>
          {page.status === 'draft' && <span className="shrink-0 rounded bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-500">Draft</span>}
          {page.linkType === 'mentioned' && <span className="shrink-0 rounded bg-[color:var(--bg-elevated)] px-1.5 text-[10px] text-[color:var(--text-muted)]">mentions</span>}
        </Link>
        {page.excerpt && <p className="mt-0.5 line-clamp-1 text-xs text-[color:var(--text-muted)]">{page.excerpt}</p>}
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[color:var(--text-muted)]">
          {showSpace && page.space && (
            <Link to={`/docs/${page.space.key}`} className="inline-flex items-center gap-1 hover:text-[color:var(--accent)]">
              <SpaceBadge icon={page.space.icon} name={page.space.name} color={page.space.color} size={14} />
              {page.space.name}
            </Link>
          )}
          {page.updatedBy?.name && <span>{page.updatedBy.name}</span>}
          <RelativeDate value={page.updatedAt} />
        </div>
      </div>
      {right}
    </div>
  );
}

let optionsCache: Promise<{ people: DocPersonRef[]; projects: DocProjectRef[] }> | null = null;
let optionsToken = '';

/** People and projects for the docs pickers, fetched once per session token. */
export function useDocsOptions(token: string | null | undefined) {
  const [options, setOptions] = useState<{ people: DocPersonRef[]; projects: DocProjectRef[] }>({ people: [], projects: [] });
  useEffect(() => {
    if (!token) return;
    if (!optionsCache || optionsToken !== token) {
      optionsToken = token;
      optionsCache = docsApi.options(token).then((r) => (r.success && r.data ? r.data : { people: [], projects: [] }));
    }
    let live = true;
    optionsCache.then((o) => live && setOptions(o));
    return () => {
      live = false;
    };
  }, [token]);
  return options;
}

export function useDocsMe(token: string | null | undefined) {
  const [me, setMe] = useState({ canCreateSpace: false, isDocsAdmin: false });
  useEffect(() => {
    if (!token) return;
    docsApi.me(token).then((r) => r.success && r.data && setMe(r.data));
  }, [token]);
  return me;
}

export function errorText(res: { message?: string } | undefined, fallback = 'Something went wrong') {
  return res?.message || fallback;
}
