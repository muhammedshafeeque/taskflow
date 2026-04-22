import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
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
import type { TaskSecondaryTabsHandle } from '../components/issue/TaskSecondaryTabs';

const DEFAULT_STATUSES = ['Backlog', 'Todo', 'In Progress', 'Done'];
const DEFAULT_TYPES = ['Task', 'Bug', 'Story', 'Epic'];
const DEFAULT_PRIORITIES = ['Lowest', 'Low', 'Medium', 'High', 'Highest'];

export default function IssueDetail() {
  const { projectId, ticketId } = useParams<{ projectId?: string; ticketId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { token, user } = useAuth();
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
  const [submittingWorkLog, setSubmittingWorkLog] = useState(false);
  const [updatingField, setUpdatingField] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [timeLogOpen, setTimeLogOpen] = useState(false);
  const [sprints, setSprints] = useState<Sprint[]>([]);

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
    fixVersion: '',
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
          fixVersion: form.fixVersion || undefined,
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

  async function updateIssue(payload: Parameters<typeof issuesApi.update>[1]) {
    if (!token || !issue?._id || !issue) return;
    const res = await issuesApi.update(issue._id, payload, token);
    if (res.success && res.data) setIssue(res.data);
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
      | 'fixVersion'
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

  if (loading || !issue) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-8">
        {loading ? (
          <div className="text-[color:var(--text-muted)] animate-pulse">Loading…</div>
        ) : (
          <div className="text-[color:var(--text-muted)]">Issue not found.</div>
        )}
      </div>
    );
  }

  const projectName = typeof issue.project === 'object' && issue.project ? issue.project.name : '';

  return (
    <div className="h-full flex flex-col animate-fade-in">
      <div className="flex-1 overflow-auto">
        <div className="w-full max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(260px,340px)] gap-6">
            <div className="min-w-0 space-y-4">
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
              />
              <TaskDescription issue={issue} onUpdateDescription={updateDescription} />
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
                submittingComment={submittingComment}
                mentionUsers={users}
                workLogs={workLogs}
                currentUserId={user?.id}
                onAddWorkLog={addWorkLog}
                onDeleteWorkLog={deleteWorkLog}
                submittingWorkLog={submittingWorkLog}
              />
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
              onUpdateAffectsVersions={updateAffectsVersions}
              onAddLabel={addLabel}
              onRemoveLabel={removeLabel}
              onNewLabelChange={setNewLabel}
              sprints={sprints}
            />
          </div>
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
