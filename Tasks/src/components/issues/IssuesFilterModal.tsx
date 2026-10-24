import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FiCheck, FiSearch, FiX } from 'react-icons/fi';
import { MetaIconGlyph, type MetaIconKey } from '../../pages/ProjectSettings';
import {
  STORY_POINT_OPTIONS,
  DEFAULT_FILTERS,
  DUE_DATE_PRESET_OPTIONS,
  UNASSIGNED_ASSIGNEE,
  SPRINT_BACKLOG,
  type FiltersShape,
  type DueDatePresetValue,
} from './constants';
import type { User, Project, Sprint, Milestone, ProjectVersion } from '../../lib/api';

type FilterDropdownKey =
  | 'status'
  | 'type'
  | 'priority'
  | 'assignee'
  | 'reporter'
  | 'labels'
  | 'storyPoints'
  | 'project'
  | 'sprint'
  | 'milestone'
  | 'fixVersion'
  | 'affectsVersions'
  | 'dueDate';

type MetaGetter = (name: string) => { icon?: string; color?: string } | undefined;

interface IssuesFilterModalProps {
  filtersOpen: boolean;
  setFiltersOpen: (v: boolean) => void;
  openFilterDropdown: FilterDropdownKey | null;
  setOpenFilterDropdown: (d: FilterDropdownKey | null) => void;
  filters: FiltersShape;
  toggleFilter: <K extends keyof FiltersShape>(key: K, value: string) => void;
  setHasStoryPointsFilter: (noStoryPoints: boolean) => void;
  statusList: string[];
  typeList: string[];
  priorityList: string[];
  users: User[];
  allLabels: string[];
  getStatusMeta: MetaGetter;
  getTypeMeta: MetaGetter;
  getPriorityMeta: MetaGetter;
  updateUrl: (updates: { filters: FiltersShape; page?: number }) => void;
  saveFilterName: string;
  setSaveFilterName: (v: string) => void;
  saveCurrentFilter: (name: string) => void;
  hasActiveFilters: boolean;
  projects?: Project[];
  sprints?: Sprint[];
  milestones?: Milestone[];
  versions?: ProjectVersion[];
}

type SectionKey =
  | 'project' | 'status' | 'type' | 'priority' | 'labels'
  | 'assignee' | 'reporter' | 'sprint' | 'milestone' | 'versions'
  | 'dates' | 'estimates' | 'hierarchy';

type Option = { value: string; label: string; meta?: { icon?: string; color?: string }; hint?: string };

/** Checkable option row with optional project-configured colour/icon. */
function OptionRow({ option, selected, onToggle }: { option: Option; selected: boolean; onToggle: () => void }) {
  const { meta } = option;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] transition ${
        selected
          ? 'bg-[color:var(--accent-subtle)] text-[color:var(--text-primary)]'
          : 'text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)]'
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
          selected
            ? 'border-[color:var(--accent)] bg-[color:var(--accent)] text-white'
            : 'border-[color:var(--border-emphasis)] group-hover:border-[color:var(--accent)]'
        }`}
      >
        {selected && <FiCheck className="h-3 w-3" strokeWidth={3} aria-hidden />}
      </span>
      {meta?.icon ? (
        <span className="shrink-0" style={meta.color ? { color: meta.color } : undefined}>
          <MetaIconGlyph icon={meta.icon as MetaIconKey} className="h-3.5 w-3.5" />
        </span>
      ) : meta?.color ? (
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: meta.color }} />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{option.label}</span>
      {option.hint && <span className="shrink-0 text-[11px] text-[color:var(--text-muted)]">{option.hint}</span>}
    </button>
  );
}

/** Searchable multi-select list used by every list-type section. */
function OptionList({
  options,
  selected,
  onToggle,
  onClear,
  emptyText,
  searchable,
}: {
  options: Option[];
  selected: string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  emptyText: string;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  if (options.length === 0) {
    return <p className="px-3 py-6 text-center text-[13px] text-[color:var(--text-muted)]">{emptyText}</p>;
  }

  return (
    <div className="space-y-2">
      {(searchable ?? options.length > 7) && (
        <label className="flex h-9 items-center gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 focus-within:border-[color:var(--accent)]">
          <FiSearch className="h-3.5 w-3.5 shrink-0 text-[color:var(--text-muted)]" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)]"
          />
        </label>
      )}
      <div className="flex items-center justify-between px-1 text-[11px] text-[color:var(--text-muted)]">
        <span>{selected.length ? `${selected.length} selected` : 'Any — pick one or more'}</span>
        {selected.length > 0 && (
          <button type="button" onClick={onClear} className="font-medium text-[color:var(--accent)] hover:underline">
            Clear
          </button>
        )}
      </div>
      <div className="space-y-0.5">
        {shown.map((o) => (
          <OptionRow key={o.value} option={o} selected={selected.includes(o.value)} onToggle={() => onToggle(o.value)} />
        ))}
        {shown.length === 0 && <p className="px-3 py-4 text-center text-[13px] text-[color:var(--text-muted)]">No matches for “{query}”.</p>}
      </div>
    </div>
  );
}

/** Any / Yes / No segmented control for optional boolean filters. */
function TriState({
  label,
  value,
  yes,
  no,
  onChange,
}: {
  label: string;
  value: boolean | undefined;
  yes: string;
  no: string;
  onChange: (v: boolean | undefined) => void;
}) {
  const opts: { v: boolean | undefined; text: string }[] = [
    { v: undefined, text: 'Any' },
    { v: true, text: yes },
    { v: false, text: no },
  ];
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-semibold text-[color:var(--text-primary)]">{label}</p>
      <div className="inline-flex rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-0.5">
        {opts.map((o) => (
          <button
            key={o.text}
            type="button"
            aria-pressed={value === o.v}
            onClick={() => onChange(o.v)}
            className={`h-7 rounded-md px-3 text-[12px] font-medium transition ${
              value === o.v
                ? 'bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] shadow-sm ring-1 ring-[color:var(--border-subtle)]'
                : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
            }`}
          >
            {o.text}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChipToggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 rounded-full border px-3 text-[12px] font-medium transition ${
        active
          ? 'border-[color:var(--accent)] bg-[color:var(--accent)] text-white'
          : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-[color:var(--text-primary)] hover:border-[color:var(--border-emphasis)]'
      }`}
    >
      {children}
    </button>
  );
}

export function IssuesFilterModal(props: IssuesFilterModalProps) {
  const {
    filtersOpen,
    setFiltersOpen,
    setOpenFilterDropdown,
    filters,
    toggleFilter,
    setHasStoryPointsFilter,
    statusList,
    typeList,
    priorityList,
    users,
    allLabels,
    getStatusMeta,
    getTypeMeta,
    getPriorityMeta,
    updateUrl,
    saveFilterName,
    setSaveFilterName,
    saveCurrentFilter,
    hasActiveFilters,
    projects = [],
    sprints = [],
    milestones = [],
    versions = [],
  } = props;

  const [section, setSection] = useState<SectionKey>(projects.length > 0 ? 'project' : 'status');

  const close = () => {
    setFiltersOpen(false);
    setOpenFilterDropdown(null);
  };

  useEffect(() => {
    if (!filtersOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFiltersOpen(false);
        setOpenFilterDropdown(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtersOpen, setFiltersOpen, setOpenFilterDropdown]);

  function patchFilters(updates: Partial<FiltersShape>) {
    updateUrl({ filters: { ...filters, ...updates }, page: 1 });
  }

  function toggleDueDatePreset(preset: DueDatePresetValue) {
    patchFilters({
      dueDatePreset: filters.dueDatePreset === preset ? undefined : preset,
      hasDueDate: undefined,
    });
  }

  if (!filtersOpen) return null;

  const assigneeSelected = [
    ...filters.assignee.filter((id) => id !== UNASSIGNED_ASSIGNEE),
    ...(filters.unassigned || filters.assignee.includes(UNASSIGNED_ASSIGNEE) ? [UNASSIGNED_ASSIGNEE] : []),
  ];
  const userOptions: Option[] = users.map((u) => ({ value: u._id, label: u.name, hint: u.email }));
  const datesCount =
    (filters.dueDatePreset ? 1 : 0) + (filters.hasDueDate === false ? 1 : 0) + (filters.hasStartDate !== undefined ? 1 : 0);
  const estimatesCount =
    filters.storyPoints.length + (filters.hasStoryPoints === false ? 1 : 0) + (filters.hasEstimate !== undefined ? 1 : 0);

  const sections: { key: SectionKey; label: string; count: number; group: string; show: boolean }[] = [
    { key: 'project', label: 'Project', count: filters.project?.length ?? 0, group: 'Scope', show: projects.length > 0 },
    { key: 'status', label: 'Status', count: filters.status.length, group: 'Issue', show: true },
    { key: 'type', label: 'Type', count: filters.type.length, group: 'Issue', show: true },
    { key: 'priority', label: 'Priority', count: filters.priority.length, group: 'Issue', show: true },
    { key: 'labels', label: 'Labels', count: filters.labels.length, group: 'Issue', show: true },
    { key: 'assignee', label: 'Assignee', count: assigneeSelected.length, group: 'People', show: true },
    { key: 'reporter', label: 'Reporter', count: filters.reporter.length, group: 'People', show: true },
    { key: 'sprint', label: 'Sprint', count: filters.sprint.length, group: 'Planning', show: sprints.length > 0 || projects.length > 0 },
    { key: 'milestone', label: 'Milestone', count: filters.milestone.length, group: 'Planning', show: milestones.length > 0 },
    { key: 'versions', label: 'Versions', count: filters.fixVersion.length + filters.affectsVersions.length, group: 'Planning', show: versions.length > 0 },
    { key: 'hierarchy', label: 'Sub-items', count: filters.hasParent !== undefined ? 1 : 0, group: 'Planning', show: true },
    { key: 'dates', label: 'Dates', count: datesCount, group: 'Time', show: true },
    { key: 'estimates', label: 'Estimates', count: estimatesCount, group: 'Time', show: true },
  ];
  const visible = sections.filter((x) => x.show);
  const active = visible.find((x) => x.key === section) ?? visible[0];
  const totalSelected = visible.reduce((n, x) => n + x.count, 0);

  let content: ReactNode;
  switch (active.key) {
    case 'project':
      content = (
        <OptionList
          options={projects.map((p) => ({ value: p._id, label: p.name, hint: p.key }))}
          selected={filters.project ?? []}
          onToggle={(v) => toggleFilter('project', v)}
          onClear={() => patchFilters({ project: [] })}
          emptyText="No projects."
        />
      );
      break;
    case 'status':
      content = (
        <OptionList
          options={statusList.map((x) => ({ value: x, label: x, meta: getStatusMeta(x) }))}
          selected={filters.status}
          onToggle={(v) => toggleFilter('status', v)}
          onClear={() => patchFilters({ status: [] })}
          emptyText="No statuses configured."
        />
      );
      break;
    case 'type':
      content = (
        <OptionList
          options={typeList.map((x) => ({ value: x, label: x, meta: getTypeMeta(x) }))}
          selected={filters.type}
          onToggle={(v) => toggleFilter('type', v)}
          onClear={() => patchFilters({ type: [] })}
          emptyText="No issue types configured."
        />
      );
      break;
    case 'priority':
      content = (
        <OptionList
          options={priorityList.map((x) => ({ value: x, label: x, meta: getPriorityMeta(x) }))}
          selected={filters.priority}
          onToggle={(v) => toggleFilter('priority', v)}
          onClear={() => patchFilters({ priority: [] })}
          emptyText="No priorities configured."
        />
      );
      break;
    case 'labels':
      content = (
        <OptionList
          options={allLabels.map((l) => ({ value: l, label: l }))}
          selected={filters.labels}
          onToggle={(v) => toggleFilter('labels', v)}
          onClear={() => patchFilters({ labels: [] })}
          emptyText="No labels on issues yet."
          searchable
        />
      );
      break;
    case 'assignee':
      content = (
        <OptionList
          options={[{ value: UNASSIGNED_ASSIGNEE, label: 'Unassigned', hint: 'No owner' }, ...userOptions]}
          selected={assigneeSelected}
          onToggle={(v) =>
            v === UNASSIGNED_ASSIGNEE
              ? patchFilters({ unassigned: !filters.unassigned ? true : undefined, assignee: filters.assignee.filter((id) => id !== UNASSIGNED_ASSIGNEE) })
              : toggleFilter('assignee', v)
          }
          onClear={() => patchFilters({ assignee: [], unassigned: undefined })}
          emptyText="No people found."
          searchable
        />
      );
      break;
    case 'reporter':
      content = (
        <OptionList
          options={userOptions}
          selected={filters.reporter}
          onToggle={(v) => toggleFilter('reporter', v)}
          onClear={() => patchFilters({ reporter: [] })}
          emptyText="No people found."
          searchable
        />
      );
      break;
    case 'sprint':
      content = (
        <OptionList
          options={[{ value: SPRINT_BACKLOG, label: 'Backlog', hint: 'Not in a sprint' }, ...sprints.map((x) => ({ value: x._id, label: x.name }))]}
          selected={filters.sprint}
          onToggle={(v) => toggleFilter('sprint', v)}
          onClear={() => patchFilters({ sprint: [] })}
          emptyText="No sprints."
        />
      );
      break;
    case 'milestone':
      content = (
        <OptionList
          options={milestones.map((m) => ({ value: m._id, label: m.name }))}
          selected={filters.milestone}
          onToggle={(v) => toggleFilter('milestone', v)}
          onClear={() => patchFilters({ milestone: [] })}
          emptyText="No milestones."
        />
      );
      break;
    case 'versions':
      content = (
        <div className="space-y-5">
          <div>
            <p className="mb-1.5 px-1 text-[12px] font-semibold text-[color:var(--text-primary)]">Fix version</p>
            <OptionList
              options={versions.map((v) => ({ value: v.id, label: v.name }))}
              selected={filters.fixVersion}
              onToggle={(v) => toggleFilter('fixVersion', v)}
              onClear={() => patchFilters({ fixVersion: [] })}
              emptyText="No versions."
              searchable={false}
            />
          </div>
          <div>
            <p className="mb-1.5 px-1 text-[12px] font-semibold text-[color:var(--text-primary)]">Affects version</p>
            <OptionList
              options={versions.map((v) => ({ value: v.id, label: v.name }))}
              selected={filters.affectsVersions}
              onToggle={(v) => toggleFilter('affectsVersions', v)}
              onClear={() => patchFilters({ affectsVersions: [] })}
              emptyText="No versions."
              searchable={false}
            />
          </div>
        </div>
      );
      break;
    case 'hierarchy':
      content = (
        <TriState label="Parent issue" value={filters.hasParent} yes="Sub-items only" no="Top-level only" onChange={(v) => patchFilters({ hasParent: v })} />
      );
      break;
    case 'dates':
      content = (
        <div className="space-y-5">
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-[color:var(--text-primary)]">Due date</p>
            <div className="flex flex-wrap gap-1.5">
              {DUE_DATE_PRESET_OPTIONS.map((opt) => (
                <ChipToggle key={opt.value} active={filters.dueDatePreset === opt.value} onClick={() => toggleDueDatePreset(opt.value)}>
                  {opt.label}
                </ChipToggle>
              ))}
              <ChipToggle
                active={filters.hasDueDate === false}
                onClick={() => patchFilters({ hasDueDate: filters.hasDueDate === false ? undefined : false, dueDatePreset: undefined })}
              >
                No due date
              </ChipToggle>
            </div>
          </div>
          <TriState
            label="Start date"
            value={filters.hasStartDate}
            yes="Has start date"
            no="No start date"
            onChange={(v) => patchFilters({ hasStartDate: v })}
          />
        </div>
      );
      break;
    case 'estimates':
      content = (
        <div className="space-y-5">
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-[color:var(--text-primary)]">Story points</p>
            <div className="flex flex-wrap gap-1.5">
              {STORY_POINT_OPTIONS.map((sp) => (
                <ChipToggle key={sp} active={filters.storyPoints.includes(sp)} onClick={() => toggleFilter('storyPoints', sp)}>
                  {sp}
                </ChipToggle>
              ))}
              <ChipToggle active={filters.hasStoryPoints === false} onClick={() => setHasStoryPointsFilter(filters.hasStoryPoints !== false)}>
                Not estimated
              </ChipToggle>
            </div>
          </div>
          <TriState
            label="Time estimate"
            value={filters.hasEstimate}
            yes="Has estimate"
            no="No estimate"
            onChange={(v) => patchFilters({ hasEstimate: v })}
          />
        </div>
      );
      break;
  }

  let lastGroup = '';

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-[2px] animate-fade-in" onClick={close}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Filter issues"
        className="flex h-full w-full max-w-[680px] flex-col border-l border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-2xl animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-[color:var(--border-subtle)] px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-[color:var(--text-primary)]">Filters</h2>
            <p className="text-[12px] text-[color:var(--text-muted)]">
              {totalSelected ? `${totalSelected} active · results update as you pick` : 'Results update as you pick'}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[color:var(--text-muted)] transition hover:bg-[color:var(--bg-page)] hover:text-[color:var(--text-primary)]"
            aria-label="Close filters"
          >
            <FiX className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {/* Category rail — tabs on mobile, sidebar on wider screens */}
          <nav
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-[color:var(--border-subtle)] p-2 sm:w-48 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r"
            aria-label="Filter categories"
          >
            {visible.map((x) => {
              const header = x.group !== lastGroup;
              lastGroup = x.group;
              return (
                <div key={x.key} className="contents">
                  {header && (
                    <p className="hidden px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)] first:pt-1 sm:block">
                      {x.group}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => setSection(x.key)}
                    aria-current={active.key === x.key}
                    className={`flex h-8 shrink-0 items-center justify-between gap-2 rounded-lg px-2.5 text-[13px] font-medium transition ${
                      active.key === x.key
                        ? 'bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] shadow-sm ring-1 ring-[color:var(--border-subtle)]'
                        : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] hover:text-[color:var(--text-primary)]'
                    }`}
                  >
                    {x.label}
                    {x.count > 0 && (
                      <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[color:var(--accent)] px-1 text-[10px] font-bold text-white">
                        {x.count}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </nav>

          <section key={active.key} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 animate-fade-in">
            <h3 className="mb-3 px-1 text-[13px] font-semibold text-[color:var(--text-primary)]">{active.label}</h3>
            {content}
          </section>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-[color:var(--border-subtle)] px-5 py-3">
          <button
            type="button"
            disabled={!hasActiveFilters}
            onClick={() => updateUrl({ filters: { ...DEFAULT_FILTERS }, page: 1 })}
            className="h-8 rounded-lg px-3 text-[12px] font-medium text-[color:var(--text-muted)] transition hover:bg-red-500/10 hover:text-red-500 disabled:pointer-events-none disabled:opacity-40"
          >
            Clear all
          </button>
          <form
            className="ml-auto flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (saveFilterName.trim()) saveCurrentFilter(saveFilterName);
            }}
          >
            <input
              type="text"
              placeholder="Name this view…"
              value={saveFilterName}
              onChange={(e) => setSaveFilterName(e.target.value)}
              className="h-8 w-40 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 text-[12px] text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-muted)] focus:border-[color:var(--accent)]"
            />
            <button
              type="submit"
              disabled={!saveFilterName.trim() || !hasActiveFilters}
              title={hasActiveFilters ? 'Save these filters as a view' : 'Pick at least one filter first'}
              className="h-8 rounded-lg border border-[color:var(--border-subtle)] px-3 text-[12px] font-medium text-[color:var(--text-primary)] transition hover:border-[color:var(--border-emphasis)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save view
            </button>
          </form>
          <button type="button" onClick={close} className="btn-primary btn-primary-sm font-semibold">
            Show results
          </button>
        </footer>
      </aside>
    </div>,
    document.body
  );
}
