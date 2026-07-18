import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  portalApi,
  type CustomerRequest,
  type TicketHistoryItem,
  type WorkLogByUser,
  type ChildTask,
  type IssueLinkItem,
  type IssuePortalComment,
  type PortalComment,
} from '../../lib/api';
import { userHasPermission } from '../../utils/permissions';
import { CUSTOMER_PERMISSIONS } from '@shared/constants/permissions';
import {
  FiArrowLeft,
  FiCheckCircle,
  FiXCircle,
  FiCircle,
  FiCheck,
  FiX,
  FiClock,
  FiUser,
  FiLink,
  FiMessageSquare,
  FiSend,
  FiList,
} from 'react-icons/fi';

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  switch (status) {
    case 'draft':
      return 'bg-gray-500/15 text-gray-400';
    case 'submitted':
    case 'pending_customer_approval':
    case 'pending_taskflow_approval':
      return 'bg-yellow-500/15 text-yellow-400';
    case 'approved':
    case 'ticket_created':
    case 'in_progress':
      return 'bg-blue-500/15 text-blue-400';
    case 'resolved':
    case 'closed':
      return 'bg-green-500/15 text-green-400';
    case 'rejected':
      return 'bg-red-500/15 text-red-400';
    default:
      return 'bg-gray-500/15 text-gray-400';
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function priorityColor(priority: string): string {
  switch (priority) {
    case 'critical': return 'text-red-400 bg-red-500/10 border-red-500/30';
    case 'high': return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
    case 'medium': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
    case 'low': return 'text-green-400 bg-green-500/10 border-green-500/30';
    default: return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
  }
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMinutes(minutes: number): string {
  if (!minutes || minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

// ── Timeline ─────────────────────────────────────────────────────────────────

type StepStatus = 'completed' | 'failed' | 'pending' | 'skipped';

interface TimelineStep {
  label: string;
  status: StepStatus;
  date?: string;
  reviewer?: string;
  note?: string;
}

function TimelineItem({ step, isLast }: { step: TimelineStep; isLast: boolean }) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border-2 ${
            step.status === 'completed'
              ? 'border-green-500 bg-green-500/15 text-green-400'
              : step.status === 'failed'
              ? 'border-red-500 bg-red-500/15 text-red-400'
              : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)]'
          }`}
        >
          {step.status === 'completed' ? (
            <FiCheck className="text-sm" />
          ) : step.status === 'failed' ? (
            <FiX className="text-sm" />
          ) : (
            <FiCircle className="text-sm opacity-40" />
          )}
        </div>
        {!isLast && (
          <div className="flex-1 w-0.5 my-1 bg-[color:var(--border-subtle)] min-h-[1.5rem]" />
        )}
      </div>
      <div className="pb-5 min-w-0 flex-1">
        <p
          className={`text-sm font-medium ${
            step.status === 'completed'
              ? 'text-[color:var(--text-primary)]'
              : step.status === 'failed'
              ? 'text-red-400'
              : 'text-[color:var(--text-muted)]'
          }`}
        >
          {step.label}
        </p>
        {step.date && (
          <p className="text-xs text-[color:var(--text-muted)] mt-0.5">{formatDate(step.date)}</p>
        )}
        {step.reviewer && (
          <p className="text-xs text-[color:var(--text-muted)] mt-0.5">by {step.reviewer}</p>
        )}
        {step.note && (
          <p className="text-xs text-[color:var(--text-muted)] mt-1 italic">"{step.note}"</p>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const bottomRef = useRef<HTMLDivElement>(null);

  const [request, setRequest] = useState<CustomerRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Approve / Reject
  const [approveNote, setApproveNote] = useState('');
  const [approvingReq, setApprovingReq] = useState(false);
  const [approveError, setApproveError] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState('');

  // Portal comment
  const [commentBody, setCommentBody] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [commentError, setCommentError] = useState('');

  function loadRequest() {
    if (!token || !id) return;
    setLoading(true);
    portalApi.getRequest(id, token).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setRequest(res.data.request);
      } else {
        setError((res as { message?: string }).message ?? 'Failed to load request');
      }
    });
  }

  useEffect(() => {
    loadRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  async function handleApprove() {
    if (!token || !id) return;
    setApprovingReq(true);
    setApproveError('');
    const res = await portalApi.approveRequest(id, approveNote || undefined, token);
    setApprovingReq(false);
    if (res.success) {
      loadRequest();
      setApproveNote('');
    } else {
      setApproveError((res as { message?: string }).message ?? 'Approve failed');
    }
  }

  async function handleReject() {
    if (!token || !id || !rejectReason.trim()) return;
    setRejecting(true);
    setRejectError('');
    const res = await portalApi.rejectRequest(id, rejectReason.trim(), rejectNote || undefined, token);
    setRejecting(false);
    if (res.success) {
      setShowRejectModal(false);
      setRejectReason('');
      setRejectNote('');
      loadRequest();
    } else {
      setRejectError((res as { message?: string }).message ?? 'Reject failed');
    }
  }

  async function handleSendComment() {
    if (!token || !id || !commentBody.trim()) return;
    setSubmittingComment(true);
    setCommentError('');
    const res = await portalApi.addPortalComment(id, commentBody.trim(), token);
    setSubmittingComment(false);
    if (res.success) {
      setCommentBody('');
      loadRequest();
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 300);
    } else {
      setCommentError((res as { message?: string }).message ?? 'Failed to send comment');
    }
  }

  const canApprove =
    user?.isOrgAdmin &&
    userHasPermission(user?.customerPermissions ?? [], CUSTOMER_PERMISSIONS.LEGACY.REQUEST.APPROVE) &&
    request?.approvalFlow?.customerAdminStage?.status === 'pending' &&
    request?.approvalFlow?.customerAdminStage?.required;

  function buildTimeline(req: CustomerRequest): TimelineStep[] {
    const steps: TimelineStep[] = [];

    steps.push({ label: 'Submitted', status: 'completed', date: req.createdAt });

    if (req.approvalFlow.customerAdminStage.required) {
      const cs = req.approvalFlow.customerAdminStage;
      steps.push({
        label: 'Customer Admin Approval',
        status: cs.status === 'approved' ? 'completed' : cs.status === 'rejected' ? 'failed' : 'pending',
        date: cs.reviewedAt,
        reviewer: cs.reviewedBy?.name,
        note: cs.note,
      });
    }

    const ts = req.approvalFlow.taskflowStage;
    const tsStatus: StepStatus =
      ts.status === 'approved' ? 'completed' : ts.status === 'rejected' ? 'failed' : 'pending';
    steps.push({
      label: 'Atrium Approval',
      status: tsStatus,
      date: ts.reviewedAt,
      reviewer: ts.reviewedBy?.name,
      note: ts.note,
    });

    if (req.linkedIssueKey) {
      steps.push({ label: `Ticket Created — ${req.linkedIssueKey}`, status: 'completed' });
    } else {
      steps.push({
        label: 'Ticket Created',
        status: tsStatus === 'completed' ? 'pending' : 'skipped',
      });
    }

    const finalStatus: StepStatus =
      req.status === 'resolved' || req.status === 'closed' ? 'completed' : 'pending';
    steps.push({
      label:
        req.status === 'resolved' ? 'Resolved' : req.status === 'closed' ? 'Closed' : 'In Progress / Resolved',
      status: finalStatus,
      date: req.status === 'resolved' || req.status === 'closed' ? req.updatedAt : undefined,
    });

    return steps;
  }

  // Build unified communication feed
  function buildCommunicationFeed(req: CustomerRequest): Array<{
    id: string;
    body: string;
    authorName: string;
    direction: 'from-team' | 'from-requester';
    forwardedToIssue?: boolean;
    createdAt: string;
  }> {
    const items: Array<{
      id: string;
      body: string;
      authorName: string;
      direction: 'from-team' | 'from-requester';
      forwardedToIssue?: boolean;
      createdAt: string;
    }> = [];

    // Team → requester (issue comments with @requ)
    const teamComments: IssuePortalComment[] = req.ticketDetails?.portalVisibleComments ?? [];
    for (const c of teamComments) {
      items.push({
        id: c._id,
        body: c.body,
        authorName: c.author?.name ?? 'Team',
        direction: 'from-team',
        createdAt: c.createdAt,
      });
    }

    // Requester → team (portal comments)
    const portalComments: PortalComment[] = req.portalComments ?? [];
    for (const c of portalComments) {
      items.push({
        id: c._id ?? c.createdAt,
        body: c.body,
        authorName: c.authorName,
        direction: 'from-requester',
        forwardedToIssue: c.forwardedToIssue,
        createdAt: c.createdAt,
      });
    }

    return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  const project = request ? (typeof request.projectId === 'object' ? request.projectId : null) : null;
  const createdBy = request ? (typeof request.createdBy === 'object' ? request.createdBy : null) : null;
  const timeline = request ? buildTimeline(request) : [];
  const hasTicket = !!(request?.linkedIssueId);
  const td = request?.ticketDetails;
  const linkedIssue = request?.linkedIssue;
  const communicationFeed = request ? buildCommunicationFeed(request) : [];

  const inputClass =
    'w-full rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-4 py-3 text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] transition focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30';

  // Helpers for assignee history with time logged
  function buildAssigneeHistory() {
    if (!td) return [];
    const assigneeChanges = td.assigneeHistory ?? [];
    const wlByUser: WorkLogByUser[] = td.workLogByUser ?? [];

    // Build a list of assigned persons in order
    const result: Array<{
      name: string;
      fromDate?: string;
      toDate?: string;
      minutesLogged: number;
      isCurrent: boolean;
    }> = [];

    for (let i = 0; i < assigneeChanges.length; i++) {
      const change = assigneeChanges[i];
      const nextChange = assigneeChanges[i + 1];
      const assigneeName = change.toValue ?? 'Unknown';
      const wl = wlByUser.find(
        (w) => w.authorName?.toLowerCase() === assigneeName.toLowerCase()
      );
      result.push({
        name: assigneeName,
        fromDate: change.createdAt,
        toDate: nextChange?.createdAt,
        minutesLogged: wl?.totalMinutes ?? 0,
        isCurrent: i === assigneeChanges.length - 1,
      });
    }

    // If there's a current assignee from the issue but no history entry for them
    if (linkedIssue?.assignee && (result.length === 0 || result[result.length - 1]?.isCurrent)) {
      const currentName = linkedIssue.assignee.name;
      if (result.length === 0 || result[result.length - 1].name !== currentName) {
        const wl = wlByUser.find((w) => w.authorName === currentName);
        result.push({
          name: currentName,
          minutesLogged: wl?.totalMinutes ?? 0,
          isCurrent: true,
        });
      }
    }

    return result;
  }

  const assigneeHistory = buildAssigneeHistory();

  return (
    <div className="p-8 animate-fade-in">
      {/* Back button */}
      <button
        type="button"
        onClick={() => navigate('/portal/requests')}
        className="flex items-center gap-2 text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition mb-6"
      >
        <FiArrowLeft /> Back to Requests
      </button>

      {loading ? (
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-12 text-center text-[color:var(--text-muted)] animate-pulse">
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-400">{error}</div>
      ) : request ? (
        <>
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">{request.title}</h1>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(request.status)}`}>
                  {statusLabel(request.status)}
                </span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${priorityColor(request.priority)}`}>
                  {request.priority}
                </span>
                <span className="text-xs text-[color:var(--text-muted)] capitalize">{request.type}</span>
              </div>
            </div>
          </div>

          {/* Main grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* ── Left column ── */}
            <div className="lg:col-span-2 space-y-4">
              {/* Request Details */}
              <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
                <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4">Request Details</h2>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <dt className="text-[color:var(--text-muted)]">Project</dt>
                    <dd className="text-[color:var(--text-primary)] font-medium mt-0.5">
                      {project ? `${project.name} (${project.key})` : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[color:var(--text-muted)]">Submitted by</dt>
                    <dd className="text-[color:var(--text-primary)] font-medium mt-0.5">
                      {createdBy ? createdBy.name : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[color:var(--text-muted)]">Created</dt>
                    <dd className="text-[color:var(--text-primary)] mt-0.5">{formatDate(request.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-[color:var(--text-muted)]">Updated</dt>
                    <dd className="text-[color:var(--text-primary)] mt-0.5">{formatDate(request.updatedAt)}</dd>
                  </div>
                  {request.linkedIssueKey && (
                    <div className="col-span-2">
                      <dt className="text-[color:var(--text-muted)]">Linked Ticket</dt>
                      <dd className="text-[color:var(--accent)] font-medium mt-0.5">{request.linkedIssueKey}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Description */}
              <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
                <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-3">Description</h2>
                <p className="text-sm text-[color:var(--text-muted)] whitespace-pre-wrap leading-relaxed">
                  {request.description}
                </p>
              </div>

              {/* ── Ticket Details (when ticket is created) ── */}
              {hasTicket && linkedIssue && (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4 flex items-center gap-2">
                    <FiList className="text-[color:var(--accent)]" />
                    Ticket Info — {request.linkedIssueKey}
                  </h2>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                    <div>
                      <p className="text-[color:var(--text-muted)]">Status</p>
                      <p className="mt-0.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(linkedIssue.status)}`}>
                          {linkedIssue.status}
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[color:var(--text-muted)]">Current Assignee</p>
                      <p className="text-[color:var(--text-primary)] font-medium mt-0.5 flex items-center gap-1">
                        <FiUser className="shrink-0 text-[color:var(--text-muted)]" />
                        {linkedIssue.assignee?.name ?? '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[color:var(--text-muted)]">Estimate</p>
                      <p className="text-[color:var(--text-primary)] mt-0.5 flex items-center gap-1">
                        <FiClock className="shrink-0 text-[color:var(--text-muted)]" />
                        {linkedIssue.timeEstimateMinutes
                          ? formatMinutes(linkedIssue.timeEstimateMinutes)
                          : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[color:var(--text-muted)]">Total Logged Time</p>
                      <p className="text-[color:var(--text-primary)] mt-0.5 flex items-center gap-1">
                        <FiClock className="shrink-0 text-[color:var(--text-muted)]" />
                        {td ? formatMinutes(td.totalLoggedMinutes) : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Assignee History ── */}
              {hasTicket && assigneeHistory.length > 0 && (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4 flex items-center gap-2">
                    <FiUser className="text-[color:var(--accent)]" />
                    Assignee History
                  </h2>
                  <div className="space-y-2">
                    {assigneeHistory.map((entry, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between py-2 px-3 rounded-lg bg-[color:var(--bg-elevated)]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-7 h-7 rounded-full bg-[color:var(--accent)]/20 flex items-center justify-center shrink-0">
                            <span className="text-xs font-medium text-[color:var(--accent)]">
                              {entry.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-[color:var(--text-primary)] truncate">
                              {entry.name}
                            </p>
                            {entry.fromDate && (
                              <p className="text-xs text-[color:var(--text-muted)]">
                                Assigned {formatDate(entry.fromDate)}
                                {entry.toDate ? ` → ${formatDate(entry.toDate)}` : ''}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {entry.minutesLogged > 0 && (
                            <span className="text-xs text-[color:var(--text-muted)] flex items-center gap-1">
                              <FiClock className="text-xs" />
                              {formatMinutes(entry.minutesLogged)} logged
                            </span>
                          )}
                          {entry.isCurrent && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-[color:var(--accent)]/15 text-[color:var(--accent)] font-medium">
                              Current
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Child Tasks ── */}
              {hasTicket && (td?.childTasks ?? []).length > 0 && (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4 flex items-center gap-2">
                    <FiList className="text-[color:var(--accent)]" />
                    Child Tasks ({td!.childTasks.length})
                  </h2>
                  <div className="space-y-2">
                    {(td!.childTasks as ChildTask[]).map((child) => (
                      <div
                        key={child._id}
                        className="flex items-center justify-between py-2 px-3 rounded-lg bg-[color:var(--bg-elevated)] gap-3"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          {child.key && (
                            <span className="text-xs font-mono text-[color:var(--accent)] shrink-0">
                              {child.key}
                            </span>
                          )}
                          <span className="text-sm text-[color:var(--text-primary)] truncate">{child.title}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(child.status)}`}>
                            {child.status}
                          </span>
                          {child.assignee && (
                            <span className="text-xs text-[color:var(--text-muted)]">{child.assignee.name}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Linked Issues ── */}
              {hasTicket && (td?.issueLinks ?? []).length > 0 && (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4 flex items-center gap-2">
                    <FiLink className="text-[color:var(--accent)]" />
                    Linked Issues ({td!.issueLinks.length})
                  </h2>
                  <div className="space-y-2">
                    {(td!.issueLinks as IssueLinkItem[]).map((link) => {
                      const isSource = link.sourceIssue._id === linkedIssue?._id;
                      const related = isSource ? link.targetIssue : link.sourceIssue;
                      const linkLabel = link.linkType.replace(/_/g, ' ');
                      return (
                        <div
                          key={link._id}
                          className="flex items-center justify-between py-2 px-3 rounded-lg bg-[color:var(--bg-elevated)] gap-3"
                        >
                          <div className="min-w-0 flex items-center gap-2">
                            <span className="text-xs text-[color:var(--text-muted)] shrink-0 capitalize">
                              {linkLabel}
                            </span>
                            {related.key && (
                              <span className="text-xs font-mono text-[color:var(--accent)] shrink-0">
                                {related.key}
                              </span>
                            )}
                            <span className="text-sm text-[color:var(--text-primary)] truncate">{related.title}</span>
                          </div>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${statusColor(related.status)}`}>
                            {related.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Ticket History ── */}
              {hasTicket && (td?.issueHistory ?? []).length > 0 && (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4 flex items-center gap-2">
                    <FiClock className="text-[color:var(--accent)]" />
                    Ticket History
                  </h2>
                  <div className="space-y-0">
                    {(td!.issueHistory as TicketHistoryItem[]).map((item, idx) => (
                      <div key={item._id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className="w-2 h-2 rounded-full bg-[color:var(--accent)]/60 mt-1.5 shrink-0" />
                          {idx < td!.issueHistory.length - 1 && (
                            <div className="flex-1 w-px bg-[color:var(--border-subtle)] my-1 min-h-[1rem]" />
                          )}
                        </div>
                        <div className="pb-3 min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <p className="text-sm text-[color:var(--text-primary)]">
                              {item.action === 'created' && (
                                <span>
                                  <span className="font-medium">{item.author.name}</span> created the ticket
                                </span>
                              )}
                              {item.action === 'field_change' && (
                                <span>
                                  <span className="font-medium">{item.author.name}</span> changed{' '}
                                  <span className="font-medium">{item.field}</span>
                                  {item.fromValue && item.fromValue !== 'None' ? (
                                    <span>
                                      {' '}from{' '}
                                      <span className="text-[color:var(--text-muted)] line-through">{item.fromValue}</span>
                                      {' '}to{' '}
                                      <span className="text-[color:var(--accent)]">{item.toValue ?? '—'}</span>
                                    </span>
                                  ) : (
                                    <span>
                                      {' '}to{' '}
                                      <span className="text-[color:var(--accent)]">{item.toValue ?? '—'}</span>
                                    </span>
                                  )}
                                </span>
                              )}
                              {item.action === 'comment_added' && (
                                <span>
                                  <span className="font-medium">{item.author.name}</span> added a comment
                                </span>
                              )}
                              {item.action === 'comment_updated' && (
                                <span>
                                  <span className="font-medium">{item.author.name}</span> edited a comment
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-[color:var(--text-muted)] shrink-0">{formatDate(item.createdAt)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Communication (portal ↔ issue comments) ── */}
              {hasTicket && (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-1 flex items-center gap-2">
                    <FiMessageSquare className="text-[color:var(--accent)]" />
                    Communication
                  </h2>
                  <p className="text-xs text-[color:var(--text-muted)] mb-4">
                    Messages tagged <code className="bg-[color:var(--bg-elevated)] px-1 rounded">@requ</code> by the team appear here.
                    Use <code className="bg-[color:var(--bg-elevated)] px-1 rounded">@issue</code> in your message to forward it to the team.
                  </p>

                  {communicationFeed.length === 0 ? (
                    <p className="text-sm text-[color:var(--text-muted)] text-center py-4">
                      No messages yet.
                    </p>
                  ) : (
                    <div className="space-y-3 mb-4">
                      {communicationFeed.map((msg) => (
                        <div
                          key={msg.id}
                          className={`rounded-lg p-3 text-sm ${
                            msg.direction === 'from-requester'
                              ? 'ml-8 bg-[color:var(--accent)]/10 border border-[color:var(--accent)]/20'
                              : 'mr-8 bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-medium text-xs text-[color:var(--text-primary)]">
                              {msg.direction === 'from-requester' ? 'You' : msg.authorName}
                            </span>
                            <div className="flex items-center gap-2">
                              {msg.direction === 'from-requester' && msg.forwardedToIssue && (
                                <span className="text-xs text-[color:var(--accent)] flex items-center gap-1">
                                  <FiLink className="text-xs" /> Sent to team
                                </span>
                              )}
                              {msg.direction === 'from-team' && (
                                <span className="text-xs text-[color:var(--text-muted)] flex items-center gap-1">
                                  Team
                                </span>
                              )}
                              <span className="text-xs text-[color:var(--text-muted)]">
                                {formatDate(msg.createdAt)}
                              </span>
                            </div>
                          </div>
                          <p className="text-[color:var(--text-primary)] whitespace-pre-wrap break-words">
                            {stripHtml(msg.body)}
                          </p>
                        </div>
                      ))}
                      <div ref={bottomRef} />
                    </div>
                  )}

                  {/* Comment input */}
                  {commentError && (
                    <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                      {commentError}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <textarea
                      rows={2}
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendComment();
                        }
                      }}
                      placeholder="Write a message… use @issue to send to the team"
                      className={`${inputClass} resize-none flex-1`}
                    />
                    <button
                      type="button"
                      onClick={handleSendComment}
                      disabled={submittingComment || !commentBody.trim()}
                      className="btn-primary flex items-center gap-2 text-sm shrink-0 self-end"
                    >
                      <FiSend />
                      {submittingComment ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                </div>
              )}

              {/* Approve / Reject actions */}
              {canApprove && (
                <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-5">
                  <h2 className="text-sm font-semibold text-yellow-400 mb-3">Review this Request</h2>
                  {approveError && (
                    <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                      {approveError}
                    </div>
                  )}
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-[color:var(--text-muted)] mb-1">
                      Approval note (optional)
                    </label>
                    <textarea
                      rows={2}
                      value={approveNote}
                      onChange={(e) => setApproveNote(e.target.value)}
                      placeholder="Add a note for your approval…"
                      className={`${inputClass} resize-none text-xs`}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleApprove}
                      disabled={approvingReq}
                      className="btn-primary flex items-center gap-2 text-sm"
                    >
                      <FiCheckCircle />
                      {approvingReq ? 'Approving…' : 'Approve'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowRejectModal(true)}
                      disabled={approvingReq}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/10 text-sm text-red-400 hover:bg-red-500/20 transition"
                    >
                      <FiXCircle />
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Right column ── */}
            <div className="space-y-4">
              {/* Approval Timeline */}
              <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
                <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4">Approval Timeline</h2>
                <div>
                  {timeline.map((step, i) => (
                    <TimelineItem key={i} step={step} isLast={i === timeline.length - 1} />
                  ))}
                </div>
              </div>

              {/* Linked Ticket card */}
              {request.linkedIssueKey && (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-3">Linked Ticket</h2>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-md border border-[color:var(--border-subtle)] text-xs font-mono font-semibold text-[color:var(--accent)]">
                      {request.linkedIssueKey}
                    </span>
                    {linkedIssue && (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(linkedIssue.status)}`}>
                        {linkedIssue.status}
                      </span>
                    )}
                  </div>
                  {linkedIssue && (
                    <dl className="space-y-2 text-xs">
                      {linkedIssue.assignee && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-[color:var(--text-muted)]">Assignee</dt>
                          <dd className="text-[color:var(--text-primary)] font-medium">{linkedIssue.assignee.name}</dd>
                        </div>
                      )}
                      {linkedIssue.timeEstimateMinutes != null && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-[color:var(--text-muted)]">Estimate</dt>
                          <dd className="text-[color:var(--text-primary)]">{formatMinutes(linkedIssue.timeEstimateMinutes)}</dd>
                        </div>
                      )}
                      {td && td.totalLoggedMinutes > 0 && (
                        <div className="flex justify-between gap-2">
                          <dt className="text-[color:var(--text-muted)]">Logged</dt>
                          <dd className="text-[color:var(--text-primary)]">{formatMinutes(td.totalLoggedMinutes)}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}

      {/* Reject modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] p-6 shadow-2xl animate-scale-in">
            <h3 className="text-base font-semibold text-[color:var(--text-primary)] mb-4">Reject Request</h3>
            {rejectError && (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {rejectError}
              </div>
            )}
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">
                  Reason <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Enter rejection reason…"
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">
                  Additional note (optional)
                </label>
                <textarea
                  rows={3}
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="Any additional context…"
                  className={`${inputClass} resize-none`}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 mt-5">
              <button
                type="button"
                onClick={() => { setShowRejectModal(false); setRejectError(''); }}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReject}
                disabled={rejecting || !rejectReason.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition"
              >
                <FiXCircle />
                {rejecting ? 'Rejecting…' : 'Reject Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
