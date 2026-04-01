import { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
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
import {
  parseFiltersFromSearchParams,
  buildSearchParams,
  getDefaultColumnsConfig,
  ISSUE_TABLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_VISIBLE,
  DEFAULT_STATUSES,
  DEFAULT_TYPES,
  DEFAULT_PRIORITIES,
  PARAM_CREATE,
  PARAM_PARENT,
  type QuickFilterValue,
  type ViewModeValue,
  type SavedFilter,
} from '../components/issues';
import {
  QuickFiltersBar,
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
} from '../components/issues';

export default function Issues() {
  const { projectId } = useParams<{ projectId: string }>();
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
  const { subscribeProject } = useNotifications();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [project, setProject] = useState<Project | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [total, setTotal] = useState(0);
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
    fixVersion: '',
    affectsVersions: [] as string[],
    labels: [] as string[],
  });
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveFilterDialogOpen, setSaveFilterDialogOpen] = useState(false);
  const [saveFilterDialogName, setSaveFilterDialogName] = useState('');
  const [saveFilterName, setSaveFilterName] = useState('');
  const [openFilterDropdown, setOpenFilterDropdown] = useState<'status' | 'type' | 'priority' | 'assignee' | 'reporter' | 'labels' | 'storyPoints' | 'project' | null>(null);
  const [confirmDeleteIssue, setConfirmDeleteIssue] = useState<Issue | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [columnDragId, setColumnDragId] = useState<string | null>(null);
  const [columnDropIndex, setColumnDropIndex] = useState<number | null>(null);
  const [kanbanUpdatingId, setKanbanUpdatingId] = useState<string | null>(null);
  const [kanbanError, setKanbanError] = useState<string | null>(null);
  const [parentCandidates, setParentCandidates] = useState<Issue[]>([]);
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [bulkModal, setBulkModal] = useState<'edit' | null>(null);
  const [bulkForm, setBulkForm] = useState<{ status?: string; assignee?: string; sprint?: string; storyPoints?: string; type?: string; priority?: string }>({});
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
  const [columnsConfig, setColumnsConfig] = useState<{ order: string[]; visible: Record<string, boolean> }>(() => {
    try {
      const raw = localStorage.getItem(COLUMNS_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { order: string[]; visible: Record<string, boolean> };
        const order = parsed.order?.length ? parsed.order : DEFAULT_COLUMN_ORDER;
        const visible: Record<string, boolean> = { ...DEFAULT_VISIBLE };
        ISSUE_TABLE_COLUMNS.forEach((c) => {
          if (parsed.visible && c.id in parsed.visible) visible[c.id] = Boolean(parsed.visible[c.id]);
        });
        return { order, visible };
      }
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

  const hasActiveFilters = Boolean(
    filters.status.length || filters.assignee.length || filters.reporter.length ||
    filters.type.length || filters.priority.length || filters.labels.length ||
    filters.storyPoints.length || filters.hasStoryPoints === false || filters.hasEstimate === false || filters.hasEstimate === true
  );
  const activeFilterCount =
    filters.status.length + filters.assignee.length + filters.reporter.length +
    filters.type.length + filters.priority.length + filters.labels.length +
    filters.storyPoints.length + (filters.hasStoryPoints === false ? 1 : 0) + (filters.hasEstimate === false ? 1 : 0) + (filters.hasEstimate === true ? 1 : 0);
  const allLabels = useMemo(() => [...new Set(issues.flatMap((i) => i.labels || []))].sort(), [issues]);
  const limit = 25;

  const LEGACY_CLOSED_STATUSES = ['Done', 'Closed', 'Resolved'];

  function isClosedStatus(status: { name: string; isClosed?: boolean }): boolean {
    if (status.isClosed !== undefined) return Boolean(status.isClosed);
    const l = (status.name ?? '').trim().toLowerCase();
    return l === 'done' || l === 'closed' || l === 'clossed' || l === 'resolved' || l.includes('completed');
  }

  const useJql = Boolean(jql.trim());

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
    if (quickFilter === 'open' || quickFilter === 'my') {
      let closedStatuses = project?.statuses?.length
        ? project.statuses.filter((s) => isClosedStatus(s)).map((s) => s.name).filter(Boolean)
        : statusList.filter((s) => isClosedStatus({ name: String(s) }));
      if (closedStatuses.length === 0) closedStatuses = [...LEGACY_CLOSED_STATUSES];
      params.statusExclude = closedStatuses.join(',');
    }
    else {
      if (filters.status.length) params.status = filters.status.join(',');
      if (filters.assignee.length) params.assignee = filters.assignee.join(',');
      if (filters.reporter.length) params.reporter = filters.reporter.join(',');
      if (filters.type.length) params.type = filters.type.join(',');
      if (filters.priority.length) params.priority = filters.priority.join(',');
      if (filters.labels.length) params.labels = filters.labels.join(',');
      if (filters.storyPoints.length) params.storyPoints = filters.storyPoints.join(',');
      if (filters.hasStoryPoints === false) params.hasStoryPoints = 'false';
      if (filters.hasEstimate === false) params.hasEstimate = 'false';
      if (filters.hasEstimate === true) params.hasEstimate = 'true';
    }
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
      filters: { ...sf.filters, project: filters.project } as typeof filters,
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
    if (!token) return;
    const perms = user?.permissions ?? [];
    if (perms.includes('users:list')) {
      usersApi.list(1, 100, token).then((res) => {
        if (res.success && res.data) setUsers(res.data.data);
      });
    } else if (projectId) {
      projectsApi.getMembers(projectId, token).then((res) => {
        if (res.success && res.data) {
          const members = Array.isArray(res.data) ? res.data : [];
          const flattened = members.map((m) => ({
            _id: m.user._id,
            name: m.user.name,
            email: m.user.email,
          }));
          setUsers(flattened as unknown as User[]);
        }
      });
    }
  }, [token, user?.permissions, projectId]);

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
    if (modal && token && projectId) {
      issuesApi
        .list({
          token,
          project: projectId,
          page: 1,
          limit: 200,
        })
        .then((res) => {
          if (res.success && res.data) setParentCandidates(res.data.data);
        });
    } else {
      setParentCandidates([]);
    }
  }, [modal, token, projectId]);

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
      fixVersion: '',
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
      parent: typeof issue.parent === 'object' && issue.parent ? issue.parent._id : '',
      milestone: typeof issue.milestone === 'object' && issue.milestone ? issue.milestone._id : '',
      customFieldValues: { ...(issue.customFieldValues ?? {}) },
      fixVersion: issue.fixVersion ?? '',
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
    const updates: Parameters<typeof issuesApi.bulkUpdate>[1] = {};
    if (bulkForm.status) updates.status = bulkForm.status;
    if (bulkForm.assignee !== undefined) updates.assignee = bulkForm.assignee === '__unassigned__' ? null : bulkForm.assignee || null;
    if (bulkForm.sprint !== undefined) updates.sprint = bulkForm.sprint === '__backlog__' ? null : bulkForm.sprint || null;
    if (bulkForm.storyPoints !== undefined) {
      updates.storyPoints = bulkForm.storyPoints === '__clear__' ? null : Number(bulkForm.storyPoints);
    }
    if (bulkForm.type) updates.type = bulkForm.type;
    if (bulkForm.priority) updates.priority = bulkForm.priority;
    if (Object.keys(updates).length === 0) return;
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
          fixVersion: form.fixVersion || undefined,
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
          fixVersion: form.fixVersion || undefined,
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden animate-fade-in">
      <div className="flex-1 overflow-auto p-6">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <QuickFiltersBar
          quickFilter={quickFilter}
          updateUrl={updateUrl}
          savedFilters={savedFilters}
          savedFiltersLoading={savedFiltersLoading}
          savedFiltersError={savedFiltersError}
          applySavedFilter={applySavedFilter}
          removeSavedFilter={removeSavedFilter}
          onSavedEmptyClick={() => setFiltersOpen(true)}
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
          setOpenFilterDropdown={setOpenFilterDropdown}
          buildListParams={buildListParams}
          openCreate={openCreate}
          projectId={projectId}
          token={token}
          jql={jql}
          canSaveFilter={hasActiveFilters || quickFilter !== 'all' || Boolean(jql?.trim())}
          onSaveFilterClick={() => setSaveFilterDialogOpen(true)}
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
          projects={project ? [{ key: project.key, name: project.name }] : []}
          onSaveAsFilter={() => setFiltersOpen(true)}
        />

        <ActiveFilterChips
          filters={filters}
          quickFilter={quickFilter}
          updateUrl={updateUrl}
          users={users}
          onOpenFilterModal={() => setFiltersOpen(true)}
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
            projectId={projectId!}
            project={project}
            visibleColumnIds={visibleColumnIds}
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
