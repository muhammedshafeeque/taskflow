import { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { FiAlertCircle } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationsContext';
import {
  issuesApi,
  commentsApi,
  workLogsApi,
  projectsApi,
  attachmentsApi,
  sprintsApi,
  type Issue,
  type Comment,
  type User,
  type Project,
  type Attachment,
  type Sprint,
  getIssueKey,
} from '../lib/api';
import ConfirmModal from '../components/ConfirmModal';
import { IssueCreateEditModal } from '../components/issues';
import {
  TaskHeader,
  TaskDescription,
  TaskSecondaryTabs,
  TaskActivityComments,
  TaskDetailsSidebar,
  WorkLogInput,
} from '../components/issue';
import EpicRollupPanel from '../components/issue/EpicRollupPanel';
import type { TaskSecondaryTabsHandle } from '../components/issue/TaskSecondaryTabs';

const DEFAULT_STATUSES = ['Backlog', 'Todo', 'In Progress', 'Done'];
const DEFAULT_TYPES = ['Task', 'Bug', 'Story', 'Epic'];
const DEFAULT_PRIORITIES = ['Lowest', 'Low', 'Medium', 'High', 'Highest'];

export default function IssueDetail() {
  const { projectId, ticketId } = useParams<{ projectId?: string; ticketId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { token, user } = useAuth();
  const { showToast, subscribeProject } = useNotifications();
  const secondaryTabsRef = useRef<TaskSecondaryTabsHandle>(null);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [workLogs, setWorkLogs] = useState<import('../lib/api').WorkLog[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [subtasks, setSubtasks] = useState<Issue[]>([]);
  const [links, setLinks] = useState<import('../lib/api').IssueLink[]>([]);
  const [watchers, setWatchers] = useState<{ user: { _id: string; name: string; email: string } }[]>([]);
  const [watching, setWatching] = useState(false);
  const [watchingLoading, setWatchingLoading] = useState(false);
  const [watchersError, setWatchersError] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [submittingWorkLog, setSubmittingWorkLog] = useState(false);
  const [updatingField, setUpdatingField] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [timeLogOpen, setTimeLogOpen] = useState(false);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [conflictLatest, setConflictLatest] = useState<Issue | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<Parameters<typeof issuesApi.update>[1] | null>(null);

  const [modalOpen, setModalOpen] = useState<'create' | 'edit' | null>(null);
  const [form, setForm] = useState({
    title: '',
    description: '',
    type: 'Task',
    priority: 'Medium',
    status: 'Backlog',
    project: projectId ?? '',
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
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [submittingModal, setSubmittingModal] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const PARAM_CREATE = 'create';
  const PARAM_PARENT = 'parent';

  useEffect(() => {
    const createParam = searchParams.get(PARAM_CREATE);
    const parentParam = searchParams.get(PARAM_PARENT);
    if (createParam === '1' && projectId && !modalOpen) {
      setForm((prev) => ({
        ...prev,
        parent: parentParam ?? '',
        project: projectId,
        type: project?.issueTypes?.[0]?.name ?? DEFAULT_TYPES[0],
        priority: project?.priorities?.[Math.min(2, (project.priorities.length || 1) - 1)]?.name ?? 'Medium',
        status: project?.statuses?.[0]?.name ?? 'Backlog',
      }));
      setSubmitError('');
      setPendingFiles([]);
      setModalOpen('create');
      const next = new URLSearchParams(searchParams);
      next.delete(PARAM_CREATE);
      next.delete(PARAM_PARENT);
      setSearchParams(next, { replace: true });
    }
  }, [searchParams.get(PARAM_CREATE), searchParams.get(PARAM_PARENT), projectId, project]);

  async function handleModalSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSubmittingModal(true);
    setSubmitError('');
    if (modalOpen === 'create') {
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
        if (pendingFiles.length > 0) {
          const issueId = res.data._id;
          await Promise.all(
            pendingFiles.map(async (file) => {
              const formData = new FormData();
              formData.append('file', file);
              const { uploadFile } = await import('../lib/api');
              const up = await uploadFile(file, token);
              if (up.success && up.data) {
                await attachmentsApi.add(
                  issueId,
                  { url: up.data.url, originalName: up.data.originalName, mimeType: up.data.mimeType, size: up.data.size },
                  token
                );
              }
            })
          );
        }
        setModalOpen(null);
        showToast({
          title: `Issue Created : ${getIssueKey(res.data)}`,
          body: 'click to view',
          url: `/projects/${typeof res.data.project === 'object' ? res.data.project._id : res.data.project}/issues/${encodeURIComponent(getIssueKey(res.data))}`,
          autoDismissMs: 5000,
        });
        if (form.parent === issue?._id) {
          issuesApi.getSubtasks(issue._id, token).then((r) => {
            if (r.success && r.data) setSubtasks(Array.isArray(r.data) ? r.data : []);
          });
        }
      } else {
        setSubmitError(res.message ?? 'Failed to create issue');
      }
    }
    setSubmittingModal(false);
  }

  const reloadIssue = useCallback(() => {
    if (!token || !projectId || !ticketId) return;
    issuesApi.getByKey(projectId, decodeURIComponent(ticketId), token).then((res) => {
      if (res.success && res.data) setIssue(res.data);
      else setIssue(null);
    });
  }, [token, projectId, ticketId]);

  useEffect(() => {
    if (!token || !projectId || !ticketId) return;
    setLoading(true);
    issuesApi.getByKey(projectId, decodeURIComponent(ticketId), token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setIssue(res.data);
      else setIssue(null);
    });
  }, [token, projectId, ticketId]);

  useEffect(() => {
    if (!projectId) return;
    return subscribeProject(projectId, () => reloadIssue());
  }, [projectId, subscribeProject, reloadIssue]);

  useEffect(() => {
    if (!token || !projectId) return;
    projectsApi.get(projectId, token).then((res) => {
      if (res.success && res.data) setProject(res.data);
    });
  }, [token, projectId]);

  useEffect(() => {
    if (!token || !projectId) return;
    sprintsApi.list(1, 100, projectId, undefined, token).then((res) => {
      if (res.success && res.data) setSprints(res.data.data ?? []);
    });
  }, [token, projectId]);

  useEffect(() => {
    if (!token || !issue?._id) return;
    commentsApi.list(issue._id, 1, 50, token).then((res) => {
      if (res.success && res.data) setComments(res.data.data);
    });
  }, [token, issue?._id]);

  useEffect(() => {
    if (!token || !issue?._id) return;
    workLogsApi.list(issue._id, 1, 100, token).then((res) => {
      if (res.success && res.data) setWorkLogs(res.data.data);
    });
  }, [token, issue?._id]);

  const refreshAttachments = () => {
    if (!token || !issue?._id) return;
    attachmentsApi.list(issue._id, token).then((res) => {
      if (res.success && res.data) setAttachments(Array.isArray(res.data) ? res.data : []);
    });
  };

  useEffect(() => {
    if (!token || !issue?._id) return;
    refreshAttachments();
  }, [token, issue?._id]);

  useEffect(() => {
    if (!token || !issue?._id) return;
    issuesApi.getSubtasks(issue._id, token).then((res) => {
      if (res.success && res.data) setSubtasks(Array.isArray(res.data) ? res.data : []);
    });
  }, [token, issue?._id]);

  const refreshLinks = () => {
    if (!token || !issue?._id) return;
    issuesApi.getLinks(issue._id, token).then((res) => {
      if (res.success && res.data) setLinks(Array.isArray(res.data) ? res.data : []);
    });
  };

  useEffect(() => {
    if (!token || !issue?._id) return;
    refreshLinks();
  }, [token, issue?._id]);

  const refreshWatchers = () => {
    if (!token || !issue?._id) return;
    issuesApi.getWatchers(issue._id, token).then((res) => {
      if (res.success && res.data) setWatchers(Array.isArray(res.data) ? res.data : []);
    });
    issuesApi.getWatchingStatus(issue._id, token).then((res) => {
      if (res.success && res.data) setWatching(res.data.watching ?? false);
    });
  };

  useEffect(() => {
    if (!token || !issue?._id) return;
    refreshWatchers();
  }, [token, issue?._id]);

  useEffect(() => {
    if (!token || !projectId) return;
    projectsApi.getMembers(projectId, token).then((res) => {
      if (res.success && res.data) {
        const memberUsers = (res.data as { user: { _id: string; name: string; email: string } }[]).map(
          (m) => m.user
        );
        setUsers(memberUsers);
      }
    });
  }, [token, projectId]);

  const statusList = project?.statuses?.length ? project.statuses.map((s) => s.name) : DEFAULT_STATUSES;
  const typeList = project?.issueTypes?.length ? project.issueTypes.map((t) => t.name) : DEFAULT_TYPES;
  const priorityList =
    project?.priorities?.length ? project.priorities.map((p) => p.name) : DEFAULT_PRIORITIES;
  const getTypeMeta = (name: string) => project?.issueTypes?.find((t) => t.name === name);
  const getPriorityMeta = (name: string) => project?.priorities?.find((p) => p.name === name);
  const getStatusMeta = (name: string) => project?.statuses?.find((s) => s.name === name);

  async function addComment(body: string) {
    if (!token || !issue?._id || !body.trim()) return;
    setSubmittingComment(true);
    const res = await commentsApi.create(issue._id, body.trim(), token);
    setSubmittingComment(false);
    if (res.success && res.data) {
      setComments((prev) => [res.data!, ...prev]);
    }
  }

  async function updateComment(commentId: string, body: string) {
    if (!token || !issue?._id || !body.trim()) return;
    setEditingCommentId(commentId);
    setSubmittingComment(true);
    const res = await commentsApi.update(issue._id, commentId, body.trim(), token);
    setSubmittingComment(false);
    setEditingCommentId(null);
    if (res.success && res.data) {
      setComments((prev) => prev.map((c) => (c._id === commentId ? res.data! : c)));
    }
  }

  async function addWorkLog(payload: {
    minutesSpent: number;
    date: string;
    description?: string;
  }) {
    if (!token || !issue?._id) return;
    setSubmittingWorkLog(true);
    const res = await workLogsApi.create(issue._id, payload, token);
    setSubmittingWorkLog(false);
    if (res.success && res.data) {
      setWorkLogs((prev) => [res.data!, ...prev]);
    }
  }

  async function deleteWorkLog(id: string) {
    if (!token || !issue?._id) return;
    const res = await workLogsApi.delete(issue._id, id, token);
    if (res.success) {
      setWorkLogs((prev) => prev.filter((w) => w._id !== id));
    }
  }

  async function updateIssue(
    payload: Parameters<typeof issuesApi.update>[1],
    options?: { skipConcurrency?: boolean }
  ) {
    if (!token || !issue?._id || !issue) return;
    const body = {
      ...payload,
      ...(options?.skipConcurrency || !issue.updatedAt
        ? {}
        : { expectedUpdatedAt: issue.updatedAt }),
    };
    const res = await issuesApi.update(issue._id, body, token);
    if (!res.success && res.status === 409) {
      const latest = (res.data as { latest?: Issue } | undefined)?.latest;
      if (latest) {
        setConflictLatest(latest);
        setPendingUpdate(payload);
        return;
      }
    }
    if (res.success && res.data) {
      setIssue(res.data);
      setConflictLatest(null);
      setPendingUpdate(null);
    }
  }

  function handleConflictReload() {
    if (conflictLatest) {
      setIssue(conflictLatest);
      setConflictLatest(null);
      setPendingUpdate(null);
    }
  }

  async function handleConflictOverwrite() {
    if (!token || !issue?._id || !pendingUpdate) return;
    const res = await issuesApi.update(issue._id, { ...pendingUpdate }, token);
    if (res.success && res.data) {
      setIssue(res.data);
      setConflictLatest(null);
      setPendingUpdate(null);
    }
  }

  async function updateField(
    field:
      | 'status'
      | 'type'
      | 'priority'
      | 'assignee'
      | 'dueDate'
      | 'startDate'
      | 'storyPoints'
      | 'timeEstimateMinutes'
      | 'sprint',
    value: string | number | null
  ) {
    if (!token || !issue?._id || !issue) return;
    setUpdatingField(field);
    const payload: Record<string, unknown> =
      field === 'assignee'
        ? { assignee: value === '' || value === '__unassigned__' ? '' : value }
        : field === 'dueDate' || field === 'startDate'
          ? { [field]: value === '' ? null : value }
          : field === 'timeEstimateMinutes'
            ? { timeEstimateMinutes: value }
            : field === 'sprint'
              ? { sprint: value === '' ? null : value }
              : { [field]: value };
    await updateIssue(payload);
    setUpdatingField(null);
  }

  async function updateFixVersions(fixVersion: string[]) {
    if (!token || !issue?._id) return;
    setUpdatingField('fixVersion');
    await updateIssue({ fixVersion });
    setUpdatingField(null);
  }

  async function updateAffectsVersions(affectsVersions: string[]) {
    if (!token || !issue?._id) return;
    setUpdatingField('affectsVersions');
    await updateIssue({ affectsVersions });
    setUpdatingField(null);
  }

  async function handleDelete() {
    if (!token || !issue?._id || !projectId) return;
    const res = await issuesApi.delete(issue._id, token);
    if (res.success) {
      setConfirmDelete(false);
      navigate(`/projects/${projectId}/issues`, { replace: true });
    }
  }

  async function updateDescription(description: string) {
    await updateIssue({ description });
  }

  async function updateTitle(title: string) {
    await updateIssue({ title });
  }

  function addLabel() {
    if (!newLabel.trim() || !issue) return;
    const labels = issue.labels ?? [];
    if (labels.includes(newLabel.trim())) {
      setNewLabel('');
      return;
    }
    setNewLabel('');
    updateIssue({ labels: [...labels, newLabel.trim()] });
  }

  function removeLabel(label: string) {
    if (!issue) return;
    updateIssue({ labels: (issue.labels ?? []).filter((l) => l !== label) });
  }

  async function handleWatch() {
    if (!token || !issue?._id) return;
    setWatchingLoading(true);
    setWatchersError('');
    const res = await issuesApi.watch(issue._id, token);
    setWatchingLoading(false);
    if (res.success) refreshWatchers();
    else setWatchersError(res.message ?? 'Failed to watch');
  }

  async function handleUnwatch() {
    if (!token || !issue?._id) return;
    setWatchingLoading(true);
    setWatchersError('');
    const res = await issuesApi.unwatch(issue._id, token);
    setWatchingLoading(false);
    if (res.success) refreshWatchers();
    else setWatchersError(res.message ?? 'Failed to unwatch');
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col min-h-0">
        <div className="flex flex-1 min-h-0 w-full max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-4 lg:py-6">
          <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-[1fr_minmax(260px,340px)] gap-4 lg:gap-6">
            {/* Left skeleton */}
            <div className="space-y-4">
              <div className="space-y-3 pb-4 border-b border-[color:var(--border-subtle)]/60">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-20 rounded bg-[color:var(--bg-elevated)] animate-pulse" />
                  <div className="h-3 w-3 rounded-sm bg-[color:var(--bg-elevated)] animate-pulse" />
                  <div className="h-5 w-16 rounded-md bg-[color:var(--bg-elevated)] animate-pulse" />
                </div>
                <div className="h-9 w-4/5 rounded-lg bg-[color:var(--bg-elevated)] animate-pulse" />
                <div className="h-7 w-2/3 rounded-lg bg-[color:var(--bg-elevated)] animate-pulse" />
                <div className="flex gap-2">
                  <div className="h-6 w-16 rounded-full bg-[color:var(--bg-elevated)] animate-pulse" />
                  <div className="h-6 w-14 rounded-full bg-[color:var(--bg-elevated)] animate-pulse" />
                  <div className="h-6 w-20 rounded-full bg-[color:var(--bg-elevated)] animate-pulse" />
                </div>
              </div>
              {[1, 2].map((i) => (
                <div key={i} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
                  <div className="h-10 bg-[color:var(--bg-elevated)] border-b border-[color:var(--border-subtle)] animate-pulse" />
                  <div className="px-4 py-4 space-y-2.5">
                    <div className="h-3 w-full rounded bg-[color:var(--bg-elevated)] animate-pulse" />
                    <div className="h-3 w-5/6 rounded bg-[color:var(--bg-elevated)] animate-pulse" />
                    <div className="h-3 w-3/4 rounded bg-[color:var(--bg-elevated)] animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
            {/* Right sidebar skeleton */}
            <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
              <div className="h-11 bg-[color:var(--bg-elevated)] border-b border-[color:var(--border-subtle)] animate-pulse" />
              <div className="divide-y divide-[color:var(--border-subtle)]/70">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="px-4 py-3 space-y-2">
                    <div className="h-2.5 w-12 rounded bg-[color:var(--bg-elevated)] animate-pulse" />
                    <div className="h-7 w-full rounded-md bg-[color:var(--bg-elevated)] animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!issue) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-[color:var(--bg-elevated)] flex items-center justify-center">
          <FiAlertCircle className="w-7 h-7 text-[color:var(--text-muted)]" />
        </div>
        <div>
          <p className="text-base font-semibold text-[color:var(--text-primary)]">Issue not found</p>
          <p className="text-sm text-[color:var(--text-muted)] mt-1">
            This issue may have been deleted or you don't have permission to view it.
          </p>
        </div>
        {projectId && (
          <Link
            to={`/projects/${projectId}/issues`}
            className="text-sm font-medium text-[color:var(--accent)] hover:underline underline-offset-2"
          >
            ← Back to issues
          </Link>
        )}
      </div>
    );
  }

  const projectName = typeof issue.project === 'object' && issue.project ? issue.project.name : '';

  return (
    <div className="flex flex-1 flex-col min-h-0 lg:overflow-hidden animate-fade-in">
      <div className="flex flex-1 min-h-0 w-full max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-4 lg:py-6">
        <div className="grid flex-1 min-h-0 grid-cols-1 lg:grid-cols-[1fr_minmax(260px,340px)] gap-4 lg:gap-6 lg:overflow-hidden">
          <div className="flex min-w-0 flex-col lg:min-h-0 lg:overflow-hidden">
            <div className="shrink-0 pb-3 lg:border-b border-[color:var(--border-subtle)]/60 bg-[color:var(--bg-page)]">
              <TaskHeader
                issue={issue}
                issueId={issue._id}
                projectId={projectId}
                projectName={projectName}
                canLinkAndAttach={!!token}
                onOpenLinkModal={() => secondaryTabsRef.current?.openLinkModal()}
                onAttach={() => secondaryTabsRef.current?.openFilePicker()}
                getTypeMeta={getTypeMeta}
                getPriorityMeta={getPriorityMeta}
                getStatusMeta={getStatusMeta}
                onUpdateTitle={updateTitle}
                onDelete={() => setConfirmDelete(true)}
              />
            </div>
            <div className="space-y-4 pt-4 lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
              <TaskDescription issue={issue} onUpdateDescription={updateDescription} />
              <EpicRollupPanel
                issueId={issue._id}
                token={token!}
                show={/epic/i.test(issue.type) || subtasks.length > 0}
              />
              <TaskSecondaryTabs
                ref={secondaryTabsRef}
                issue={issue}
                projectId={projectId}
                token={token ?? null}
                subtasks={subtasks}
                getStatusMeta={getStatusMeta}
                links={links}
                onLinksChange={refreshLinks}
                onParentRemoved={() => {
                  if (!token || !projectId || !ticketId) return;
                  issuesApi.getByKey(projectId, decodeURIComponent(ticketId), token).then((res) => {
                    if (res.success && res.data) setIssue(res.data);
                  });
                }}
                attachments={attachments}
                onAttachmentsChange={refreshAttachments}
                currentUserId={user?.id}
              />
              <TaskActivityComments
                issue={issue}
                comments={comments}
                onAddComment={addComment}
                onUpdateComment={updateComment}
                submittingComment={submittingComment}
                editingCommentId={editingCommentId}
                mentionUsers={users}
                workLogs={workLogs}
                currentUserId={user?.id}
                onAddWorkLog={addWorkLog}
                onDeleteWorkLog={deleteWorkLog}
                submittingWorkLog={submittingWorkLog}
              />
            </div>
          </div>

          <TaskDetailsSidebar
              issue={issue}
              project={project}
              projectId={projectId}
              workLogs={workLogs}
              users={
                issue.assignee && typeof issue.assignee === 'object' && !users.some((u) => u._id === issue.assignee!._id)
                  ? [...users, { _id: issue.assignee._id, name: issue.assignee.name ?? 'Unknown', email: issue.assignee.email ?? '' }]
                  : users
              }
              watchers={watchers}
              watching={watching}
              watchingLoading={watchingLoading}
              watchersError={watchersError}
              currentUserId={user?.id}
              onWatch={handleWatch}
              onUnwatch={handleUnwatch}
              statusList={statusList}
              typeList={typeList}
              priorityList={priorityList}
              getTypeMeta={getTypeMeta}
              getPriorityMeta={getPriorityMeta}
              getStatusMeta={getStatusMeta}
              updatingField={updatingField}
              newLabel={newLabel}
              onOpenTimeLog={() => setTimeLogOpen(true)}
              onUpdateField={updateField}
              onUpdateFixVersions={updateFixVersions}
              onUpdateAffectsVersions={updateAffectsVersions}
              onAddLabel={addLabel}
              onRemoveLabel={removeLabel}
              onNewLabelChange={setNewLabel}
              sprints={sprints}
            />
        </div>
      </div>

      {timeLogOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setTimeLogOpen(false)}
          />
          <div className="relative z-50 w-full max-w-md rounded-2xl bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] shadow-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Log time</h2>
                <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">
                  {getIssueKey(issue)} · {issue.title}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTimeLogOpen(false)}
                className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] text-xs"
              >
                ✕
              </button>
            </div>
            <WorkLogInput
              onAdd={async (payload) => {
                await addWorkLog(payload);
                setTimeLogOpen(false);
              }}
              submitting={submittingWorkLog}
            />
          </div>
        </div>
      )}

      {conflictLatest &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => {
              setConflictLatest(null);
              setPendingUpdate(null);
            }}
          >
            <div
              className="w-full max-w-md bg-[color:var(--bg-modal)] border border-[color:var(--border-subtle)] rounded-xl p-6 card-shadow"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-base font-bold text-[color:var(--text-primary)] mb-2">Edit conflict</h2>
              <p className="text-sm text-[color:var(--text-muted)] mb-4">
                Someone else updated this issue while you were editing. Reload their version or overwrite with your
                changes.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConflictLatest(null);
                    setPendingUpdate(null);
                  }}
                  className="btn-secondary px-4 py-2 rounded-lg text-sm"
                >
                  Cancel
                </button>
                <button type="button" onClick={handleConflictReload} className="btn-secondary px-4 py-2 rounded-lg text-sm">
                  Reload latest
                </button>
                <button type="button" onClick={handleConflictOverwrite} className="btn-primary px-4 py-2 rounded-lg text-sm">
                  Overwrite
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      <ConfirmModal
        open={confirmDelete}
        title="Delete issue"
        message={issue ? `Delete "${issue.title}"? This cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      {project && (
        <IssueCreateEditModal
          modal={modalOpen}
          setModal={setModalOpen}
          form={form}
          setForm={setForm}
          submitError={submitError}
          submitting={submittingModal}
          handleSubmit={handleModalSubmit}
          typeList={typeList}
          priorityList={priorityList}
          statusList={statusList}
          users={users}
          parentCandidates={[]} 
          project={project}
          getIssueKey={getIssueKey}
          projects={[project]}
          showProjectSelector={false}
          milestones={[]} 
          sprints={sprints}
          labelSuggestions={[]}
          pendingFiles={pendingFiles}
          onPendingFilesChange={setPendingFiles}
        />
      )}
    </div>
  );
}
