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

  return (
    <div className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-[color:var(--accent)]/10 border border-[color:var(--accent)]/30">
      <span className="text-xs text-[color:var(--text-primary)]">
        {selectedCount} issue{selectedCount !== 1 ? 's' : ''} selected
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setBulkModal('edit');
          }}
          className="px-2 py-1 rounded text-xs font-medium border border-[color:var(--accent)] text-[color:var(--accent)] bg-transparent hover:bg-[color:var(--accent)]/10"
        >
          Bulk edit
        </button>
        <button
          type="button"
          onClick={() => setConfirmBulkDelete(true)}
          className="px-2 py-1 rounded text-xs border border-red-400 text-red-400 hover:bg-red-400/10"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => setSelectedIssueIds(new Set())}
          className="px-2 py-1 rounded text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
