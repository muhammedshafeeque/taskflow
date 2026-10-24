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
  // Scope (mine/open/all) is shown by the header tabs, so only real filters appear here.
  if (!hasAnyFilter) return null;

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
    updateUrl({ quickFilter, filters: { ...DEFAULT_FILTERS }, page: 1 });
  };

  const chips: { id: string; label: string; category: string; onRemove: () => void }[] = [];

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
    <div className="flex flex-wrap items-center gap-1.5 pb-2.5">
      <span className="mr-0.5 shrink-0 text-[11px] font-semibold text-[color:var(--text-muted)]">Filtered by</span>
      {chips.map((chip) => (
        <span
          key={chip.id}
          className="group inline-flex h-7 shrink-0 items-center rounded-full border border-[color:var(--accent)]/30 bg-[color:var(--accent-subtle)] pl-2.5 pr-1 text-[12px]"
        >
          <span className="mr-1 text-[color:var(--text-muted)]">{chip.category}:</span>
          {onOpenFilterModal ? (
            <button
              type="button"
              onClick={onOpenFilterModal}
              className="max-w-[160px] truncate font-semibold text-[color:var(--accent)] hover:underline"
              title={`Edit ${chip.category} filter`}
            >
              {chip.label}
            </button>
          ) : (
            <span className="max-w-[160px] truncate font-semibold text-[color:var(--accent)]">{chip.label}</span>
          )}
          <button
            type="button"
            onClick={chip.onRemove}
            className="ml-1 flex h-5 w-5 items-center justify-center rounded-full text-[color:var(--accent)]/70 transition hover:bg-red-500/15 hover:text-red-500"
            aria-label={`Remove ${chip.category} ${chip.label}`}
          >
            <FiX className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={handleClearAll}
        className="ml-1 text-[12px] font-medium text-[color:var(--text-muted)] underline-offset-2 transition hover:text-red-500 hover:underline"
      >
        Clear {chips.length > 1 ? 'all' : ''}
      </button>
    </div>
  );
}
