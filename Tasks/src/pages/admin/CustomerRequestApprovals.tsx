import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { adminCustomerApi, type CustomerRequest } from '../../lib/api';
import {
  FiCheckCircle,
  FiXCircle,
  FiX,
  FiInbox,
  FiList,
  FiGrid,
  FiFilter,
  FiEye,
  FiRefreshCw,
} from 'react-icons/fi';

// ── Helpers ───────────────────────────────────────────────────────────────────

function priorityColor(priority: string): string {
  switch (priority) {
    case 'critical': return 'text-red-400 bg-red-500/10 border-red-500/30';
    case 'high':     return 'text-orange-400 bg-orange-500/10 border-orange-500/30';
    case 'medium':   return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30';
    case 'low':      return 'text-green-400 bg-green-500/10 border-green-500/30';
    default:         return 'text-gray-400 bg-gray-500/10 border-gray-500/30';
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'draft':                    return 'bg-gray-500/15 text-gray-400';
    case 'submitted':
    case 'pending_customer_approval':
    case 'pending_taskflow_approval': return 'bg-yellow-500/15 text-yellow-400';
    case 'approved':
    case 'ticket_created':
    case 'in_progress':              return 'bg-blue-500/15 text-blue-400';
    case 'resolved':
    case 'closed':                   return 'bg-green-500/15 text-green-400';
    case 'rejected':                 return 'bg-red-500/15 text-red-400';
    default:                         return 'bg-gray-500/15 text-gray-400';
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function orgName(req: CustomerRequest): string {
  return typeof req.customerOrgId === 'object' ? req.customerOrgId.name : req.customerOrgId;
}

function createdByName(req: CustomerRequest): string {
  return typeof req.createdBy === 'object' ? req.createdBy.name : req.createdBy;
}

function projectLabel(req: CustomerRequest): string {
  return typeof req.projectId === 'object' ? `${req.projectId.name} (${req.projectId.key})` : req.projectId;
}

const ALL_STATUSES = [
  'pending_taskflow_approval',
  'pending_customer_approval',
  'ticket_created',
  'in_progress',
  'approved',
  'resolved',
  'closed',
  'rejected',
  'draft',
  'submitted',
];

// ── Detail / Review Panel ────────────────────────────────────────────────────

interface PanelProps {
  request: CustomerRequest;
  onClose: () => void;
  onDone: () => void;
  token: string;
}

function RequestDetailPanel({ request, onClose, onDone, token }: PanelProps) {
  const isPendingTf = request.status === 'pending_taskflow_approval';

  const [approveNote, setApproveNote] = useState('');
  const [approving, setApproving]     = useState(false);
  const [approveError, setApproveError] = useState('');

  const [rejectReason, setRejectReason] = useState('');
  const [rejectNote, setRejectNote]     = useState('');
  const [rejecting, setRejecting]       = useState(false);
  const [rejectError, setRejectError]   = useState('');

  const inputClass =
    'w-full rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-4 py-3 text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] transition focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30';

  async function handleApprove() {
    setApproving(true);
    setApproveError('');
    const res = await adminCustomerApi.approveRequest(request._id, approveNote || undefined, token);
    setApproving(false);
    if (res.success) onDone();
    else setApproveError((res as { message?: string }).message ?? 'Approve failed');
  }

  async function handleReject() {
    if (!rejectReason.trim()) return;
    setRejecting(true);
    setRejectError('');
    const res = await adminCustomerApi.rejectRequest(request._id, rejectReason.trim(), rejectNote || undefined, token);
    setRejecting(false);
    if (res.success) onDone();
    else setRejectError((res as { message?: string }).message ?? 'Reject failed');
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] p-6 shadow-2xl animate-scale-in max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h3 className="text-base font-semibold text-[color:var(--text-primary)]">{request.title}</h3>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(request.status)}`}>
                {statusLabel(request.status)}
              </span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${priorityColor(request.priority)}`}>
                {request.priority}
              </span>
              <span className="text-xs text-[color:var(--text-muted)] capitalize">{request.type}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition shrink-0">
            <FiX />
          </button>
        </div>

        {/* Info grid */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mb-5">
          <div>
            <dt className="text-[color:var(--text-muted)]">Organisation</dt>
            <dd className="text-[color:var(--text-primary)] font-medium mt-0.5">{orgName(request)}</dd>
          </div>
          <div>
            <dt className="text-[color:var(--text-muted)]">Project</dt>
            <dd className="text-[color:var(--text-primary)] font-medium mt-0.5">{projectLabel(request)}</dd>
          </div>
          <div>
            <dt className="text-[color:var(--text-muted)]">Submitted by</dt>
            <dd className="text-[color:var(--text-primary)] font-medium mt-0.5">
              {typeof request.createdBy === 'object'
                ? `${request.createdBy.name} (${request.createdBy.email})`
                : request.createdBy}
            </dd>
          </div>
          <div>
            <dt className="text-[color:var(--text-muted)]">Created</dt>
            <dd className="text-[color:var(--text-primary)] mt-0.5">{formatDate(request.createdAt)}</dd>
          </div>
          {request.linkedIssueKey && (
            <div className="col-span-2">
              <dt className="text-[color:var(--text-muted)]">Linked Ticket</dt>
              <dd className="text-[color:var(--accent)] font-medium mt-0.5">{request.linkedIssueKey}</dd>
            </div>
          )}
        </dl>

        {/* Description */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-[color:var(--text-muted)] uppercase tracking-wide mb-2">Description</p>
          <p className="text-sm text-[color:var(--text-primary)] whitespace-pre-wrap leading-relaxed bg-[color:var(--bg-elevated)] rounded-lg p-3 border border-[color:var(--border-subtle)]">
            {request.description || '—'}
          </p>
        </div>

        {/* Approval actions — only for pending_taskflow_approval */}
        {isPendingTf ? (
          <>
            <div className="border border-[color:var(--border-subtle)] rounded-xl p-4 mb-4">
              <p className="text-sm font-semibold text-[color:var(--text-primary)] mb-3">Approve Request</p>
              {approveError && (
                <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{approveError}</div>
              )}
              <textarea
                rows={2}
                value={approveNote}
                onChange={(e) => setApproveNote(e.target.value)}
                placeholder="Optional note for approval…"
                className={`${inputClass} resize-none text-xs mb-3`}
              />
              <button
                type="button"
                onClick={handleApprove}
                disabled={approving || rejecting}
                className="btn-primary text-sm flex items-center gap-2"
              >
                <FiCheckCircle /> {approving ? 'Approving…' : 'Approve & Create Ticket'}
              </button>
            </div>

            <div className="border border-red-500/20 rounded-xl p-4 bg-red-500/5">
              <p className="text-sm font-semibold text-red-400 mb-3">Reject Request</p>
              {rejectError && (
                <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{rejectError}</div>
              )}
              <div className="space-y-3">
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Rejection reason (required)…"
                  className={inputClass}
                />
                <textarea
                  rows={2}
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="Additional note (optional)…"
                  className={`${inputClass} resize-none`}
                />
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={rejecting || approving || !rejectReason.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-50 transition"
                >
                  <FiXCircle /> {rejecting ? 'Rejecting…' : 'Reject Request'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] px-4 py-3 text-sm text-[color:var(--text-muted)] text-center">
            This request has already been processed and cannot be reviewed again.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type ViewMode = 'table' | 'card';

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'pending_taskflow_approval', label: 'Pending Atrium Approval' },
  { value: 'pending_customer_approval', label: 'Pending Customer Approval' },
  { value: 'ticket_created', label: 'Ticket Created' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'approved', label: 'Approved' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'rejected', label: 'Rejected' },
];

export default function CustomerRequestApprovals() {
  const { token, user } = useAuth();
  const [requests, setRequests]       = useState<CustomerRequest[]>([]);
  const [total, setTotal]             = useState(0);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [selectedRequest, setSelectedRequest] = useState<CustomerRequest | null>(null);

  const [statusFilter, setStatusFilter] = useState('');
  const [viewMode, setViewMode]         = useState<ViewMode>('table');

  function loadRequests() {
    if (!token) return;
    setLoading(true);
    adminCustomerApi
      .listAllRequests(token, statusFilter ? { status: statusFilter } : undefined)
      .then((res) => {
        setLoading(false);
        if (res.success && res.data) {
          setRequests(res.data.requests);
          setTotal(res.data.total);
        } else {
          setError((res as { message?: string }).message ?? 'Failed to load requests');
        }
      });
  }

  useEffect(() => { loadRequests(); }, [token, statusFilter, user?.activeOrganizationId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleDone() {
    setSelectedRequest(null);
    loadRequests();
  }

  // Count per status for filter badges
  const countByStatus = ALL_STATUSES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = requests.filter((r) => r.status === s).length;
    return acc;
  }, {});
  const pendingCount = countByStatus['pending_taskflow_approval'] ?? 0;

  return (
    <div className="p-8 animate-fade-in">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">Customer Requests</h1>
          <p className="text-sm text-[color:var(--text-muted)] mt-1">
            All requests from customer organisations
            {pendingCount > 0 && (
              <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-yellow-500/15 text-yellow-400">
                {pendingCount} pending review
              </span>
            )}
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Refresh */}
          <button
            type="button"
            onClick={loadRequests}
            disabled={loading}
            className="p-2 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition disabled:opacity-50"
            title="Refresh"
          >
            <FiRefreshCw className={loading ? 'animate-spin' : ''} />
          </button>

          {/* View toggle */}
          <div className="flex items-center rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`p-2 transition ${viewMode === 'table' ? 'bg-[color:var(--accent)]/15 text-[color:var(--accent)]' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'}`}
              title="Table view"
            >
              <FiList />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('card')}
              className={`p-2 transition ${viewMode === 'card' ? 'bg-[color:var(--accent)]/15 text-[color:var(--accent)]' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'}`}
              title="Card view"
            >
              <FiGrid />
            </button>
          </div>
        </div>
      </div>

      {/* Status filter chips */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        <FiFilter className="text-[color:var(--text-muted)] shrink-0 text-sm" />
        {STATUS_FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setStatusFilter(opt.value)}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition ${
              statusFilter === opt.value
                ? 'bg-[color:var(--accent)] border-[color:var(--accent)] text-white'
                : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:border-[color:var(--accent)]/50'
            }`}
          >
            {opt.label}
            {opt.value === '' && total > 0 && (
              <span className="opacity-70">{total}</span>
            )}
            {opt.value !== '' && !loading && (
              <span className="opacity-70">{countByStatus[opt.value] ?? 0}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-12 text-center text-[color:var(--text-muted)] animate-pulse">
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-400">{error}</div>
      ) : requests.length === 0 ? (
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-12 text-center">
          <FiInbox className="mx-auto text-4xl text-[color:var(--text-muted)] mb-3" />
          <p className="text-sm text-[color:var(--text-muted)]">
            {statusFilter ? `No ${statusLabel(statusFilter)} requests found.` : 'No requests found.'}
          </p>
        </div>
      ) : viewMode === 'table' ? (
        /* ── Table view ── */
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] flex items-center justify-between">
            <span className="text-xs font-medium text-[color:var(--text-muted)]">
              {total} request{total !== 1 ? 's' : ''}
              {statusFilter && ` · ${statusLabel(statusFilter)}`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
                  <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Title</th>
                  <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Organisation</th>
                  <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Priority</th>
                  <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Type</th>
                  <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Requested By</th>
                  <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Date</th>
                  <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--border-subtle)]">
                {requests.map((req) => (
                  <tr
                    key={req._id}
                    className="hover:bg-[color:var(--bg-elevated)] transition cursor-pointer"
                    onClick={() => setSelectedRequest(req)}
                  >
                    <td className="px-4 py-3 max-w-xs">
                      <p className="font-medium text-[color:var(--text-primary)] truncate">{req.title}</p>
                      {req.linkedIssueKey && (
                        <p className="text-xs text-[color:var(--accent)] mt-0.5">{req.linkedIssueKey}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[color:var(--text-muted)] whitespace-nowrap">{orgName(req)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(req.status)}`}>
                        {statusLabel(req.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${priorityColor(req.priority)}`}>
                        {req.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 capitalize text-[color:var(--text-muted)]">{req.type}</td>
                    <td className="px-4 py-3 text-[color:var(--text-muted)] whitespace-nowrap">{createdByName(req)}</td>
                    <td className="px-4 py-3 text-[color:var(--text-muted)] whitespace-nowrap">{formatDate(req.createdAt)}</td>
                    <td className="px-4 py-3">
                      {req.status === 'pending_taskflow_approval' ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedRequest(req); }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-yellow-500/40 bg-yellow-500/10 text-xs text-yellow-400 hover:bg-yellow-500/20 transition font-medium whitespace-nowrap"
                        >
                          <FiCheckCircle className="text-xs" /> Review
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSelectedRequest(req); }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition font-medium whitespace-nowrap"
                        >
                          <FiEye className="text-xs" /> View
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* ── Card view ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {requests.map((req) => (
            <div
              key={req._id}
              onClick={() => setSelectedRequest(req)}
              className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 cursor-pointer hover:border-[color:var(--accent)]/40 hover:shadow-lg transition group"
            >
              {/* Card header */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <h3 className="text-sm font-medium text-[color:var(--text-primary)] line-clamp-2 flex-1">
                  {req.title}
                </h3>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${statusColor(req.status)}`}>
                  {statusLabel(req.status)}
                </span>
              </div>

              {/* Meta */}
              <div className="space-y-1.5 mb-3">
                <div className="flex items-center gap-2 text-xs text-[color:var(--text-muted)]">
                  <span className="font-medium text-[color:var(--text-primary)]">{orgName(req)}</span>
                  <span>·</span>
                  <span className="capitalize">{req.type}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-[color:var(--text-muted)]">
                  <span>{createdByName(req)}</span>
                  <span>·</span>
                  <span>{formatDate(req.createdAt)}</span>
                </div>
                {req.linkedIssueKey && (
                  <span className="text-xs text-[color:var(--accent)] font-mono">{req.linkedIssueKey}</span>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${priorityColor(req.priority)}`}>
                  {req.priority}
                </span>
                {req.status === 'pending_taskflow_approval' ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-yellow-400 group-hover:underline">
                    <FiCheckCircle className="text-xs" /> Review
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs text-[color:var(--text-muted)] group-hover:text-[color:var(--text-primary)] transition">
                    <FiEye className="text-xs" /> View details
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail/Review panel */}
      {selectedRequest && token && (
        <RequestDetailPanel
          request={selectedRequest}
          onClose={() => setSelectedRequest(null)}
          onDone={handleDone}
          token={token}
        />
      )}
    </div>
  );
}
