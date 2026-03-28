import type { FiltersShape, QuickFilterValue } from './constants';
import type { User } from '../../lib/api';

export interface ActiveFilterChipsProps {
  filters: FiltersShape;
  quickFilter: QuickFilterValue;
  updateUrl: (updates: { filters?: FiltersShape; quickFilter?: QuickFilterValue; page?: number }) => void;
  users: User[];
  onOpenFilterModal?: () => void;
}

function removeFromArray<T>(arr: T[], value: T): T[] {
  return arr.filter((v) => v !== value);
}

export function ActiveFilterChips({
  filters,
  quickFilter,
  updateUrl,
  users,
  onOpenFilterModal,
}: ActiveFilterChipsProps) {
  const userName = (id: string) => users.find((u) => u._id === id)?.name ?? id;

  const hasAnyFilter =
    filters.status.length > 0 ||
    filters.assignee.length > 0 ||
    filters.reporter.length > 0 ||
    filters.type.length > 0 ||
    filters.priority.length > 0 ||
    filters.labels.length > 0 ||
    filters.storyPoints.length > 0 ||
    filters.hasStoryPoints === false ||
    filters.hasEstimate === false ||
    filters.hasEstimate === true;

  // Default quick filter is "my"; no chip row when that is the only active scope.
  if (!hasAnyFilter && quickFilter !== 'open') return null;

  const handleRemoveQuick = () => updateUrl({ quickFilter: 'all', page: 1 });

  const handleRemoveFilter = (key: keyof FiltersShape, value?: string) => {
    if (key === 'hasStoryPoints' || key === 'hasEstimate') {
      const next = { ...filters, [key]: undefined };
      updateUrl({ filters: next, page: 1 });
      return;
    }
    const arr = filters[key];
    if (!Array.isArray(arr) || value === undefined) return;
    const next = { ...filters, [key]: removeFromArray(arr, value) };
    updateUrl({ filters: next, page: 1 });
  };

  const handleClearAll = () => {
    updateUrl({
      quickFilter: 'all',
      filters: {
        ...filters,
        status: [],
        assignee: [],
        reporter: [],
        type: [],
        priority: [],
        labels: [],
        storyPoints: [],
        hasStoryPoints: undefined,
        hasEstimate: undefined,
      },
      page: 1,
    });
  };

  const chips: { id: string; label: string; onRemove: () => void }[] = [];

  if (quickFilter === 'my') chips.push({ id: 'quick-my', label: 'My open issues', onRemove: handleRemoveQuick });
  if (quickFilter === 'open') chips.push({ id: 'quick-open', label: 'Open issues', onRemove: handleRemoveQuick });

  filters.status.forEach((s) =>
    chips.push({ id: `status-${s}`, label: `Status: ${s}`, onRemove: () => handleRemoveFilter('status', s) })
  );
  filters.assignee.forEach((id) =>
    chips.push({ id: `assignee-${id}`, label: `Assignee: ${userName(id)}`, onRemove: () => handleRemoveFilter('assignee', id) })
  );
  filters.reporter.forEach((id) =>
    chips.push({ id: `reporter-${id}`, label: `Reporter: ${userName(id)}`, onRemove: () => handleRemoveFilter('reporter', id) })
  );
  filters.type.forEach((t) =>
    chips.push({ id: `type-${t}`, label: `Type: ${t}`, onRemove: () => handleRemoveFilter('type', t) })
  );
  filters.priority.forEach((p) =>
    chips.push({ id: `priority-${p}`, label: `Priority: ${p}`, onRemove: () => handleRemoveFilter('priority', p) })
  );
  filters.labels.forEach((l) =>
    chips.push({ id: `label-${l}`, label: `Label: ${l}`, onRemove: () => handleRemoveFilter('labels', l) })
  );
  filters.storyPoints.forEach((sp) =>
    chips.push({ id: `sp-${sp}`, label: `Story points: ${sp}`, onRemove: () => handleRemoveFilter('storyPoints', sp) })
  );
  if (filters.hasStoryPoints === false) {
    chips.push({
      id: 'hasStoryPoints-false',
      label: 'No story points',
      onRemove: () => handleRemoveFilter('hasStoryPoints'),
    });
  }
  if (filters.hasEstimate === false) {
    chips.push({ id: 'hasEstimate-false', label: 'No estimate', onRemove: () => handleRemoveFilter('hasEstimate') });
  }
  if (filters.hasEstimate === true) {
    chips.push({ id: 'hasEstimate-true', label: 'Has estimate', onRemove: () => handleRemoveFilter('hasEstimate') });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 py-2 border-b border-[color:var(--border-subtle)]">
      <span className="text-[11px] font-semibold text-[color:var(--text-muted)] uppercase tracking-wider shrink-0">
        Active filters
      </span>
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] text-xs border border-[color:var(--border-subtle)]"
        >
          {onOpenFilterModal ? (
            <button type="button" onClick={onOpenFilterModal} className="hover:text-[color:var(--accent)] text-left">
              {chip.label}
            </button>
          ) : (
            <span>{chip.label}</span>
          )}
          <button
            type="button"
            onClick={chip.onRemove}
            className="text-[color:var(--text-muted)] hover:text-red-500 leading-none p-0.5 rounded"
            aria-label={`Remove ${chip.label}`}
          >
            ×
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={handleClearAll}
          className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] underline"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
