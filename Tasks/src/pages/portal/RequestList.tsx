import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { portalApi, type CustomerRequest } from '../../lib/api';
import { userHasPermission } from '../../utils/permissions';
import { CUSTOMER_PERMISSIONS } from '@shared/constants/permissions';
import { FiPlus, FiFilter, FiEye } from 'react-icons/fi';

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
    case 'critical': return 'text-red-400';
    case 'high': return 'text-orange-400';
    case 'medium': return 'text-yellow-400';
    case 'low': return 'text-green-400';
    default: return 'text-[color:var(--text-muted)]';
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'pending_customer_approval', label: 'Pending Customer Approval' },
  { value: 'pending_taskflow_approval', label: 'Pending Atrium Approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'ticket_created', label: 'Ticket Created' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
  { value: 'rejected', label: 'Rejected' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature' },
  { value: 'suggestion', label: 'Suggestion' },
  { value: 'concern', label: 'Concern' },
  { value: 'other', label: 'Other' },
];

export default function RequestList() {
  const { token, user } = useAuth();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const canApprove = userHasPermission(user?.customerPermissions ?? [], CUSTOMER_PERMISSIONS.LEGACY.REQUEST.APPROVE);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    const params: { status?: string } = {};
    if (statusFilter) params.status = statusFilter;
    portalApi.listRequests(token, params).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setRequests(res.data.requests || []);
      } else {
        setError((res as { message?: string }).message ?? 'Failed to load requests');
      }
    });
  }, [token, statusFilter]);

  const filtered = typeFilter
    ? requests.filter((r) => r.type === typeFilter)
    : requests;

  const pendingApproval = filtered.filter((r) => r.status === 'pending_customer_approval');

  const inputClass =
    'rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm text-[color:var(--text-primary)] focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30';

  return (
    <div className="p-8 animate-fade-in">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">My Requests</h1>
          <p className="text-sm text-[color:var(--text-muted)] mt-1">All submitted requests from your organisation</p>
        </div>
        <Link to="/portal/requests/new" className="btn-primary flex items-center gap-2">
          <FiPlus /> New Request
        </Link>
      </div>

      {/* Approval queue section */}
      {canApprove && pendingApproval.length > 0 && (
        <div className="mb-6 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
          <p className="text-sm font-semibold text-yellow-400 mb-3">
            Pending Customer Approval ({pendingApproval.length})
          </p>
          <ul className="space-y-2">
            {pendingApproval.map((req) => {
              const project = typeof req.projectId === 'object' ? req.projectId.name : req.projectId;
              const createdBy = typeof req.createdBy === 'object' ? req.createdBy.name : req.createdBy;
              return (
                <li
                  key={req._id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] transition cursor-pointer"
                  onClick={() => navigate(`/portal/requests/${req._id}`)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[color:var(--text-primary)] truncate">{req.title}</p>
                    <p className="text-xs text-[color:var(--text-muted)] mt-0.5">{project} · by {createdBy}</p>
                  </div>
                  <span className="text-xs text-[color:var(--accent)] hover:underline font-medium">Review</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <FiFilter className="text-[color:var(--text-muted)]" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputClass}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={inputClass}>
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {(statusFilter || typeFilter) && (
          <button
            type="button"
            onClick={() => { setStatusFilter(''); setTypeFilter(''); }}
            className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-12 text-center text-[color:var(--text-muted)] animate-pulse">
          Loading…
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-400">{error}</div>
      ) : (
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-sm text-[color:var(--text-muted)]">
              No requests found.{' '}
              <Link to="/portal/requests/new" className="text-[color:var(--accent)] hover:underline">
                Submit one now
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
                    <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Title</th>
                    <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Type</th>
                    <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Priority</th>
                    <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Project</th>
                    <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Created</th>
                    <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border-subtle)]">
                  {filtered.map((req) => {
                    const project = typeof req.projectId === 'object' ? req.projectId.name : req.projectId;
                    return (
                      <tr key={req._id} className="hover:bg-[color:var(--bg-elevated)] transition">
                        <td className="px-4 py-3 max-w-xs">
                          <p className="font-medium text-[color:var(--text-primary)] truncate">{req.title}</p>
                        </td>
                        <td className="px-4 py-3 capitalize text-[color:var(--text-muted)]">{req.type}</td>
                        <td className={`px-4 py-3 capitalize font-medium ${priorityColor(req.priority)}`}>
                          {req.priority}
                        </td>
                        <td className="px-4 py-3 text-[color:var(--text-muted)] truncate max-w-[120px]">{project}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(req.status)}`}>
                            {statusLabel(req.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[color:var(--text-muted)] whitespace-nowrap">
                          {formatDate(req.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            to={`/portal/requests/${req._id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] transition"
                          >
                            <FiEye className="text-xs" /> View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
