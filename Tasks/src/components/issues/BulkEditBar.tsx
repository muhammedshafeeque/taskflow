import { FiEdit3, FiTrash2, FiX } from 'react-icons/fi';

interface BulkEditBarProps {
  selectedCount: number;
  setBulkModal: (modal: 'edit' | null) => void;
  setConfirmBulkDelete: (v: boolean) => void;
  setSelectedIssueIds: (ids: Set<string>) => void;
}

export function BulkEditBar({
  selectedCount,
  setBulkModal,
  setConfirmBulkDelete,
  setSelectedIssueIds,
}: BulkEditBarProps) {
  if (selectedCount === 0) return null;

  // Floats above the list so it stays reachable however far the user has scrolled.
  return (
    <div
      role="toolbar"
      aria-label="Bulk actions"
      className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-[color:var(--border-emphasis)] bg-[color:var(--bg-elevated)] p-1.5 pl-4 shadow-[0_12px_40px_rgba(0,0,0,0.35)] animate-fade-in"
    >
      <span className="mr-2 flex items-center gap-2 text-[13px] font-semibold text-[color:var(--text-primary)]">
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-[color:var(--accent)] px-1.5 text-[11px] font-bold tabular-nums text-white">
          {selectedCount}
        </span>
        selected
      </span>
      <button
        type="button"
        onClick={() => setBulkModal('edit')}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold text-[color:var(--text-primary)] transition hover:bg-[color:var(--accent-subtle)] hover:text-[color:var(--accent)]"
      >
        <FiEdit3 className="h-3.5 w-3.5" aria-hidden />
        Edit
      </button>
      <button
        type="button"
        onClick={() => setConfirmBulkDelete(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold text-red-500 transition hover:bg-red-500/10"
      >
        <FiTrash2 className="h-3.5 w-3.5" aria-hidden />
        Delete
      </button>
      <span className="mx-1 h-5 w-px bg-[color:var(--border-subtle)]" aria-hidden />
      <button
        type="button"
        onClick={() => setSelectedIssueIds(new Set())}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--text-muted)] transition hover:bg-[color:var(--bg-page)] hover:text-[color:var(--text-primary)]"
        aria-label="Clear selection"
        title="Clear selection"
      >
        <FiX className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
