import { FiX } from 'react-icons/fi';
import {
  DEFAULT_FILTERS,
  DUE_DATE_PRESET_OPTIONS,
  SPRINT_BACKLOG,
  hasAnyIssueFilters,
  type FiltersShape,
  type QuickFilterValue,
} from './constants';
import type { User, Sprint, Milestone, ProjectVersion, Project } from '../../lib/api';

export interface ActiveFilterChipsProps {
  filters: FiltersShape;
  quickFilter: QuickFilterValue;
  updateUrl: (updates: { filters?: FiltersShape; quickFilter?: QuickFilterValue; page?: number }) => void;
  users: User[];
  sprints?: Sprint[];
  milestones?: Milestone[];
  versions?: ProjectVersion[];
  projects?: Project[];
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
  sprints = [],
  milestones = [],
  versions = [],
  projects = [],
  onOpenFilterModal,
}: ActiveFilterChipsProps) {
  const userName = (id: string) => users.find((u) => u._id === id)?.name ?? id;
  const projectName = (id: string) => projects.find((p) => p._id === id)?.name ?? id;
  const sprintName = (id: string) => (id === SPRINT_BACKLOG ? 'Backlog' : sprints.find((s) => s._id === id)?.name ?? id);
  const milestoneName = (id: string) => milestones.find((m) => m._id === id)?.name ?? id;
  const versionName = (id: string) => versions.find((v) => v.id === id)?.name ?? id;
  const dueLabel = (preset: string) => DUE_DATE_PRESET_OPTIONS.find((o) => o.value === preset)?.label ?? preset;

  const hasAnyFilter = hasAnyIssueFilters(filters);
  if (!hasAnyFilter && quickFilter === 'all') return null;

  const handleRemoveQuick = () => updateUrl({ quickFilter: 'all', page: 1 });

  const handleRemoveFilter = (key: keyof FiltersShape, value?: string) => {
    if (
      key === 'hasStoryPoints' || key === 'hasEstimate' || key === 'hasParent' ||
      key === 'hasDueDate' || key === 'hasStartDate' || key === 'unassigned' || key === 'dueDatePreset'
    ) {
      updateUrl({ filters: { ...filters, [key]: undefined }, page: 1 });
      return;
    }
    const arr = filters[key];
    if (!Array.isArray(arr) || value === undefined) return;
    updateUrl({ filters: { ...filters, [key]: removeFromArray(arr, value) }, page: 1 });
  };

  const handleClearAll = () => {
    updateUrl({ quickFilter: 'all', filters: { ...DEFAULT_FILTERS }, page: 1 });
  };

  const chips: { id: string; label: string; category: string; onRemove: () => void }[] = [];

  if (quickFilter === 'my') chips.push({ id: 'quick-my', label: 'My open issues', category: 'view', onRemove: handleRemoveQuick });
  if (quickFilter === 'open') chips.push({ id: 'quick-open', label: 'Open issues', category: 'view', onRemove: handleRemoveQuick });

  filters.project?.forEach((id) =>
    chips.push({ id: `project-${id}`, label: `${projectName(id)}`, category: 'Project', onRemove: () => handleRemoveFilter('project', id) })
  );
  filters.status.forEach((s) =>
    chips.push({ id: `status-${s}`, label: s, category: 'Status', onRemove: () => handleRemoveFilter('status', s) })
  );
  filters.assignee.forEach((id) =>
    chips.push({ id: `assignee-${id}`, label: userName(id), category: 'Assignee', onRemove: () => handleRemoveFilter('assignee', id) })
  );
  if (filters.unassigned) {
    chips.push({ id: 'unassigned', label: 'Unassigned', category: 'Assignee', onRemove: () => handleRemoveFilter('unassigned') });
  }
  filters.reporter.forEach((id) =>
    chips.push({ id: `reporter-${id}`, label: userName(id), category: 'Reporter', onRemove: () => handleRemoveFilter('reporter', id) })
  );
  filters.type.forEach((t) =>
    chips.push({ id: `type-${t}`, label: t, category: 'Type', onRemove: () => handleRemoveFilter('type', t) })
  );
  filters.priority.forEach((p) =>
    chips.push({ id: `priority-${p}`, label: p, category: 'Priority', onRemove: () => handleRemoveFilter('priority', p) })
  );
  filters.labels.forEach((l) =>
    chips.push({ id: `label-${l}`, label: l, category: 'Label', onRemove: () => handleRemoveFilter('labels', l) })
  );
  filters.sprint.forEach((id) =>
    chips.push({ id: `sprint-${id}`, label: sprintName(id), category: 'Sprint', onRemove: () => handleRemoveFilter('sprint', id) })
  );
  filters.milestone.forEach((id) =>
    chips.push({ id: `milestone-${id}`, label: milestoneName(id), category: 'Milestone', onRemove: () => handleRemoveFilter('milestone', id) })
  );
  filters.fixVersion.forEach((id) =>
    chips.push({ id: `fix-${id}`, label: versionName(id), category: 'Fix ver.', onRemove: () => handleRemoveFilter('fixVersion', id) })
  );
  filters.affectsVersions.forEach((id) =>
    chips.push({ id: `affects-${id}`, label: versionName(id), category: 'Affects', onRemove: () => handleRemoveFilter('affectsVersions', id) })
  );
  if (filters.hasParent === true)
    chips.push({ id: 'hasParent-true', label: 'Has parent', category: 'Subtask', onRemove: () => handleRemoveFilter('hasParent') });
  if (filters.hasParent === false)
    chips.push({ id: 'hasParent-false', label: 'No parent', category: 'Subtask', onRemove: () => handleRemoveFilter('hasParent') });
  if (filters.hasDueDate === false)
    chips.push({ id: 'hasDueDate-false', label: 'No due date', category: 'Due', onRemove: () => handleRemoveFilter('hasDueDate') });
  if (filters.dueDatePreset)
    chips.push({ id: `due-${filters.dueDatePreset}`, label: dueLabel(filters.dueDatePreset), category: 'Due', onRemove: () => handleRemoveFilter('dueDatePreset') });
  if (filters.hasStartDate === false)
    chips.push({ id: 'hasStartDate-false', label: 'No start date', category: 'Start', onRemove: () => handleRemoveFilter('hasStartDate') });
  if (filters.hasStartDate === true)
    chips.push({ id: 'hasStartDate-true', label: 'Has start date', category: 'Start', onRemove: () => handleRemoveFilter('hasStartDate') });
  filters.storyPoints.forEach((sp) =>
    chips.push({ id: `sp-${sp}`, label: sp, category: 'SP', onRemove: () => handleRemoveFilter('storyPoints', sp) })
  );
  if (filters.hasStoryPoints === false)
    chips.push({ id: 'hasStoryPoints-false', label: 'No story points', category: 'SP', onRemove: () => handleRemoveFilter('hasStoryPoints') });
  if (filters.hasEstimate === false)
    chips.push({ id: 'hasEstimate-false', label: 'No estimate', category: 'Est.', onRemove: () => handleRemoveFilter('hasEstimate') });
  if (filters.hasEstimate === true)
    chips.push({ id: 'hasEstimate-true', label: 'Has estimate', category: 'Est.', onRemove: () => handleRemoveFilter('hasEstimate') });

  return (
    <div className="flex flex-wrap items-center gap-1.5 py-2 border-b border-[color:var(--border-subtle)]">
      <span className="text-[10px] font-semibold text-[color:var(--text-muted)] uppercase tracking-wider shrink-0 mr-0.5">
        Filters
      </span>
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="group inline-flex items-center gap-0.5 rounded-lg overflow-hidden border border-[color:var(--accent)]/25 bg-[color:var(--accent-subtle)] text-xs shrink-0"
        >
          {chip.category !== 'view' && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold text-[color:var(--accent)]/70 bg-[color:var(--accent)]/10 border-r border-[color:var(--accent)]/20 uppercase tracking-wide">
              {chip.category}
            </span>
          )}
          {onOpenFilterModal ? (
            <button
              type="button"
              onClick={onOpenFilterModal}
              className="px-2 py-0.5 text-[color:var(--accent)] font-medium hover:text-[color:var(--accent-muted)]"
            >
              {chip.label}
            </button>
          ) : (
            <span className="px-2 py-0.5 text-[color:var(--accent)] font-medium">{chip.label}</span>
          )}
          <button
            type="button"
            onClick={chip.onRemove}
            className="px-1 py-0.5 text-[color:var(--accent)]/60 hover:text-red-500 hover:bg-red-500/10 transition rounded-r-lg"
            aria-label={`Remove ${chip.label}`}
          >
            <FiX className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={handleClearAll}
          className="text-[11px] text-[color:var(--text-muted)] font-medium hover:text-red-500 transition underline-offset-2 hover:underline ml-1"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
