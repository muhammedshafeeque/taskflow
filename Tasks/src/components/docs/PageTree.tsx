import { useEffect, useMemo, useState, type DragEvent, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { FiChevronRight, FiPlus } from 'react-icons/fi';
import { PageGlyph, ancestorIds, buildTree, pagePath, type TreeItem } from './docsUi';
import type { DocTreeNode } from '../../lib/docsApi';

type DropSpot = { id: string; where: 'before' | 'after' | 'inside' } | null;

const EXPANDED_KEY = (spaceKey: string) => `docs.tree.expanded.${spaceKey}`;

function readExpanded(spaceKey: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(EXPANDED_KEY(spaceKey)) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function writeExpanded(spaceKey: string, ids: string[]) {
  try {
    localStorage.setItem(EXPANDED_KEY(spaceKey), JSON.stringify(ids));
  } catch {
    /* storage unavailable */
  }
}

export default function PageTree({
  spaceKey,
  nodes,
  activeId,
  canEdit,
  homePageId,
  filter,
  onAddChild,
  onMove,
}: {
  spaceKey: string;
  nodes: DocTreeNode[];
  activeId?: string;
  canEdit: boolean;
  homePageId: string | null;
  filter: string;
  onAddChild: (parentId: string | null) => void;
  /** Move `id` under `parentId` at `index` among its new siblings. */
  onMove: (id: string, parentId: string | null, index: number) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(readExpanded(spaceKey)));
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropSpot>(null);
  const tree = useMemo(() => buildTree(nodes.filter((n) => n.id !== homePageId)), [nodes, homePageId]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  useEffect(() => setExpanded(new Set(readExpanded(spaceKey))), [spaceKey]);

  // Keep the open page visible.
  useEffect(() => {
    const up = ancestorIds(nodes, activeId);
    if (!up.length) return;
    setExpanded((cur) => {
      if (up.every((id) => cur.has(id))) return cur;
      const next = new Set([...cur, ...up]);
      writeExpanded(spaceKey, [...next]);
      return next;
    });
  }, [activeId, nodes, spaceKey]);

  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeExpanded(spaceKey, [...next]);
      return next;
    });

  const q = filter.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    const hit = new Set<string>();
    for (const n of nodes) {
      if (!n.title.toLowerCase().includes(q)) continue;
      hit.add(n.id);
      ancestorIds(nodes, n.id).forEach((a) => hit.add(a));
    }
    return hit;
  }, [nodes, q]);

  const isInside = (id: string, maybeAncestor: string) => ancestorIds(nodes, id).includes(maybeAncestor);

  function onDragOver(e: DragEvent, item: TreeItem) {
    if (!dragId || dragId === item.id || isInside(item.id, dragId)) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    setDrop({ id: item.id, where: y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'inside' });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    if (!dragId || !drop) return reset();
    const target = byId.get(drop.id);
    if (!target) return reset();
    if (drop.where === 'inside') {
      const count = nodes.filter((n) => n.parentId === target.id && n.id !== dragId).length;
      onMove(dragId, target.id, count);
      setExpanded((cur) => new Set([...cur, target.id]));
    } else {
      const siblings = nodes
        .filter((n) => n.parentId === target.parentId && n.id !== dragId)
        .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
      const at = siblings.findIndex((s) => s.id === target.id);
      onMove(dragId, target.parentId, drop.where === 'before' ? at : at + 1);
    }
    reset();
  }

  const reset = () => {
    setDragId(null);
    setDrop(null);
  };

  const render = (items: TreeItem[], depth: number): ReactElement[] =>
    items
      .filter((item) => !matches || matches.has(item.id))
      .map((item) => {
        const open = Boolean(matches) || expanded.has(item.id);
        const active = item.id === activeId;
        const spot = drop?.id === item.id ? drop.where : null;
        return (
          <li key={item.id}>
            <div
              draggable={canEdit && !q}
              onDragStart={(e) => {
                setDragId(item.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={reset}
              onDragOver={(e) => onDragOver(e, item)}
              onDragLeave={() => setDrop((d) => (d?.id === item.id ? null : d))}
              onDrop={onDrop}
              className={`group relative flex items-center gap-1 rounded-lg pr-1 text-[13px] transition ${
                active ? 'bg-[color:var(--accent-subtle)] text-[color:var(--accent)] font-medium' : 'text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)]'
              } ${spot === 'inside' ? 'ring-2 ring-[color:var(--accent)]' : ''} ${dragId === item.id ? 'opacity-40' : ''}`}
              style={{ paddingLeft: 4 + depth * 14 }}
            >
              {spot === 'before' && <span className="pointer-events-none absolute -top-px left-2 right-2 h-0.5 rounded bg-[color:var(--accent)]" />}
              {spot === 'after' && <span className="pointer-events-none absolute -bottom-px left-2 right-2 h-0.5 rounded bg-[color:var(--accent)]" />}
              <button
                type="button"
                onClick={() => toggle(item.id)}
                className={`grid h-5 w-5 shrink-0 place-items-center rounded text-[color:var(--text-muted)] hover:bg-[color:var(--bg-surface)] ${item.children.length ? '' : 'invisible'}`}
                aria-label={open ? 'Collapse' : 'Expand'}
              >
                <FiChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
              </button>
              <Link to={pagePath(spaceKey, item.id)} className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5" draggable={false}>
                <PageGlyph emoji={item.emoji} locked={item.locked} />
                <span className="truncate">{item.title}</span>
                {item.status === 'draft' && <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] font-semibold uppercase text-amber-500">Draft</span>}
              </Link>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => onAddChild(item.id)}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded text-[color:var(--text-muted)] opacity-0 group-hover:opacity-100 hover:bg-[color:var(--bg-surface)] hover:text-[color:var(--accent)]"
                  title="Add a child page"
                >
                  <FiPlus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {open && item.children.length > 0 && <ul>{render(item.children, depth + 1)}</ul>}
          </li>
        );
      });

  if (!tree.length) {
    return <p className="px-3 py-2 text-xs text-[color:var(--text-muted)]">{q ? 'No pages match.' : 'No pages yet.'}</p>;
  }

  return (
    <ul
      className="space-y-px"
      onDragOver={(e) => {
        // Dropping on empty space below the tree moves the page to the end of the top level.
        if (dragId && e.target === e.currentTarget) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.target !== e.currentTarget || !dragId) return;
        e.preventDefault();
        onMove(dragId, null, nodes.length);
        reset();
      }}
    >
      {render(tree, 0)}
    </ul>
  );
}
