import {
  FiBookmark,
  FiCode,
  FiDownload,
  FiFilter,
  FiGrid,
  FiLayout,
  FiList,
  FiPlus,
  FiSliders,
} from 'react-icons/fi';
import { issuesApi } from '../../lib/api';
import type { ViewModeValue } from './constants';

const icon = 'h-3.5 w-3.5 shrink-0';

type FilterDropdownKey =
  | 'status' | 'type' | 'priority' | 'assignee' | 'reporter'
  | 'labels' | 'storyPoints' | 'project';

interface IssuesToolbarProps {
  viewMode: ViewModeValue;
  updateUrl: (updates: { viewMode?: ViewModeValue }) => void;
  hasActiveFilters: boolean;
  activeFilterCount: number;
  useJql: boolean;
  setFiltersOpen: (open: boolean) => void;
  setColumnsOpen: (open: boolean) => void;
  setJqlOpen: (fn: (o: boolean) => boolean) => void;
  setOpenFilterDropdown: (d: FilterDropdownKey | null) => void;
  buildListParams: (params: { page: number }) => Record<string, unknown>;
  openCreate?: () => void;
  projectId: string | undefined;
  token: string | null;
  jql: string;
  canSaveFilter: boolean;
  onSaveFilterClick: () => void;
  showTitle?: boolean;
}

export function IssuesToolbar({
  viewMode,
  updateUrl,
  hasActiveFilters,
  activeFilterCount,
  useJql,
  setFiltersOpen,
  setColumnsOpen,
  setJqlOpen,
  setOpenFilterDropdown,
  buildListParams,
  openCreate,
  projectId,
  token,
  jql,
  canSaveFilter,
  onSaveFilterClick,
  showTitle = true,
}: IssuesToolbarProps) {
  const viewModes: { key: ViewModeValue; label: string; Icon: typeof FiLayout }[] = [
    { key: 'table', label: 'Table', Icon: FiLayout },
    { key: 'list',  label: 'List',  Icon: FiList },
    { key: 'kanban', label: 'Kanban', Icon: FiGrid },
  ];

  const runExport = async () => {
    if (!token) return;
    const params: Record<string, string> = {};
    if (projectId) params.project = projectId;
    if (useJql && jql.trim()) {
      params.jql = jql.trim();
    } else {
      const lp = buildListParams({ page: 1 }) as Record<string, string | number | undefined>;
      if (lp.project) params.project = String(lp.project);
      if (lp.status) params.status = String(lp.status);
      if (lp.assignee) params.assignee = String(lp.assignee);
      if (lp.reporter) params.reporter = String(lp.reporter);
      if (lp.type) params.type = String(lp.type);
      if (lp.priority) params.priority = String(lp.priority);
      if (lp.labels) params.labels = String(lp.labels);
      if (lp.storyPoints) params.storyPoints = String(lp.storyPoints);
      if (lp.hasStoryPoints) params.hasStoryPoints = String(lp.hasStoryPoints);
    }
    const res = await issuesApi.downloadExcel(params, token);
    if (!res.success) alert(res.message ?? 'Export failed');
  };

  const ghost =
    'inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-[color:var(--text-muted)] transition hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';
  const activeGhost = 'bg-[color:var(--accent-subtle)] text-[color:var(--accent)] hover:bg-[color:var(--accent-subtle)] hover:text-[color:var(--accent)]';

  return (
    <div className="flex flex-wrap items-center gap-1.5 py-2">
      {showTitle && (
        <h1 className="mr-2 shrink-0 text-xl font-bold text-[color:var(--text-primary)]">Issues</h1>
      )}

      <button
        type="button"
        onClick={() => { setFiltersOpen(true); setOpenFilterDropdown(null); }}
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-semibold transition ${
          hasActiveFilters
            ? 'border-[color:var(--accent)]/45 bg-[color:var(--accent-subtle)] text-[color:var(--accent)]'
            : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-[color:var(--text-primary)] hover:border-[color:var(--border-emphasis)]'
        }`}
        title="Filter by status, assignee, priority, sprint…"
      >
        <FiFilter className={icon} aria-hidden />
        Filter
        {activeFilterCount > 0 && (
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[color:var(--accent)] px-1 text-[10px] font-bold leading-none text-white">
            {activeFilterCount}
          </span>
        )}
      </button>

      {viewMode === 'table' && (
        <button
          type="button"
          onClick={() => { setColumnsOpen(true); setOpenFilterDropdown(null); }}
          className={ghost}
          title="Choose and reorder columns"
        >
          <FiSliders className={icon} aria-hidden />
          Columns
        </button>
      )}

      <button
        type="button"
        onClick={onSaveFilterClick}
        disabled={!canSaveFilter}
        title={canSaveFilter ? 'Save current filters as a named view' : 'Apply a filter first, then save it as a view'}
        className={ghost}
      >
        <FiBookmark className={icon} aria-hidden />
        Save view
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setJqlOpen((o) => !o)}
          className={`${ghost} ${useJql ? activeGhost : ''}`}
          title='Query with JQL — e.g. status = Done AND assignee = me order by created DESC'
        >
          <FiCode className={icon} aria-hidden />
          <span className="hidden sm:inline">JQL</span>
          {useJql && <span className="rounded bg-[color:var(--accent)] px-1 py-px text-[9px] font-bold leading-none text-white">ON</span>}
        </button>

        <button type="button" onClick={runExport} className={ghost} title="Download the current view as Excel">
          <FiDownload className={icon} aria-hidden />
          <span className="hidden sm:inline">Export</span>
        </button>

        <span className="mx-1 hidden h-5 w-px bg-[color:var(--border-subtle)] sm:block" aria-hidden />

        <div
          className="flex items-center gap-0.5 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-0.5"
          role="group"
          aria-label="View mode"
        >
          {viewModes.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => updateUrl({ viewMode: key })}
              title={`${label} view`}
              aria-pressed={viewMode === key}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition ${
                viewMode === key
                  ? 'bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] shadow-sm ring-1 ring-[color:var(--border-subtle)]'
                  : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
              }`}
            >
              <Icon className={icon} aria-hidden />
              <span className="hidden md:inline">{label}</span>
            </button>
          ))}
        </div>

        {openCreate && (
          <button
            type="button"
            onClick={() => openCreate()}
            className="btn-primary btn-primary-sm ml-1 inline-flex items-center gap-1.5 font-semibold shadow-md"
          >
            <FiPlus className={icon} aria-hidden />
            New issue
          </button>
        )}
      </div>
    </div>
  );
}
