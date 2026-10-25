import { useEffect } from 'react';
import type { RecordType } from '../lib/api';
import RecordLinksPanel from './RecordLinksPanel';

/** Linked records for list-only record types (employees, assets, POs), in a side drawer. */
export default function RecordLinksDrawer({
  type,
  id,
  title,
  onClose,
}: {
  type: RecordType;
  id: string;
  title?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg h-full overflow-y-auto bg-[color:var(--bg-surface)] border-l border-[color:var(--border-subtle)] p-6 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="text-lg font-semibold truncate">{title || 'Linked records'}</h2>
          <button type="button" onClick={onClose} className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]">
            ✕
          </button>
        </div>
        <RecordLinksPanel type={type} id={id} />
      </div>
    </div>
  );
}
