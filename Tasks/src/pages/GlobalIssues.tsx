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
import {
  issuesApi,
  usersApi,
  projectsApi,
  sprintsApi,
  milestonesApi,
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
  ISSUE_TABLE_COLUMNS,
  DEFAULT_COLUMN_ORDER,
  DEFAULT_STATUSES,
  DEFAULT_TYPES,
  DEFAULT_PRIORITIES,
  type QuickFilterValue,
  type ViewModeValue,
} from '../components/issues';
import {
  QuickFiltersBar,
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
} from '../components/issues';

const GLOBAL_COLUMNS_VISIBLE: Record<string, boolean> = {
  ...Object.fromEntries(ISSUE_TABLE_COLUMNS.map((c) => [c.id, c.id === 'project' ? true : c.defaultVisible])),
};

function getGlobalColumnsConfig() {
  return { order: [...DEFAULT_COLUMN_ORDER], visible: { ...GLOBAL_COLUMNS_VISIBLE } };
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
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
  });
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saveFilterName, setSaveFilterName] = useState('');
  const [openFilterDropdown, setOpenFilterDropdown] = useState<'status' | 'type' | 'priority' | 'assignee' | 'reporter' | 'labels' | 'storyPoints' | 'project' | null>(null);
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

  const COLUMNS_CONFIG_KEY = 'taskflow-issues-columns-global';
  const [columnsConfig, setColumnsConfig] = useState<{ order: string[]; visible: Record<string, boolean> }>(() => {
    try {
      const raw = localStorage.getItem(COLUMNS_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { order: string[]; visible: Record<string, boolean> };
        const order = parsed.order?.length ? parsed.order : DEFAULT_COLUMN_ORDER;
        const visible: Record<string, boolean> = { ...GLOBAL_COLUMNS_VISIBLE };
        ISSUE_TABLE_COLUMNS.forEach((c) => {
          if (parsed.visible && c.id in parsed.visible) visible[c.id] = Boolean(parsed.visible[c.id]);
        });
        return { order, visible };
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

  const hasActiveFilters = Boolean(
    filters.project.length || filters.status.length || filters.assignee.length || filters.reporter.length ||
    filters.type.length || filters.priority.length || filters.labels.length ||
    filters.storyPoints.length || filters.hasStoryPoints === false
  );
  const activeFilterCount =
    filters.project.length + filters.status.length + filters.assignee.length + filters.reporter.length +
    filters.type.length + filters.priority.length + filters.labels.length +
    filters.storyPoints.length + (filters.hasStoryPoints === false ? 1 : 0);
  const allLabels = useMemo(() => [...new Set(issues.flatMap((i) => i.labels || []))].sort(), [issues]);
  const limit = 25;

  function isDoneStatusName(name: string): boolean {
    const l = (name ?? '').trim().toLowerCase();
    return l === 'done' || l === 'closed' || l === 'clossed' || l === 'resolved' || l.includes('completed');
  }

  const useJql = Boolean(jql.trim());

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
    if (quickFilter === 'open' || quickFilter === 'my') {
      const openStatuses = statusList.filter((s) => !isDoneStatusName(String(s)));
      if (openStatuses.length > 0) params.status = openStatuses.join(',');
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
    }
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
    if (form.project && token) {
      issuesApi
        .list({
          token,
          project: form.project,
          page: 1,
          limit: 200,
        })
        .then((res) => {
          if (res.success && res.data) setParentCandidates(res.data.data ?? []);
        });
    } else {
      setParentCandidates([]);
    }
  }, [form.project, token]);

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
      fixVersion: '',
      affectsVersions: [],
    });
    setEditIssue(null);
    setSubmitError('');
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
      parent: typeof issue.parent === 'object' && issue.parent ? issue.parent._id : '',
      milestone: typeof issue.milestone === 'object' && issue.milestone ? issue.milestone._id : '',
      customFieldValues: { ...(issue.customFieldValues ?? {}) },
      fixVersion: issue.fixVersion ?? '',
      affectsVersions: issue.affectsVersions ?? [],
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
          fixVersion: form.fixVersion || undefined,
          affectsVersions: form.affectsVersions.length ? form.affectsVersions : undefined,
        },
        token
      );
      if (res.success) {
        setModal(null);
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
          fixVersion: form.fixVersion || undefined,
          affectsVersions: form.affectsVersions.length ? form.affectsVersions : undefined,
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
        users={users}
        parentCandidates={parentCandidates}
        project={selectedProject}
        getIssueKey={getIssueKey}
        projects={projects}
        showProjectSelector
        milestones={milestones}
        sprints={sprints}
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
    </div>
  );
}
