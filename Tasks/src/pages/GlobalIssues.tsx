import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationsContext';
import {
  issuesApi,
  usersApi,
  projectsApi,
  sprintsApi,
  milestonesApi,
  uploadFile,
  attachmentsApi,
  type Issue,
  type User,
  type Project,
  type Sprint,
  type Milestone,
  type ProjectVersion,
  getIssueKey,
} from '../lib/api';
import ConfirmModal from '../components/ConfirmModal';
import { normalizeFixVersionIds } from '../lib/issueVersions';
import {
  parseFiltersFromSearchParams,
  buildSearchParams,
  parseIssuesColumnsConfig,
  ISSUE_TABLE_COLUMNS,
  DEFAULT_STATUSES,
  DEFAULT_TYPES,
  DEFAULT_PRIORITIES,
  applyFiltersToListParams,
  countActiveFilters,
  hasAnyIssueFilters,
  resolveIssueParentId,
  filterParentCandidates,
  type QuickFilterValue,
  type ViewModeValue,
} from '../components/issues';
import {
  QuickFiltersBar,
  QuickFilterLabelFilters,
  ActiveFilterChips,
  IssuesToolbar,
  JqlSearchPanel,
  BulkEditBar,
  IssuesTableView,
  IssuesKanbanView,
  IssuesListView,
  IssuesPagination,
  IssuesFilterModal,
  ColumnsConfigModal,
  IssueCreateEditModal,
  BulkEditModal,
  buildBulkUpdates,
  type BulkFormState,
} from '../components/issues';

const GLOBAL_COLUMNS_VISIBLE: Record<string, boolean> = {
  ...Object.fromEntries(ISSUE_TABLE_COLUMNS.map((c) => [c.id, c.id === 'project' ? true : c.defaultVisible])),
};

function getGlobalColumnsConfig() {
  return parseIssuesColumnsConfig(null, GLOBAL_COLUMNS_VISIBLE);
}

export default function GlobalIssues() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { filters, quickFilter, viewMode, page, jql } = parseFiltersFromSearchParams(searchParams);

  const updateUrl = (updates: Partial<{
    filters: typeof filters;
    quickFilter: QuickFilterValue;
    viewMode: ViewModeValue;
    page: number;
    jql?: string;
  }>) => {
    const next = {
      filters: updates.filters ?? filters,
      quickFilter: updates.quickFilter ?? quickFilter,
      viewMode: updates.viewMode ?? viewMode,
      page: updates.page ?? page,
      jql: updates.jql !== undefined ? updates.jql : jql,
    };
    const nextParams = buildSearchParams(next);
    setSearchParams(nextParams, { replace: true });
  };

  const { token, user } = useAuth();
  const { showToast } = useNotifications();
  const [projects, setProjects] = useState<Project[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [total, setTotal] = useState(0);
  const [totalCounts, setTotalCounts] = useState<{
    my: number;
    open: number;
    all: number;
    myOpenLabels: Array<{ label: string; count: number }>;
    openLabels: Array<{ label: string; count: number }>;
    allLabels: Array<{ label: string; count: number }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [modalUsers, setModalUsers] = useState<User[]>([]);
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [editIssue, setEditIssue] = useState<Issue | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    type: 'Task',
    priority: 'Medium',
    status: 'Backlog',
    project: '',
    assignee: '',
    sprint: '',
    storyPoints: '',
    parent: '',
    milestone: '',
    customFieldValues: {} as Record<string, unknown>,
    fixVersion: [] as string[],
    affectsVersions: [] as string[],
    labels: [] as string[],
  });
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState('');
  const [openFilterDropdown, setOpenFilterDropdown] = useState<
    'status' | 'type' | 'priority' | 'assignee' | 'reporter' | 'labels' | 'storyPoints' | 'project' | 'sprint' | 'milestone' | 'fixVersion' | 'affectsVersions' | 'dueDate' | null
  >(null);
  const [confirmDeleteIssue, setConfirmDeleteIssue] = useState<Issue | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columnDragId, setColumnDragId] = useState<string | null>(null);
  const [columnDropIndex, setColumnDropIndex] = useState<number | null>(null);
  const [kanbanUpdatingId, setKanbanUpdatingId] = useState<string | null>(null);
  const [kanbanError, setKanbanError] = useState<string | null>(null);
  const [parentCandidates, setParentCandidates] = useState<Issue[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [bulkModal, setBulkModal] = useState<'edit' | null>(null);
  const [bulkForm, setBulkForm] = useState<BulkFormState>({});
  const [bulkSprints, setBulkSprints] = useState<Sprint[]>([]);
  const [bulkMilestones, setBulkMilestones] = useState<Milestone[]>([]);
  const [bulkParentCandidates, setBulkParentCandidates] = useState<Issue[]>([]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [jqlOpen, setJqlOpen] = useState(false);
  const [jqlInput, setJqlInput] = useState('');
  const [jqlError, setJqlError] = useState<string | null>(null);
  const [jqlHelpOpen, setJqlHelpOpen] = useState(false);
  const [watchingStatus, setWatchingStatus] = useState<Record<string, boolean>>({});
  const [watchingLoadingId, setWatchingLoadingId] = useState<string | null>(null);

  const COLUMNS_CONFIG_KEY = 'taskflow-issues-columns-global';
  const [columnsConfig, setColumnsConfig] = useState(() => {
    try {
      const raw = localStorage.getItem(COLUMNS_CONFIG_KEY);
      if (raw) {
        return parseIssuesColumnsConfig(JSON.parse(raw) as Parameters<typeof parseIssuesColumnsConfig>[0], GLOBAL_COLUMNS_VISIBLE);
      }
    } catch {}
    return getGlobalColumnsConfig();
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLUMNS_CONFIG_KEY, JSON.stringify(columnsConfig));
    } catch {}
  }, [columnsConfig]);

  const visibleColumnIds = columnsConfig.order.filter((id) => columnsConfig.visible[id]);
  const toggleColumn = (id: string) => {
    setColumnsConfig((prev) => ({
      ...prev,
      visible: { ...prev.visible, [id]: !prev.visible[id] },
    }));
  };
  const moveColumnAt = (dragIndex: number, dropIndex: number) => {
    if (dragIndex === dropIndex) return;
    const newOrder = [...columnsConfig.order];
    const [removed] = newOrder.splice(dragIndex, 1);
    newOrder.splice(dropIndex, 0, removed);
    setColumnsConfig((prev) => ({ ...prev, order: newOrder }));
  };
  const resetColumns = () => setColumnsConfig(getGlobalColumnsConfig());

  const setColumnWidth = (colId: string, width: number) => {
    setColumnsConfig((prev) => ({
      ...prev,
      widths: { ...prev.widths, [colId]: width },
    }));
  };

  const statusList = useMemo(() => {
    const fromProjects = [...new Set(projects.flatMap((p) => (p.statuses ?? []).map((s) => s.name)))];
    return fromProjects.length ? fromProjects : DEFAULT_STATUSES;
  }, [projects]);
  const typeList = useMemo(() => {
    const fromProjects = [...new Set(projects.flatMap((p) => (p.issueTypes ?? []).map((t) => t.name)))];
    return fromProjects.length ? fromProjects : DEFAULT_TYPES;
  }, [projects]);
  const priorityList = useMemo(() => {
    const fromProjects = [...new Set(projects.flatMap((p) => (p.priorities ?? []).map((p) => p.name)))];
    return fromProjects.length ? fromProjects : DEFAULT_PRIORITIES;
  }, [projects]);
  const getPriorityMeta = (name: string) => projects.flatMap((p) => p.priorities ?? []).find((p) => p.name === name);
  const getTypeMeta = (name: string) => projects.flatMap((p) => p.issueTypes ?? []).find((t) => t.name === name);
  const getStatusMeta = (name: string) => projects.flatMap((p) => p.statuses ?? []).find((s) => s.name === name);

  const hasActiveFilters = hasAnyIssueFilters(filters);
  const activeFilterCount = countActiveFilters(filters);
  const versions = useMemo(() => {
    const scope = filters.project.length
      ? projects.filter((p) => filters.project.includes(p._id))
      : projects;
    const byId = new Map<string, ProjectVersion>();
    scope.forEach((p) => (p.versions ?? []).forEach((v) => byId.set(v.id, v)));
    return Array.from(byId.values());
  }, [projects, filters.project]);
  const allLabels = useMemo(() => [...new Set(issues.flatMap((i) => i.labels || []))].sort(), [issues]);
  const limit = 25;

  const LEGACY_CLOSED_STATUSES = ['Done', 'Closed', 'Resolved'];

  function isClosedStatus(status: { name: string; isClosed?: boolean }): boolean {
    if (status.isClosed !== undefined) return Boolean(status.isClosed);
    const l = (status.name ?? '').trim().toLowerCase();
    return l === 'done' || l === 'closed' || l === 'clossed' || l === 'resolved' || l.includes('completed');
  }

  const useJql = Boolean(jql.trim());

  const quickFilterLabelCounts = useMemo(() => {
    if (!totalCounts) return [];
    if (quickFilter === 'my') return totalCounts.myOpenLabels;
    if (quickFilter === 'open') return totalCounts.openLabels;
    return totalCounts.allLabels;
  }, [totalCounts, quickFilter]);

  function buildListParams(p: { page: number }): Record<string, string | number> & { token: string } {
    if (useJql) {
      return { token: token!, page: p.page, limit: viewMode === 'kanban' ? 200 : 20, jql };
    }
    const params: Record<string, string | number> & { token: string } = {
      ...p,
      limit: viewMode === 'kanban' ? 100 : limit,
      token: token!,
    };
    if (filters.project.length) params.project = filters.project.join(',');
    if ((quickFilter === 'open' || quickFilter === 'my') && !filters.status.length) {
      const closedStatusSet = new Set<string>();
      const scope = filters.project.length
        ? projects.filter((p) => filters.project.includes(p._id))
        : projects;
      scope.forEach((project) => {
        (project.statuses ?? []).forEach((status) => {
          if (isClosedStatus(status)) closedStatusSet.add(status.name);
        });
      });
      let closedStatuses = closedStatusSet.size > 0
        ? Array.from(closedStatusSet)
        : statusList.filter((s) => isClosedStatus({ name: String(s) }));
      if (closedStatuses.length === 0) closedStatuses = [...LEGACY_CLOSED_STATUSES];
      params.statusExclude = closedStatuses.join(',');
    }
    applyFiltersToListParams(params, filters);
    if (quickFilter === 'my' && user?.id) params.assignee = user.id;
    return params;
  }

  function toggleFilter<K extends keyof typeof filters>(key: K, value: string) {
    const arr = filters[key];
    if (!Array.isArray(arr)) return;
    const next = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
    updateUrl({ filters: { ...filters, [key]: next }, page: 1 });
  }

  function setHasStoryPointsFilter(noStoryPoints: boolean) {
    updateUrl({ filters: { ...filters, hasStoryPoints: noStoryPoints ? false : undefined }, page: 1 });
  }

  useEffect(() => {
    if (!token) return;
    projectsApi.list(1, 200, token).then((res) => {
      if (res.success && res.data) setProjects(res.data.data ?? []);
    });
  }, [token]);

  const filterScopeProjectId = filters.project.length === 1 ? filters.project[0] : null;

  const bulkScopeProjectId = useMemo(() => {
    if (filterScopeProjectId) return filterScopeProjectId;
    const selected = issues.filter((i) => selectedIssueIds.has(i._id));
    if (selected.length === 0) return null;
    const projectIds = new Set(
      selected.map((i) =>
        i.project && typeof i.project === 'object' && '_id' in i.project
          ? String((i.project as { _id: string })._id)
          : String(i.project ?? '')
      )
    );
    return projectIds.size === 1 ? [...projectIds][0] : null;
  }, [filterScopeProjectId, issues, selectedIssueIds]);

  const bulkScopeProject = useMemo(
    () => (bulkScopeProjectId ? projects.find((p) => p._id === bulkScopeProjectId) ?? null : null),
    [projects, bulkScopeProjectId]
  );

  useEffect(() => {
    if (!token || !filterScopeProjectId) {
      setSprints([]);
      setMilestones([]);
      return;
    }
    sprintsApi.list(1, 100, filterScopeProjectId, undefined, token).then((res) => {
      if (res.success && res.data) setSprints(res.data.data ?? []);
    });
    milestonesApi.list(filterScopeProjectId, token).then((res) => {
      if (res.success && res.data) setMilestones(Array.isArray(res.data) ? res.data : []);
    });
  }, [token, filterScopeProjectId]);

  useEffect(() => {
    if (!token || !bulkScopeProjectId || bulkModal !== 'edit') {
      setBulkSprints([]);
      setBulkMilestones([]);
      setBulkParentCandidates([]);
      return;
    }
    sprintsApi.list(1, 100, bulkScopeProjectId, undefined, token).then((res) => {
      if (res.success && res.data) setBulkSprints(res.data.data ?? []);
    });
    milestonesApi.list(bulkScopeProjectId, token).then((res) => {
      if (res.success && res.data) setBulkMilestones(Array.isArray(res.data) ? res.data : []);
    });
    issuesApi
      .list({ token, project: bulkScopeProjectId, page: 1, limit: 200 })
      .then((res) => {
        if (res.success && res.data) {
          const list = (res.data.data ?? []).filter((i) => !selectedIssueIds.has(i._id));
          setBulkParentCandidates(list);
        }
      });
  }, [token, bulkScopeProjectId, bulkModal, selectedIssueIds]);

  useEffect(() => {
    if (!token) return;
    usersApi.list(1, 100, token).then((res) => {
      if (res.success && res.data) setUsers(res.data.data ?? []);
    });
  }, [token]);

  useEffect(() => {
    setJqlInput(jql);
  }, [jql]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setJqlError(null);
    const params = buildListParams({ page: viewMode === 'kanban' ? 1 : page });
    (useJql
      ? issuesApi.searchJql((params as unknown as { jql: string }).jql, params.page as number, params.limit as number, token)
      : issuesApi.list(params)
    ).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setIssues(res.data.data ?? []);
        setTotal(res.data.total ?? 0);
        setJqlError(null);
      } else if (useJql && !res.success) {
        setJqlError(res.message ?? 'JQL query failed');
      }
    });

    issuesApi.getQuickFilterCounts(token).then((res) => {
      if (res.success && res.data) setTotalCounts(res.data);
    });
  }, [token, searchParams.toString()]);

  useEffect(() => {
    if (!token || issues.length === 0) return;
    const ids = issues.map((i) => i._id);
    issuesApi.getWatchingStatusBatch(ids, token).then((res) => {
      if (res.success && res.data) setWatchingStatus(res.data);
    });
  }, [token, issues.map((i) => i._id).join(',')]);

  useEffect(() => {
    if (form.project && token) {
      projectsApi.get(form.project, token).then((res) => {
        if (res.success && res.data) setSelectedProject(res.data);
      });
    } else {
      setSelectedProject(null);
    }
  }, [form.project, token]);

  useEffect(() => {
    if (!token || !form.project) {
      setModalUsers([]);
      return;
    }
    projectsApi.getMembers(form.project, token).then((res) => {
      if (res.success && res.data) {
        const members = Array.isArray(res.data) ? res.data : [];
        const flattened = members.map((m) => ({
          _id: m.user._id,
          name: m.user.name,
          email: m.user.email,
        }));
        setModalUsers(flattened as unknown as User[]);
      } else {
        setModalUsers([]);
      }
    });
  }, [form.project, token]);

  useEffect(() => {
    if (form.project && token) {
      issuesApi
        .list({
          token,
          project: form.project,
          page: 1,
          limit: 200,
        })
        .then((res) => {
          if (res.success && res.data) {
            setParentCandidates(
              filterParentCandidates(
                res.data.data ?? [],
                editIssue?._id,
                resolveIssueParentId(editIssue?.parent)
              )
            );
          }
        });
    } else {
      setParentCandidates([]);
    }
  }, [form.project, token, editIssue?._id, modal]);

  useEffect(() => {
    if (form.project && token) {
      sprintsApi.list(1, 100, form.project, undefined, token).then((res) => {
        if (res.success && res.data) setSprints(res.data.data ?? []);
      });
      milestonesApi.list(form.project, token).then((res) => {
        if (res.success && res.data) setMilestones(Array.isArray(res.data) ? res.data : []);
      });
    } else {
      setSprints([]);
      setMilestones([]);
    }
  }, [form.project, token]);

  async function handleToggleWatch(issueId: string) {
    if (!token) return;
    setWatchingLoadingId(issueId);
    const currentlyWatching = watchingStatus[issueId] ?? false;
    const res = currentlyWatching
      ? await issuesApi.unwatch(issueId, token)
      : await issuesApi.watch(issueId, token);
    setWatchingLoadingId(null);
    if (res.success) {
      setWatchingStatus((prev) => ({ ...prev, [issueId]: !currentlyWatching }));
    }
  }

  function openCreate(initialParent?: string) {
    setForm({
      title: '',
      description: '',
      type: typeList[0] ?? 'Task',
      priority: priorityList[Math.min(2, priorityList.length - 1)] ?? 'Medium',
      status: statusList[0] ?? 'Backlog',
      project: projects[0]?._id ?? '',
      assignee: '',
      sprint: '',
      storyPoints: '',
      parent: initialParent ?? '',
      milestone: '',
      customFieldValues: {},
      fixVersion: [] as string[],
      affectsVersions: [],
      labels: [],
    });
    setEditIssue(null);
    setSubmitError('');
    setPendingFiles([]);
    setModal('create');
  }

  function openEdit(issue: Issue) {
    setEditIssue(issue);
    const projId = typeof issue.project === 'object' && issue.project ? issue.project._id : '';
    setForm({
      title: issue.title,
      description: issue.description ?? '',
      type: issue.type,
      priority: issue.priority,
      status: issue.status,
      project: projId,
      assignee: typeof issue.assignee === 'object' && issue.assignee ? issue.assignee._id : '',
      sprint: typeof issue.sprint === 'object' && issue.sprint ? issue.sprint._id : '',
      storyPoints: issue.storyPoints != null ? String(issue.storyPoints) : '',
      parent: resolveIssueParentId(issue.parent),
      milestone: typeof issue.milestone === 'object' && issue.milestone ? issue.milestone._id : '',
      customFieldValues: { ...(issue.customFieldValues ?? {}) },
      fixVersion: normalizeFixVersionIds(issue.fixVersion),
      affectsVersions: issue.affectsVersions ?? [],
      labels: issue.labels ?? [],
    });
    setSubmitError('');
    setModal('edit');
  }

  async function handleDelete(issue: Issue) {
    if (!token) return;
    const res = await issuesApi.delete(issue._id, token);
    if (res.success) {
      setIssues((prev) => prev.filter((i) => i._id !== issue._id));
      setTotal((t) => Math.max(0, t - 1));
      setConfirmDeleteIssue(null);
    }
  }

  function toggleSelectIssue(id: string) {
    setSelectedIssueIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIssueIds.size === issues.length) setSelectedIssueIds(new Set());
    else setSelectedIssueIds(new Set(issues.map((i) => i._id)));
  }

  async function handleBulkUpdate() {
    if (!token || selectedIssueIds.size === 0) return;
    const updates = buildBulkUpdates(bulkForm);
    if (!updates) return;
    setBulkSubmitting(true);
    const res = await issuesApi.bulkUpdate(Array.from(selectedIssueIds), updates, token);
    setBulkSubmitting(false);
    if (res.success && res.data) {
      setBulkModal(null);
      setBulkForm({});
      setSelectedIssueIds(new Set());
      issuesApi.list(buildListParams({ page })).then((r) => {
        if (r.success && r.data) {
          setIssues(r.data.data ?? []);
          setTotal(r.data.total ?? 0);
        }
      });
    } else {
      setSubmitError((res as { message?: string }).message ?? 'Bulk update failed');
    }
  }

  async function handleBulkDelete() {
    if (!token || selectedIssueIds.size === 0) return;
    setBulkSubmitting(true);
    const res = await issuesApi.bulkDelete(Array.from(selectedIssueIds), token);
    setBulkSubmitting(false);
    if (res.success && res.data) {
      setConfirmBulkDelete(false);
      setSelectedIssueIds(new Set());
      issuesApi.list(buildListParams({ page })).then((r) => {
        if (r.success && r.data) {
          setIssues(r.data.data ?? []);
          setTotal(r.data.total ?? 0);
        }
      });
    } else {
      setSubmitError((res as { message?: string }).message ?? 'Bulk delete failed');
    }
  }

  const kanbanSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  async function handleKanbanDragEnd(ev: DragEndEvent) {
    const { active, over } = ev;
    setKanbanError(null);
    if (!over || !token || active.id === over.id) return;
    const issueId = String(active.id);
    const targetStatus = String(over.id);
    const issue = issues.find((i) => i._id === issueId);
    if (!issue || issue.status === targetStatus) return;
    setKanbanUpdatingId(issueId);
    const res = await issuesApi.update(issueId, { status: targetStatus }, token);
    setKanbanUpdatingId(null);
    if (res.success && res.data) {
      setIssues((prev) =>
        prev.map((i) => (i._id === issueId ? { ...i, status: targetStatus } : i))
      );
    } else {
      setKanbanError(res.message || 'Failed to update status');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setSubmitError('');
    if (modal === 'create') {
      const res = await issuesApi.create(
        {
          title: form.title,
          description: form.description,
          type: form.type,
          priority: form.priority,
          status: form.status,
          project: form.project,
          assignee: form.assignee || undefined,
          sprint: form.sprint || null,
          storyPoints: form.storyPoints === '' ? null : Number(form.storyPoints),
          parent: form.parent || undefined,
          milestone: form.milestone || undefined,
          customFieldValues: Object.keys(form.customFieldValues).length ? form.customFieldValues : undefined,
          fixVersion: form.fixVersion.length ? form.fixVersion : undefined,
          affectsVersions: form.affectsVersions.length ? form.affectsVersions : undefined,
          labels: form.labels.length ? form.labels : undefined,
        },
        token
      );
      if (res.success && res.data) {
        const issueId = res.data._id;
        if (pendingFiles.length > 0) {
          await Promise.all(
            pendingFiles.map(async (file) => {
              const up = await uploadFile(file, token);
              if (up.success && up.data) {
                await attachmentsApi.add(issueId, { url: up.data.url, originalName: up.data.originalName, mimeType: up.data.mimeType, size: up.data.size }, token);
              }
            })
          );
          setPendingFiles([]);
        }
        setModal(null);
        showToast({
          title: `Issue Created : ${getIssueKey(res.data)}`,
          body: 'click to view',
          url: `/projects/${typeof res.data.project === 'object' ? res.data.project._id : res.data.project}/issues/${encodeURIComponent(getIssueKey(res.data))}`,
          autoDismissMs: 5000,
        });
        updateUrl({ page: 1 });
        issuesApi.list(buildListParams({ page: 1 })).then((r) => {
          if (r.success && r.data) {
            setIssues(r.data.data ?? []);
            setTotal(r.data.total ?? 0);
          }
        });
      } else setSubmitError(res.message ?? 'Failed');
    } else if (editIssue) {
      const res = await issuesApi.update(
        editIssue._id,
        {
          title: form.title,
          description: form.description,
          type: form.type,
          priority: form.priority,
          status: form.status,
          assignee: form.assignee || undefined,
          sprint: form.sprint || null,
          storyPoints: form.storyPoints === '' ? null : Number(form.storyPoints),
          parent: form.parent || null,
          milestone: form.milestone || null,
          customFieldValues: form.customFieldValues,
          fixVersion: form.fixVersion.length ? form.fixVersion : undefined,
          affectsVersions: form.affectsVersions.length ? form.affectsVersions : undefined,
          labels: form.labels,
        },
        token
      );
      if (res.success) {
        setModal(null);
        setEditIssue(null);
        issuesApi.list(buildListParams({ page })).then((r) => {
          if (r.success && r.data) {
            setIssues(r.data.data ?? []);
            setTotal(r.data.total ?? 0);
          }
        });
      } else setSubmitError(res.message ?? 'Failed');
    }
    setSubmitting(false);
  }

  const totalPages = Math.ceil(total / limit) || 1;
  const projectForTable = selectedProject ?? projects[0] ?? null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden animate-fade-in">
      <div className="flex-1 overflow-auto p-6">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <QuickFiltersBar
            quickFilter={quickFilter}
            updateUrl={updateUrl}
            savedFilters={[]}
            savedFiltersLoading={false}
            savedFiltersError={null}
            applySavedFilter={() => {}}
            removeSavedFilter={() => {}}
            totalCounts={totalCounts}
          />

          {!useJql && (
            <QuickFilterLabelFilters
              quickFilter={quickFilter}
              labelCounts={quickFilterLabelCounts}
              selectedLabels={filters.labels}
              onToggleLabel={(label) => toggleFilter('labels', label)}
              onClearLabels={() => updateUrl({ filters: { ...filters, labels: [] }, page: 1 })}
              loading={totalCounts === null}
            />
          )}

          <ActiveFilterChips
            filters={filters}
            quickFilter={quickFilter}
            updateUrl={updateUrl}
            users={users}
            projects={projects}
            sprints={sprints}
            milestones={milestones}
            versions={versions}
            onOpenFilterModal={() => setFiltersOpen(true)}
          />

          <IssuesToolbar
            viewMode={viewMode}
            updateUrl={updateUrl}
            hasActiveFilters={hasActiveFilters}
            activeFilterCount={activeFilterCount}
            useJql={useJql}
            setFiltersOpen={setFiltersOpen}
            setColumnsOpen={setColumnsOpen}
            setJqlOpen={setJqlOpen}
            setOpenFilterDropdown={setOpenFilterDropdown as (d: string | null) => void}
            buildListParams={buildListParams}
            openCreate={openCreate}
            projectId={undefined}
            token={token}
            jql={jql}
            canSaveFilter={false}
            onSaveFilterClick={() => {}}
          />

          <JqlSearchPanel
            jqlOpen={jqlOpen}
            jqlInput={jqlInput}
            jqlError={jqlError}
            useJql={useJql}
            jqlHelpOpen={jqlHelpOpen}
            setJqlInput={setJqlInput}
            setJqlError={setJqlError}
            setJqlHelpOpen={setJqlHelpOpen}
            updateUrl={updateUrl}
            projects={projects.map((p) => ({ key: p.key, name: p.name }))}
          />

          <div className="space-y-4">
            <BulkEditBar
              selectedCount={selectedIssueIds.size}
              setSelectedIssueIds={setSelectedIssueIds}
              setBulkModal={setBulkModal}
              setConfirmBulkDelete={setConfirmBulkDelete}
            />
            {loading ? (
              <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-8 text-center text-[color:var(--text-muted)] animate-pulse">
                Loading…
              </div>
            ) : issues.length === 0 ? (
              <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-12 text-center text-[color:var(--text-muted)]">
                No issues match your filters.
              </div>
            ) : viewMode === 'table' ? (
              <IssuesTableView
                issues={issues}
                projectId={undefined}
                project={projectForTable}
                projects={projects}
                visibleColumnIds={visibleColumnIds}
                columnWidths={columnsConfig.widths}
                onColumnWidthChange={setColumnWidth}
                selectedIssueIds={selectedIssueIds}
                toggleSelectIssue={toggleSelectIssue}
                toggleSelectAll={toggleSelectAll}
                getIssueKey={getIssueKey}
                getTypeMeta={getTypeMeta}
                getPriorityMeta={getPriorityMeta}
                getStatusMeta={getStatusMeta}
                watchingStatus={watchingStatus}
                watchingLoadingId={watchingLoadingId}
                handleToggleWatch={handleToggleWatch}
                openEdit={openEdit}
                setConfirmDeleteIssue={setConfirmDeleteIssue}
                navigate={(path) => navigate(path)}
              />
            ) : viewMode === 'kanban' ? (
              <IssuesKanbanView
                issues={issues}
                statusList={statusList}
                projectId={undefined}
                getIssueKey={getIssueKey}
                getStatusMeta={getStatusMeta}
                getTypeMeta={getTypeMeta}
                getPriorityMeta={getPriorityMeta}
                openEdit={openEdit}
                setConfirmDeleteIssue={setConfirmDeleteIssue}
                kanbanUpdatingId={kanbanUpdatingId}
                kanbanError={kanbanError}
                handleKanbanDragEnd={handleKanbanDragEnd}
                kanbanSensors={kanbanSensors}
                watchingStatus={watchingStatus}
                watchingLoadingId={watchingLoadingId}
                handleToggleWatch={handleToggleWatch}
              />
            ) : (
              <IssuesListView
                issues={issues}
                projectId={undefined}
                getIssueKey={getIssueKey}
                getTypeMeta={getTypeMeta}
                getPriorityMeta={getPriorityMeta}
                getStatusMeta={getStatusMeta}
                watchingStatus={watchingStatus}
                watchingLoadingId={watchingLoadingId}
                handleToggleWatch={handleToggleWatch}
                openEdit={openEdit}
                setConfirmDeleteIssue={setConfirmDeleteIssue}
                navigate={(path) => navigate(path)}
              />
            )}

            {totalPages > 1 && viewMode !== 'kanban' && (
              <IssuesPagination
                page={page}
                totalPages={totalPages}
                total={total}
                updateUrl={updateUrl}
              />
            )}
          </div>
        </div>
      </div>

      <IssuesFilterModal
        filtersOpen={filtersOpen}
        setFiltersOpen={setFiltersOpen}
        openFilterDropdown={openFilterDropdown}
        setOpenFilterDropdown={setOpenFilterDropdown}
        filters={filters}
        toggleFilter={toggleFilter}
        setHasStoryPointsFilter={setHasStoryPointsFilter}
        statusList={statusList}
        typeList={typeList}
        priorityList={priorityList}
        users={users}
        allLabels={allLabels}
        getStatusMeta={getStatusMeta}
        getTypeMeta={getTypeMeta}
        getPriorityMeta={getPriorityMeta}
        updateUrl={updateUrl}
        saveFilterName={saveFilterName}
        setSaveFilterName={setSaveFilterName}
        saveCurrentFilter={() => {}}
        hasActiveFilters={hasActiveFilters}
        projects={projects}
        sprints={sprints}
        milestones={milestones}
        versions={versions}
      />

      <ColumnsConfigModal
        columnsOpen={columnsOpen}
        setColumnsOpen={setColumnsOpen}
        columnsConfig={columnsConfig}
        toggleColumn={toggleColumn}
        moveColumnAt={moveColumnAt}
        resetColumns={resetColumns}
        columnDragId={columnDragId}
        setColumnDragId={setColumnDragId}
        columnDropIndex={columnDropIndex}
        setColumnDropIndex={setColumnDropIndex}
      />
      <IssueCreateEditModal
        modal={modal}
        setModal={setModal}
        form={form}
        setForm={setForm}
        submitError={submitError}
        submitting={submitting}
        handleSubmit={handleSubmit}
        typeList={selectedProject ? (selectedProject.issueTypes?.map((t) => t.name) ?? DEFAULT_TYPES) : typeList}
        priorityList={selectedProject ? (selectedProject.priorities?.map((p) => p.name) ?? DEFAULT_PRIORITIES) : priorityList}
        statusList={selectedProject ? (selectedProject.statuses?.map((s) => s.name) ?? DEFAULT_STATUSES) : statusList}
        users={modalUsers}
        parentCandidates={parentCandidates}
        editingIssueId={editIssue?._id}
        project={selectedProject}
        getIssueKey={getIssueKey}
        projects={projects}
        showProjectSelector
        milestones={milestones}
        sprints={sprints}
            labelSuggestions={allLabels}
        pendingFiles={pendingFiles}
        onPendingFilesChange={setPendingFiles}
      />

      <BulkEditModal
        bulkModal={bulkModal}
        setBulkModal={setBulkModal}
        bulkForm={bulkForm}
        setBulkForm={setBulkForm}
        bulkSubmitting={bulkSubmitting}
        handleBulkUpdate={handleBulkUpdate}
        submitError={submitError}
        statusList={statusList}
        users={users}
        sprints={bulkScopeProjectId ? bulkSprints : sprints}
        typeList={typeList}
        priorityList={priorityList}
        milestones={bulkScopeProjectId ? bulkMilestones : milestones}
        versions={bulkScopeProject?.versions ?? (bulkScopeProjectId ? [] : versions)}
        labelSuggestions={allLabels}
        parentCandidates={bulkParentCandidates}
        showProjectScopedFields={Boolean(bulkScopeProjectId)}
      />

      <ConfirmModal
        open={confirmDeleteIssue !== null}
        title="Delete issue"
        message={
          confirmDeleteIssue
            ? `Delete "${confirmDeleteIssue.title}"? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => confirmDeleteIssue && handleDelete(confirmDeleteIssue)}
        onCancel={() => setConfirmDeleteIssue(null)}
      />

      <ConfirmModal
        open={confirmBulkDelete}
        title="Bulk delete"
        message={`Delete ${selectedIssueIds.size} selected issue(s)? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleBulkDelete}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </div>
  );
}
