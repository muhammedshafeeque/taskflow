interface KanbanDragPreviewProps {
  issueKey: string;
  title: string;
}

/** Lightweight drag ghost for Kanban (no links/buttons). */
export function KanbanDragPreview({ issueKey, title }: KanbanDragPreviewProps) {
  return (
    <div className="w-72 max-w-[85vw] p-3 rounded-xl bg-[color:var(--bg-elevated)] border-2 border-[color:var(--accent)] shadow-2xl cursor-grabbing">
      <p className="text-[11px] font-mono text-[color:var(--text-muted)]">{issueKey}</p>
      <p className="text-sm font-medium text-[color:var(--text-primary)] truncate mt-0.5">{title}</p>
    </div>
  );
}
