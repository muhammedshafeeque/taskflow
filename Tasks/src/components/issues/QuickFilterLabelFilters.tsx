import { FiTag } from 'react-icons/fi';
import type { QuickFilterValue } from './constants';

export type LabelFacetCount = { label: string; count: number };

interface QuickFilterLabelFiltersProps {
  /** Kept for API compatibility; the scope is shown in the page header. */
  quickFilter: QuickFilterValue;
  labelCounts: LabelFacetCount[];
  selectedLabels: string[];
  onToggleLabel: (label: string) => void;
  onClearLabels?: () => void;
  loading?: boolean;
}

export function QuickFilterLabelFilters({
  labelCounts,
  selectedLabels,
  onToggleLabel,
  onClearLabels,
  loading,
}: QuickFilterLabelFiltersProps) {
  // Nothing to pick from: hide the row instead of showing an empty-state sentence.
  if (loading || labelCounts.length === 0) return null;

  return (
    <div className="flex items-center gap-2 pb-2.5">
      <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[color:var(--text-muted)]">
        <FiTag className="h-3 w-3" aria-hidden />
        Labels
      </span>
      <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
        {labelCounts.map(({ label, count }) => {
          const active = selectedLabels.includes(label);
          return (
            <button
              key={label}
              type="button"
              onClick={() => onToggleLabel(label)}
              aria-pressed={active}
              className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition ${
                active
                  ? 'border-[color:var(--accent)] bg-[color:var(--accent)] text-white'
                  : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-[color:var(--text-primary)] hover:border-[color:var(--border-emphasis)]'
              }`}
            >
              {label}
              <span className={`tabular-nums ${active ? 'text-white/80' : 'text-[color:var(--text-muted)]'}`}>{count}</span>
            </button>
          );
        })}
      </div>
      {selectedLabels.length > 0 && onClearLabels && (
        <button type="button" onClick={onClearLabels} className="shrink-0 text-[12px] font-medium text-[color:var(--accent)] hover:underline">
          Clear
        </button>
      )}
    </div>
  );
}
