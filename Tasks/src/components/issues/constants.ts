export const DEFAULT_TYPES = ['Task', 'Bug', 'Story', 'Epic'];
export const DEFAULT_PRIORITIES = ['Lowest', 'Low', 'Medium', 'High', 'Highest'];
export const DEFAULT_STATUSES = ['Backlog', 'Todo', 'In Progress', 'Done'];
export const STORY_POINT_OPTIONS = ['1', '2', '3', '5', '8', '13', '21'];

export const PARAM_QUICK = 'quick';
export const PARAM_VIEW = 'view';
export const PARAM_PAGE = 'page';
export const PARAM_PROJECT = 'project';
export const PARAM_STATUS = 'status';
export const PARAM_TYPE = 'type';
export const PARAM_PRIORITY = 'priority';
export const PARAM_ASSIGNEE = 'assignee';
export const PARAM_REPORTER = 'reporter';
export const PARAM_LABELS = 'labels';
export const PARAM_STORY_POINTS = 'storyPoints';
export const PARAM_HAS_STORY_POINTS = 'hasStoryPoints';
export const PARAM_HAS_ESTIMATE = 'hasEstimate';
export const PARAM_CREATE = 'create';
export const PARAM_PARENT = 'parent';
export const PARAM_JQL = 'jql';

export type QuickFilterValue = 'all' | 'my' | 'open';
export type ViewModeValue = 'list' | 'table' | 'kanban';

export const ISSUE_TABLE_COLUMNS: { id: string; label: string; defaultVisible: boolean; width?: string }[] = [
  { id: 'project', label: 'Project', defaultVisible: false, width: 'w-28' },
  { id: 'type', label: 'Type', defaultVisible: true, width: 'w-24' },
  { id: 'ticketId', label: 'Ticket ID', defaultVisible: true, width: 'w-24' },
  { id: 'summary', label: 'Title', defaultVisible: true, width: 'min-w-[200px]' },
  { id: 'assignee', label: 'Assignee', defaultVisible: true, width: 'w-28' },
  { id: 'reporter', label: 'Reporter', defaultVisible: false, width: 'w-28' },
  { id: 'priority', label: 'Priority', defaultVisible: true, width: 'w-20' },
  { id: 'status', label: 'Status', defaultVisible: true, width: 'w-28' },
  { id: 'dueDate', label: 'Due date', defaultVisible: false, width: 'w-24' },
  { id: 'startDate', label: 'Start date', defaultVisible: false, width: 'w-24' },
  { id: 'storyPoints', label: 'Story points', defaultVisible: false, width: 'w-24' },
  { id: 'created', label: 'Created', defaultVisible: true, width: 'min-w-[100px]' },
  { id: 'updated', label: 'Updated', defaultVisible: false, width: 'min-w-[100px]' },
  { id: 'description', label: 'Description', defaultVisible: false, width: 'max-w-[200px]' },
  { id: 'labels', label: 'Labels', defaultVisible: false, width: 'max-w-[160px]' },
  { id: 'fixVersion', label: 'Fix version', defaultVisible: true, width: 'w-24' },
  { id: 'affectsVersions', label: 'Affects versions', defaultVisible: true, width: 'max-w-[140px]' },
  { id: 'actions', label: 'Actions', defaultVisible: true, width: 'w-32' },
];

export const DEFAULT_COLUMN_ORDER = ISSUE_TABLE_COLUMNS.map((c) => c.id);
export const DEFAULT_VISIBLE: Record<string, boolean> = Object.fromEntries(
  ISSUE_TABLE_COLUMNS.map((c) => [c.id, c.defaultVisible])
);

export function isDueTodayOrPast(dateString: string | undefined | null): boolean {
  if (!dateString) return false;
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  const normalize = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return normalize(d) <= normalize(today);
}

export function getDefaultColumnsConfig() {
  return { order: [...DEFAULT_COLUMN_ORDER], visible: { ...DEFAULT_VISIBLE } };
}

export type FiltersShape = {
  project: string[];
  status: string[];
  assignee: string[];
  reporter: string[];
  type: string[];
  priority: string[];
  labels: string[];
  storyPoints: string[];
  hasStoryPoints?: boolean;
  hasEstimate?: boolean;
};

export function parseFiltersFromSearchParams(searchParams: URLSearchParams): {
  filters: FiltersShape;
  quickFilter: QuickFilterValue;
  viewMode: ViewModeValue;
  page: number;
  jql: string;
} {
  const getList = (key: string) => {
    const v = searchParams.get(key);
    return v ? v.split(',').map((s) => decodeURIComponent(s.trim())).filter(Boolean) : [];
  };
  const quick = searchParams.get(PARAM_QUICK);
  const quickFilter: QuickFilterValue =
    quick === 'my' || quick === 'open' || quick === 'all' ? quick : 'my';
  const view = searchParams.get(PARAM_VIEW);
  const viewMode: ViewModeValue =
    view === 'list' || view === 'kanban' ? view : 'table';
  const pageStr = searchParams.get(PARAM_PAGE);
  const page = Math.max(1, parseInt(pageStr ?? '1', 10) || 1);
  const hasSP = searchParams.get(PARAM_HAS_STORY_POINTS);
  const hasEst = searchParams.get(PARAM_HAS_ESTIMATE);
  const jql = searchParams.get(PARAM_JQL) ?? '';
  return {
    filters: {
      project: getList(PARAM_PROJECT),
      status: getList(PARAM_STATUS),
      type: getList(PARAM_TYPE),
      priority: getList(PARAM_PRIORITY),
      assignee: getList(PARAM_ASSIGNEE),
      reporter: getList(PARAM_REPORTER),
      labels: getList(PARAM_LABELS),
      storyPoints: getList(PARAM_STORY_POINTS),
      hasStoryPoints: hasSP === 'false' ? false : hasSP === 'true' ? true : undefined,
      hasEstimate: hasEst === 'false' ? false : hasEst === 'true' ? true : undefined,
    },
    quickFilter,
    viewMode,
    page,
    jql,
  };
}

export function buildSearchParams(opts: {
  filters: FiltersShape;
  quickFilter: QuickFilterValue;
  viewMode: ViewModeValue;
  page: number;
  jql?: string;
}): URLSearchParams {
  const p = new URLSearchParams();
  if (opts.quickFilter === 'all') p.set(PARAM_QUICK, 'all');
  else if (opts.quickFilter === 'open') p.set(PARAM_QUICK, 'open');
  // 'my' is the default: omit PARAM_QUICK for cleaner URLs
  if (opts.viewMode !== 'table') p.set(PARAM_VIEW, opts.viewMode);
  if (opts.page > 1) p.set(PARAM_PAGE, String(opts.page));
  if (opts.jql && opts.jql.trim()) p.set(PARAM_JQL, opts.jql.trim());
  if (opts.filters.project?.length) p.set(PARAM_PROJECT, opts.filters.project.map((s) => encodeURIComponent(s)).join(','));
  if (opts.filters.status.length) p.set(PARAM_STATUS, opts.filters.status.map((s) => encodeURIComponent(s)).join(','));
  if (opts.filters.type.length) p.set(PARAM_TYPE, opts.filters.type.join(','));
  if (opts.filters.priority.length) p.set(PARAM_PRIORITY, opts.filters.priority.join(','));
  if (opts.filters.assignee.length) p.set(PARAM_ASSIGNEE, opts.filters.assignee.join(','));
  if (opts.filters.reporter.length) p.set(PARAM_REPORTER, opts.filters.reporter.join(','));
  if (opts.filters.labels.length) p.set(PARAM_LABELS, opts.filters.labels.map((l) => encodeURIComponent(l)).join(','));
  if (opts.filters.storyPoints.length) p.set(PARAM_STORY_POINTS, opts.filters.storyPoints.join(','));
  if (opts.filters.hasStoryPoints === false) p.set(PARAM_HAS_STORY_POINTS, 'false');
  if (opts.filters.hasStoryPoints === true) p.set(PARAM_HAS_STORY_POINTS, 'true');
  if (opts.filters.hasEstimate === false) p.set(PARAM_HAS_ESTIMATE, 'false');
  if (opts.filters.hasEstimate === true) p.set(PARAM_HAS_ESTIMATE, 'true');
  return p;
}
