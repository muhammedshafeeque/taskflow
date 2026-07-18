import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { auditLogsApi, usersApi, projectsApi, type AuditLogEntry, type User, type Project } from '../lib/api';
import { formatDateTimeDDMMYYYY } from '../lib/dateFormat';
import { canAny } from '../utils/moduleAccess';

export default function AuditLogs() {
  const { token, user } = useAuth();
  const canView = canAny(user, 'taskflow.platform.audit.read');
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [loading, setLoading] = useState(true);
  const [filterUser, setFilterUser] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterResourceType, setFilterResourceType] = useState('');
  const [filterProjectId, setFilterProjectId] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!token) return;
    usersApi.list(1, 200, token).then((res) => {
      if (res.success && res.data) setUsers(res.data.data ?? []);
    });
    projectsApi.list(1, 200, token).then((res) => {
      if (res.success && res.data) setProjects(res.data.data ?? []);
    });
  }, [token, user?.activeOrganizationId]);

  useEffect(() => {
    if (!token || !canView) return;
    setLoading(true);
    auditLogsApi.list(
      { page, limit, user: filterUser || undefined, action: filterAction || undefined, resourceType: filterResourceType || undefined, projectId: filterProjectId || undefined },
      token
    ).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        setEntries(res.data.data ?? []);
        setTotal(res.data.total ?? 0);
      }
    });
  }, [token, canView, user?.activeOrganizationId, page, limit, filterUser, filterAction, filterResourceType, filterProjectId]);

  if (!canView) {
    return (
      <div className="p-8">
        <p className="text-[color:var(--text-muted)]">Access denied. Insufficient permissions.</p>
      </div>
    );
  }

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="p-8 animate-fade-in">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <h1 className="text-xl font-semibold mb-1">Audit logs</h1>
        <p className="text-[13px] text-[color:var(--text-muted)] mb-6">
          View system activity and changes.
        </p>

        <div className="mb-6 flex flex-wrap gap-3">
          <div>
            <label className="block text-xs text-[color:var(--text-muted)] mb-1">User</label>
            <select
              value={filterUser}
              onChange={(e) => { setFilterUser(e.target.value); setPage(1); }}
              className="px-3 py-1.5 rounded-md bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-sm"
            >
              <option value="">All</option>
              {users.map((u) => (
                <option key={u._id} value={u._id}>{u.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[color:var(--text-muted)] mb-1">Action</label>
            <select
              value={filterAction}
              onChange={(e) => { setFilterAction(e.target.value); setPage(1); }}
              className="px-3 py-1.5 rounded-md bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-sm"
            >
              <option value="">All</option>
              <option value="login">login</option>
              <option value="create">create</option>
              <option value="update">update</option>
              <option value="delete">delete</option>
              <option value="invite">invite</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[color:var(--text-muted)] mb-1">Resource</label>
            <select
              value={filterResourceType}
              onChange={(e) => { setFilterResourceType(e.target.value); setPage(1); }}
              className="px-3 py-1.5 rounded-md bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-sm"
            >
              <option value="">All</option>
              <option value="auth">auth</option>
              <option value="issue">issue</option>
              <option value="project">project</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[color:var(--text-muted)] mb-1">Project</label>
            <select
              value={filterProjectId}
              onChange={(e) => { setFilterProjectId(e.target.value); setPage(1); }}
              className="px-3 py-1.5 rounded-md bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-sm"
            >
              <option value="">All</option>
              {projects.map((p) => (
                <option key={p._id} value={p._id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-8 text-center text-[color:var(--text-muted)] animate-pulse">
            Loading…
          </div>
        ) : (
          <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)]">
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">User</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Resource</th>
                    <th className="px-4 py-3 font-medium">Project</th>
                    <th className="px-4 py-3 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--border-subtle)]/70">
                  {entries.map((e) => (
                    <tr key={e._id} className="bg-[color:var(--bg-surface)]">
                      <td className="px-4 py-3 text-[color:var(--text-primary)]">
                        {e.createdAt ? formatDateTimeDDMMYYYY(e.createdAt) : '—'}
                      </td>
                      <td className="px-4 py-3 text-[color:var(--text-primary)]">
                        {typeof e.user === 'object' && e.user ? e.user.name : '—'}
                      </td>
                      <td className="px-4 py-3 text-[color:var(--text-primary)]">{e.action}</td>
                      <td className="px-4 py-3 text-[color:var(--text-primary)]">
                        {e.resourceType}{e.resourceId ? ` #${e.resourceId.slice(-6)}` : ''}
                      </td>
                      <td className="px-4 py-3 text-[color:var(--text-primary)]">
                        {typeof e.projectId === 'object' && e.projectId ? e.projectId.name : '—'}
                      </td>
                      <td className="px-4 py-3 text-[color:var(--text-muted)] text-xs max-w-[200px] truncate">
                        {e.meta ? JSON.stringify(e.meta) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-[color:var(--border-subtle)]">
                <span className="text-xs text-[color:var(--text-muted)]">
                  {total} total
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1 rounded border border-[color:var(--border-subtle)] text-xs disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="px-3 py-1 text-xs text-[color:var(--text-muted)]">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1 rounded border border-[color:var(--border-subtle)] text-xs disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
