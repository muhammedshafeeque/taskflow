import { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { FiAlertCircle, FiPlus } from 'react-icons/fi';
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
  projectsApi,
  sprintsApi,
  milestonesApi,
  savedFiltersApi,
  uploadFile,
  attachmentsApi,
  type Issue,
  type User,
  type Project,
  type Sprint,
  type Milestone,
  getIssueKey,
} from '../lib/api';
import ConfirmModal from '../components/ConfirmModal';
import { normalizeFixVersionIds } from '../lib/issueVersions';
import {
  parseFiltersFromSearchParams,
  buildSearchParams,
  getDefaultColumnsConfig,
  parseIssuesColumnsConfig,
  DEFAULT_STATUSES,
  DEFAULT_TYPES,
  DEFAULT_PRIORITIES,
  PARAM_CREATE,
  PARAM_PARENT,
  applyFiltersToListParams,
  countActiveFilters,
  hasAnyIssueFilters,
  DEFAULT_FILTERS,
  resolveIssueParentId,
  filterParentCandidates,
  type QuickFilterValue,
  type ViewModeValue,
  type SavedFilter,
} from '../components/issues';
import {
  QuickFiltersBar,
  QuickFilterLabelFilters,
  IssuesToolbar,
  ActiveFilterChips,
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

export default function Issues() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { token, user } = useAuth();
  const { showToast } = useNotifications();
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

  const { subscribeProject } = useNotifications();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [project, setProject] = useState<Project | null>(null);
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
  const [saveFilterDialogOpen, setSaveFilterDialogOpen] = useState(false);
  const [saveFilterDialogName, setSaveFilterDialogName] = useState('');
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
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [bulkModal, setBulkModal] = useState<'edit' | null>(null);
  const [bulkForm, setBulkForm] = useState<BulkFormState>({});
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

  const COLUMNS_CONFIG_KEY = `taskflow-issues-columns-${projectId ?? 'global'}`;
  const [columnsConfig, setColumnsConfig] = useState(() => {
    try {
      const raw = localStorage.getItem(COLUMNS_CONFIG_KEY);
      if (raw) return parseIssuesColumnsConfig(JSON.parse(raw) as Parameters<typeof parseIssuesColumnsConfig>[0]);
    } catch {}
    return getDefaultColumnsConfig();
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLUMNS_CONFIG_KEY, JSON.stringify(columnsConfig));
    } catch {}
  }, [columnsConfig, COLUMNS_CONFIG_KEY]);

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
  const resetColumns = () => setColumnsConfig(getDefaultColumnsConfig());

  const setColumnWidth = (colId: string, width: number) => {
    setColumnsConfig((prev) => ({
      ...prev,
      widths: { ...prev.widths, [colId]: width },
    }));
  };

  const SAVED_FILTERS_KEY = `taskflow-saved-filters-${projectId ?? 'global'}`;
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [savedFiltersLoading, setSavedFiltersLoading] = useState(true);
  const [savedFiltersError, setSavedFiltersError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !projectId) return;
    setSavedFiltersLoading(true);
    setSavedFiltersError(null);
    savedFiltersApi.list(projectId, token).then((res) => {
      setSavedFiltersLoading(false);
      if (res.success && res.data) {
        const list = res.data.map((sf) => ({
          id: sf._id,
          name: sf.name,
          filters: sf.filters,
          quickFilter: sf.quickFilter as QuickFilterValue,
          jql: sf.jql,
          viewMode: sf.viewMode as ViewModeValue | undefined,
        }));
        setSavedFilters(list);
        const raw = localStorage.getItem(SAVED_FILTERS_KEY);
        if (raw && list.length === 0) {
          try {
            const local = JSON.parse(raw) as { id: string; name: string; filters: typeof filters; quickFilter: QuickFilterValue }[];
            if (Array.isArray(local) && local.length > 0) {
              (async () => {
                const migrated: SavedFilter[] = [...list];
                for (const sf of local) {
                  const createRes = await savedFiltersApi.create(
                    {
                      project: projectId,
                      name: sf.name,
                      filters: sf.filters,
                      quickFilter: sf.quickFilter,
                    },
                    token
                  );
                  if (createRes.success && createRes.data) {
                    migrated.push({
                      id: createRes.data!._id,
                      name: createRes.data!.name,
                      filters: createRes.data!.filters,
                      quickFilter: createRes.data!.quickFilter as QuickFilterValue,
                      jql: createRes.data!.jql,
                      viewMode: createRes.data!.viewMode as ViewModeValue | undefined,
                    });
                  }
                }
                setSavedFilters(migrated);
                try {
                  localStorage.removeItem(SAVED_FILTERS_KEY);
                } catch {}
              })();
            }
          } catch {}
        }
      } else {
        setSavedFiltersError(res.message ?? 'Failed to load saved filters');
      }
    });
  }, [token, projectId, SAVED_FILTERS_KEY]);

  const hasActiveFilters = hasAnyIssueFilters(filters);
  const activeFilterCount = countActiveFilters(filters);
  const versions = useMemo(() => project?.versions ?? [], [project]);
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

  function buildListParams(p: { page: number }) {
    if (useJql) {
      return { token: token!, page: p.page, limit: viewMode === 'kanban' ? 200 : 20, jql };
    }
    const params: { page: number; limit: number; token: string; project: string; status?: string; statusExclude?: string; assignee?: string; reporter?: string; type?: string; priority?: string; labels?: string; storyPoints?: string; hasStoryPoints?: string; hasEstimate?: string } = {
      ...p,
      limit: viewMode === 'kanban' ? 100 : limit,
      token: token!,
      project: projectId!,
    };
    if ((quickFilter === 'open' || quickFilter === 'my') && !filters.status.length) {
      let closedStatuses = project?.statuses?.length
        ? project.statuses.filter((s) => isClosedStatus(s)).map((s) => s.name).filter(Boolean)
        : statusList.filter((s) => isClosedStatus({ name: String(s) }));
      if (closedStatuses.length === 0) closedStatuses = [...LEGACY_CLOSED_STATUSES];
      params.statusExclude = closedStatuses.join(',');
    }
    applyFiltersToListParams(params, filters);
    if (quickFilter === 'my' && user?.id) params.assignee = user.id;
    return params;
  }

  function toggleFilter<K extends keyof typeof filters>(key: K, value: string) {
    if (key === 'hasStoryPoints') return;
    const arr = filters[key];
    if (!Array.isArray(arr)) return;
    const next = {
      ...filters,
      [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value],
    };
    updateUrl({ filters: next, page: 1 });
  }

  function setHasStoryPointsFilter(noStoryPoints: boolean) {
    updateUrl({ filters: { ...filters, hasStoryPoints: noStoryPoints ? false : undefined }, page: 1 }); 
  }

  function applySavedFilter(sf: SavedFilter) {
    updateUrl({
      filters: { ...DEFAULT_FILTERS, ...sf.filters, project: filters.project },
      quickFilter: sf.quickFilter,
      jql: sf.jql,
      viewMode: sf.viewMode,
      page: 1,
    });
  }

  async function saveCurrentFilter(name: string) {
    if (!name.trim() || !token || !projectId) return;
    const res = await savedFiltersApi.create(
      {
        project: projectId,
        name: name.trim(),
        filters: { ...filters },
        quickFilter,
        jql: jql.trim() || undefined,
        viewMode,
      },
      token
    );
    if (res.success && res.data) {
      setSavedFilters((prev) => [
        ...prev,
        {
          id: res.data!._id,
          name: res.data!.name,
          filters: res.data!.filters,
          quickFilter: res.data!.quickFilter as QuickFilterValue,
          jql: res.data!.jql,
          viewMode: res.data!.viewMode as ViewModeValue | undefined,
        },
      ]);
      setSaveFilterName('');
    }
  }

  async function removeSavedFilter(id: string) {
    if (!token) return;
    const res = await savedFiltersApi.delete(id, token);
    if (res.success) {
      setSavedFilters((prev) => prev.filter((sf) => sf.id !== id));
    }
  }

  useEffect(() => {
    if (!projectId) {
      navigate('/projects', { replace: true });
      return;
    }
  }, [projectId, navigate]);

  useEffect(() => {
    if (!token || !projectId) return;
    projectsApi.get(projectId, token).then((res) => {
      if (res.success && res.data) setProject(res.data);
    });
  }, [token, projectId]);

const statusList = project?.statuses?.length ? project.statuses.map((s) => s.name) : DEFAULT_STATUSES;
  const typeList = project?.issueTypes?.length ? project.issueTypes.map((t) => t.name) : DEFAULT_TYPES;
  const priorityList = project?.priorities?.length ? project.priorities.map((p) => p.name) : DEFAULT_PRIORITIES;
  const getPriorityMeta = (name: string) => project?.priorities?.find((p) => p.name === name);
  const getTypeMeta = (name: string) => project?.issueTypes?.find((t) => t.name === name);
  const getStatusMeta = (name: string) => project?.statuses?.find((s) => s.name === name);

  useEffect(() => {
    if (!token || !projectId) return;
    projectsApi.getMembers(projectId, token).then((res) => {
      if (res.success && res.data) {
        const members = Array.isArray(res.data) ? res.data : [];
        const flattened = members.map((m) => ({
          _id: m.user._id,
          name: m.user.name,
          email: m.user.email,
        }));
        setUsers(flattened as unknown as User[]);
      } else {
        setUsers([]);
      }
    });
  }, [token, projectId]);

  useEffect(() => {
    setJqlInput(jql);
  }, [jql]);

  useEffect(() => {
    if (!projectId) return;
    return subscribeProject(projectId, () => setRefreshTrigger((t) => t + 1));
  }, [projectId, subscribeProject]);

  useEffect(() => {
    if (!token || !projectId) return;
    setLoading(true);
    setJqlError(null);
    const params = buildListParams({ page: viewMode === 'kanban' ? 1 : page });
    (useJql ? issuesApi.searchJql((params as { jql: string }).jql, params.page, params.limit, token) : issuesApi.list(params)).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setIssues(res.data.data);
        setTotal(res.data.total);
        setJqlError(null);
      } else if (useJql && !res.success) {
        setJqlError(res.message ?? 'JQL query failed');
      }
    });

    issuesApi.getQuickFilterCounts(token, projectId).then((res) => {
      if (res.success && res.data) setTotalCounts(res.data);
    });
  }, [token, projectId, searchParams.toString(), refreshTrigger]);

  useEffect(() => {
    if (!token || issues.length === 0) return;
    const ids = issues.map((i) => i._id);
    issuesApi.getWatchingStatusBatch(ids, token).then((res) => {
      if (res.success && res.data) setWatchingStatus(res.data);
    });
  }, [token, issues.map((i) => i._id).join(',')]);

  useEffect(() => {
    const createParam = searchParams.get(PARAM_CREATE);
    const parentParam = searchParams.get(PARAM_PARENT);
    if (createParam === '1' && projectId && !modal) {
      openCreate(parentParam ?? undefined);
      const next = new URLSearchParams(searchParams);
      next.delete(PARAM_CREATE);
      next.delete(PARAM_PARENT);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams.get(PARAM_CREATE), searchParams.get(PARAM_PARENT), projectId]);

  useEffect(() => {
    if (token && projectId) {
      sprintsApi.list(1, 100, projectId, undefined, token).then((res) => {
        if (res.success && res.data) setSprints(res.data.data ?? []);
      });
      milestonesApi.list(projectId, token).then((res) => {
        if (res.success && res.data) setMilestones(Array.isArray(res.data) ? res.data : []);
      });
    } else {
      setSprints([]);
      setMilestones([]);
    }
  }, [token, projectId]);

  useEffect(() => {
    const loadParents = (modal === 'create' || modal === 'edit' || bulkModal === 'edit') && token && projectId;
    if (loadParents) {
      issuesApi
        .list({
          token,
          project: projectId,
          page: 1,
          limit: 200,
        })
        .then((res) => {
          if (res.success && res.data) {
            let list = filterParentCandidates(
              res.data.data ?? [],
              editIssue?._id,
              resolveIssueParentId(editIssue?.parent)
            );
            if (bulkModal === 'edit' && selectedIssueIds.size > 0) {
              list = list.filter((i) => !selectedIssueIds.has(i._id));
            }
            setParentCandidates(list);
          }
        });
    } else {
      setParentCandidates([]);
    }
  }, [modal, bulkModal, token, projectId, editIssue?._id, selectedIssueIds]);

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
      project: projectId ?? '',
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
    setForm({
      title: issue.title,
      description: issue.description ?? '',
      type: issue.type,
      priority: issue.priority,
      status: issue.status,
      project: typeof issue.project === 'object' && issue.project ? issue.project._id : '',
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
    if (!token || !projectId) return;
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
          setIssues(r.data.data);
          setTotal(r.data.total);
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
          setIssues(r.data.data);
          setTotal(r.data.total);
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
          url: `/projects/${projectId}/issues/${encodeURIComponent(getIssueKey(res.data))}`,
          autoDismissMs: 5000,
        });
        updateUrl({ page: 1 });
        issuesApi.list(buildListParams({ page: 1 })).then((r) => {
          if (r.success && r.data) {
            setIssues(r.data.data);
            setTotal(r.data.total);
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
            setIssues(r.data.data);
            setTotal(r.data.total);
          }
        });
      } else setSubmitError(res.message ?? 'Failed');
    }
    setSubmitting(false);
  }

  const totalPages = Math.ceil(total / limit) || 1;

  const canSaveFilter = hasActiveFilters || quickFilter !== 'all' || Boolean(jql?.trim());

  return (
    <div className="flex flex-1 flex-col overflow-hidden animate-fade-in">

      {/* ── Sticky page header ── */}
      <div className="shrink-0 bg-[color:var(--bg-surface)] border-b border-[color:var(--border-subtle)]">
        <div className="px-6 pt-4 pb-0">

          {/* Hero row: icon + title + stats tabs + New Issue */}
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[color:var(--accent)]/15 border border-[color:var(--accent)]/25 flex items-center justify-center shrink-0">
                <FiAlertCircle className="w-4.5 h-4.5 text-[color:var(--accent)]" aria-hidden />
              </div>
              <div>
                <h1 className="text-lg font-bold text-[color:var(--text-primary)] leading-tight">Issues</h1>
                <p className="text-[11px] text-[color:var(--text-muted)]">
                  {loading ? '…' : `${total.toLocaleString()} ${total === 1 ? 'issue' : 'issues'}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {/* Quick filter stat tabs */}
              {totalCounts && (
                <div className="hidden md:flex items-center gap-0.5 p-0.5 bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] rounded-xl">
                  {([
                    { key: 'my' as const, label: 'Mine', count: totalCounts.my },
                    { key: 'open' as const, label: 'Open', count: totalCounts.open },
                    { key: 'all' as const, label: 'All', count: totalCounts.all },
                  ] as const).map(({ key, label, count }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => updateUrl({ quickFilter: key, page: 1 })}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        quickFilter === key
                          ? 'bg-[color:var(--accent)] text-white shadow-sm'
                          : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
                      }`}
                    >
                      {label}
                      <span className={`font-bold tabular-nums ${
                        quickFilter === key ? 'text-white/80' : 'text-[color:var(--accent)]'
                      }`}>
                        {count}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* New Issue CTA */}
              <button
                type="button"
                onClick={() => openCreate()}
                className="btn-primary btn-primary-sm shadow-lg inline-flex items-center gap-1.5 font-semibold"
              >
                <FiPlus className="w-3.5 h-3.5" aria-hidden />
                New Issue
              </button>
            </div>
          </div>

          {/* Toolbar row */}
          <IssuesToolbar
            viewMode={viewMode}
            updateUrl={updateUrl}
            hasActiveFilters={hasActiveFilters}
            activeFilterCount={activeFilterCount}
            useJql={useJql}
            setFiltersOpen={setFiltersOpen}
            setColumnsOpen={setColumnsOpen}
            setJqlOpen={setJqlOpen}
            setOpenFilterDropdown={setOpenFilterDropdown}
            buildListParams={buildListParams}
            projectId={projectId}
            token={token}
            jql={jql}
            canSaveFilter={canSaveFilter}
            onSaveFilterClick={() => setSaveFilterDialogOpen(true)}
            showTitle={false}
          />

          {/* Saved filters (no quick tabs since hero has them) */}
          <QuickFiltersBar
            quickFilter={quickFilter}
            updateUrl={updateUrl}
            savedFilters={savedFilters}
            savedFiltersLoading={savedFiltersLoading}
            savedFiltersError={savedFiltersError}
            applySavedFilter={applySavedFilter}
            removeSavedFilter={removeSavedFilter}
            onSavedEmptyClick={() => setFiltersOpen(true)}
            totalCounts={totalCounts}
            hideQuickTabs
          />

          {/* Active filter chips */}
          <ActiveFilterChips
            filters={filters}
            quickFilter={quickFilter}
            updateUrl={updateUrl}
            users={users}
            sprints={sprints}
            milestones={milestones}
            versions={versions}
            onOpenFilterModal={() => setFiltersOpen(true)}
          />

        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-auto">
        <div className="px-6 py-4">

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
            projects={project ? [{ key: project.key, name: project.name }] : []}
            onSaveAsFilter={() => setFiltersOpen(true)}
          />

          <div className="space-y-4">
            <BulkEditBar
              selectedCount={selectedIssueIds.size}
              setSelectedIssueIds={setSelectedIssueIds}
              setBulkModal={setBulkModal}
              setConfirmBulkDelete={setConfirmBulkDelete}
            />

            {loading ? (
              <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-[color:var(--border-subtle)]/50 last:border-0 animate-pulse">
                    <div className="w-4 h-4 rounded bg-[color:var(--bg-elevated)]" />
                    <div className="w-16 h-4 rounded-md bg-[color:var(--bg-elevated)]" />
                    <div className="w-12 h-5 rounded-full bg-[color:var(--bg-elevated)]" />
                    <div className="flex-1 h-4 rounded bg-[color:var(--bg-elevated)]" />
                    <div className="w-20 h-5 rounded-full bg-[color:var(--bg-elevated)]" />
                    <div className="w-14 h-5 rounded-full bg-[color:var(--bg-elevated)]" />
                  </div>
                ))}
              </div>
            ) : issues.length === 0 ? (
              <div className="rounded-xl border border-[color:var(--border-subtle)] border-dashed bg-[color:var(--bg-surface)] py-16 text-center">
                <div className="w-12 h-12 rounded-2xl bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] flex items-center justify-center mx-auto mb-4">
                  <FiAlertCircle className="w-6 h-6 text-[color:var(--text-muted)]" />
                </div>
                <p className="text-sm font-medium text-[color:var(--text-primary)] mb-1">No issues found</p>
                <p className="text-xs text-[color:var(--text-muted)] mb-4">
                  {hasActiveFilters ? 'Try adjusting your filters or' : 'Get started by creating your first issue or'}{' '}
                </p>
                <div className="flex items-center justify-center gap-2">
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={() => updateUrl({ filters: DEFAULT_FILTERS, quickFilter: 'all', page: 1 })}
                      className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] text-xs font-medium text-[color:var(--text-primary)] hover:border-[color:var(--border-emphasis)] transition"
                    >
                      Clear filters
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openCreate()}
                    className="btn-primary btn-primary-sm inline-flex items-center gap-1.5"
                  >
                    <FiPlus className="w-3.5 h-3.5" aria-hidden />
                    New Issue
                  </button>
                </div>
              </div>
            ) : viewMode === 'table' ? (
              <IssuesTableView
                issues={issues}
                projectId={projectId!}
                project={project}
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
                projectId={projectId!}
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
                projectId={projectId!}
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
        saveCurrentFilter={saveCurrentFilter}
        hasActiveFilters={hasActiveFilters}
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
        typeList={typeList}
        priorityList={priorityList}
        statusList={statusList}
        users={users}
        parentCandidates={parentCandidates}
        editingIssueId={editIssue?._id}
        project={project}
        getIssueKey={getIssueKey}
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
        sprints={sprints}
        typeList={typeList}
        priorityList={priorityList}
        milestones={milestones}
        versions={versions}
        labelSuggestions={allLabels}
        parentCandidates={parentCandidates}
        showProjectScopedFields
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

      {saveFilterDialogOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4"
            onClick={() => { setSaveFilterDialogOpen(false); setSaveFilterDialogName(''); }}
          >
            <div
              className="w-full max-w-sm bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl p-6 shadow-xl animate-scale-in"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-3">Save filter</h2>
              <p className="text-xs text-[color:var(--text-muted)] mb-3">
                Save the current filters and view as a named filter for quick access.
              </p>
              <input
                type="text"
                placeholder="Filter name"
                value={saveFilterDialogName}
                onChange={(e) => setSaveFilterDialogName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (saveFilterDialogName.trim()) saveCurrentFilter(saveFilterDialogName.trim());
                    setSaveFilterDialogOpen(false);
                    setSaveFilterDialogName('');
                  }
                }}
                className="w-full px-3 py-2 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm placeholder-[color:var(--text-muted)] mb-4"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => { setSaveFilterDialogOpen(false); setSaveFilterDialogName(''); }}
                  className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (saveFilterDialogName.trim()) saveCurrentFilter(saveFilterDialogName.trim());
                    setSaveFilterDialogOpen(false);
                    setSaveFilterDialogName('');
                  }}
                  disabled={!saveFilterDialogName.trim()}
                  className="px-3 py-1.5 rounded-md bg-[color:var(--accent)] text-xs text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Save
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
