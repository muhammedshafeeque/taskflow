import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usersApi, rolesApi, designationsApi, adminApi, type User, type Role, type Designation, type UpdateUserBody, type LicenseData } from '../lib/api';
import { EditIcon } from '../components/icons/NavigationIcons';

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

function getRoleName(u: User): string {
  if (u.roleId && typeof u.roleId === 'object' && 'name' in u.roleId) {
    return (u.roleId as { name: string }).name;
  }
  return (u as { role?: string }).role ?? '—';
}

function getDesignationName(u: User): string {
  if (u.designation && typeof u.designation === 'object' && 'name' in u.designation) {
    return (u.designation as { name: string }).name;
  }
  return '—';
}

function getRoleId(u: User): string | null {
  if (u.roleId && typeof u.roleId === 'object' && '_id' in u.roleId) {
    return (u.roleId as { _id: string })._id;
  }
  return null;
}

function getDesignationId(u: User): string | null {
  if (u.designation && typeof u.designation === 'object' && '_id' in u.designation) {
    return (u.designation as { _id: string })._id;
  }
  return null;
}

export default function Users() {
  const { token, user: currentUser, refreshUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', designationId: '', roleId: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; roleId: string; designationId: string; enabled: boolean }>({
    name: '',
    roleId: '',
    designationId: '',
    enabled: true,
  });
  const [editError, setEditError] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [license, setLicense] = useState<LicenseData | null>(null);

  const canEditUsers = currentUser?.permissions?.includes('users:edit') ?? false;
  const canInvite = currentUser?.permissions?.includes('users:invite') ?? false;
  const atLicenseLimit = license != null && license.maxUsers != null && license.userCount >= license.maxUsers;

  function loadUsers() {
    if (!token) return;
    usersApi.list(1, 200, token).then((res) => {
      if (res.success && res.data) {
        const d = res.data as { data?: User[] };
        setUsers(d.data ?? []);
      }
    });
  }

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    usersApi.list(1, 200, token).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        const d = res.data as { data?: User[] };
        setUsers(d.data ?? []);
      }
    });
  }, [token]);

  useEffect(() => {
    if (!token) return;
    Promise.all([rolesApi.list(token), designationsApi.list(token)]).then(([rRes, dRes]) => {
      if (rRes.success && rRes.data) setRoles(Array.isArray(rRes.data) ? rRes.data : []);
      if (dRes.success && dRes.data) setDesignations(Array.isArray(dRes.data) ? dRes.data : []);
    });
  }, [token]);

  useEffect(() => {
    if (!token || !(currentUser?.permissions?.includes('license:view') || currentUser?.role === 'admin')) return;
    adminApi.getLicense(token).then((res) => {
      if (res.success && res.data) setLicense(res.data);
    });
  }, [token, currentUser?.permissions, currentUser?.role]);

  const filteredUsers = useMemo(() => {
    let list = users;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (u) =>
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          getDesignationName(u).toLowerCase().includes(q) ||
          getRoleName(u).toLowerCase().includes(q)
      );
    }
    if (roleFilter) {
      list = list.filter((u) => {
        const rn = getRoleName(u);
        const rid = u.roleId && typeof u.roleId === 'object' ? (u.roleId as { _id: string })._id : null;
        return rn === roleFilter || rid === roleFilter;
      });
    }
    return list;
  }, [users, search, roleFilter]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (!form.roleId.trim()) {
      setError('Please select a role');
      return;
    }
    setSubmitting(true);
    setError('');
    const res = await usersApi.invite(
      {
        name: form.name.trim(),
        email: form.email.trim(),
        designationId: form.designationId || undefined,
        roleId: form.roleId,
      },
      token
    );
    setSubmitting(false);
    if (res.success) {
      setShowInvite(false);
      setForm({ name: '', email: '', designationId: '', roleId: '' });
      loadUsers();
      if (token && (currentUser?.permissions?.includes('license:view') || currentUser?.role === 'admin')) {
        adminApi.getLicense(token).then((r) => r.success && r.data && setLicense(r.data));
      }
    } else {
      setError((res as { message?: string }).message ?? 'Invite failed');
    }
  }

  function openEditModal(u: User) {
    setEditUser(u);
    setEditForm({
      name: u.name,
      roleId: getRoleId(u) ?? '',
      designationId: getDesignationId(u) ?? '',
      enabled: u.enabled !== false,
    });
    setEditError('');
  }

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !editUser) return;
    if (!editForm.roleId.trim()) {
      setEditError('Please select a role');
      return;
    }
    setEditSubmitting(true);
    setEditError('');
    const body: UpdateUserBody = {
      name: editForm.name.trim(),
      roleId: editForm.roleId || null,
      designationId: editForm.designationId || null,
      enabled: editForm.enabled,
    };
    const res = await usersApi.update(editUser._id, body, token);
    setEditSubmitting(false);
    if (res.success) {
      if (currentUser?.id === editUser._id) {
        await refreshUser();
      }
      setEditUser(null);
      loadUsers();
    } else {
      setEditError((res as { message?: string }).message ?? 'Update failed');
    }
  }

  async function handleToggleEnabled(u: User, enabled: boolean) {
    if (!token || !canEditUsers) return;
    if (u._id === currentUser?.id) return; // cannot disable self
    setEditSubmitting(true);
    const res = await usersApi.update(u._id, { enabled }, token);
    setEditSubmitting(false);
    if (res.success) loadUsers();
  }

  if (loading) {
    return (
      <div className="w-full p-6 lg:p-8">
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      </div>
    );
  }

  return (
    <div className="w-full p-6 lg:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[color:var(--text-primary)]">Users</h1>
          <p className="text-sm text-[color:var(--text-muted)] mt-1">
            Manage team members. Invite users and assign roles and designations.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {license != null && license.maxUsers != null && (
            <span className="text-sm text-[color:var(--text-muted)]">
              {license.userCount} of {license.maxUsers} users
            </span>
          )}
          {canInvite && (
            <button
              type="button"
              onClick={() => {
                setShowInvite(true);
                setError('');
                setForm({ name: '', email: '', designationId: '', roleId: '' });
              }}
              disabled={atLicenseLimit}
              title={atLicenseLimit ? 'User limit reached' : undefined}
              className="btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add user
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="search"
          placeholder="Search by name, email, role, or designation…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40 min-w-[140px]"
        >
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r._id} value={r.name}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col style={{ width: '18%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '7%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/50">
              <th className="text-left px-6 py-4 text-sm font-medium text-[color:var(--text-muted)]">User</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-[color:var(--text-muted)]">Email</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-[color:var(--text-muted)]">Role</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-[color:var(--text-muted)]">Designation</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-[color:var(--text-muted)]">Projects</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-[color:var(--text-muted)] whitespace-nowrap">Member since</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-[color:var(--text-muted)]">Status</th>
              <th className="text-right px-6 py-4 text-sm font-medium text-[color:var(--text-muted)]">Actions</th>
            </tr>
          </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr
                  key={u._id}
                  className="border-b border-[color:var(--border-subtle)]/60 last:border-b-0 hover:bg-[color:var(--bg-page)]/30 transition-colors"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] flex items-center justify-center text-xs font-medium text-[color:var(--text-muted)] shrink-0">
                        {getInitials(u.name)}
                      </div>
                      <span className="font-medium text-[color:var(--text-primary)] truncate">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-[color:var(--text-muted)]">
                    <span className="block truncate" title={u.email}>{u.email}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-0.5 rounded-md bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] whitespace-nowrap">
                      {getRoleName(u)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-[color:var(--text-muted)]">
                    {getDesignationName(u)}
                  </td>
                  <td className="px-6 py-4 text-[color:var(--text-muted)] whitespace-nowrap">
                    {typeof u.projectCount === 'number' ? u.projectCount : '—'}
                  </td>
                  <td className="px-6 py-4 text-[color:var(--text-muted)] text-xs whitespace-nowrap">
                    {formatDate(u.createdAt)}
                  </td>
                  <td className="px-6 py-4">
                    {currentUser?.id === u._id ? (
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium ${
                          u.enabled !== false
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-red-500/15 text-red-400'
                        }`}
                      >
                        {u.enabled !== false ? 'Enabled' : 'Disabled'}
                      </span>
                    ) : canEditUsers ? (
                      <button
                        type="button"
                        onClick={() => handleToggleEnabled(u, u.enabled === false)}
                        disabled={editSubmitting}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40 focus:ring-offset-2 focus:ring-offset-[color:var(--bg-elevated)] disabled:cursor-not-allowed disabled:opacity-50 ${
                          u.enabled !== false
                            ? 'bg-emerald-500'
                            : 'bg-[color:var(--border-subtle)]'
                        }`}
                        role="switch"
                        aria-checked={u.enabled !== false}
                        title={u.enabled !== false ? 'Click to disable' : 'Click to enable'}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition ${
                            u.enabled !== false ? 'translate-x-5' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    ) : (
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium ${
                          u.enabled !== false
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-red-500/15 text-red-400'
                        }`}
                      >
                        {u.enabled !== false ? 'Enabled' : 'Disabled'}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {currentUser?.id === u._id ? (
                      <Link
                        to="/profile"
                        className="text-sm text-[color:var(--accent)] hover:underline"
                      >
                        View profile
                      </Link>
                    ) : canEditUsers ? (
                      <button
                        type="button"
                        onClick={() => openEditModal(u)}
                        disabled={editSubmitting}
                        className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--accent)] hover:bg-[color:var(--bg-page)] transition-colors disabled:opacity-50"
                        title="Edit"
                      >
                        <EditIcon className="w-4 h-4" />
                      </button>
                    ) : (
                      <span className="text-xs text-[color:var(--text-muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        {filteredUsers.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-[color:var(--text-muted)]">
              {users.length === 0
                ? 'No users yet. Invite team members to get started.'
                : 'No users match your search or filters.'}
            </p>
            {users.length === 0 && currentUser?.permissions?.includes('users:invite') && (
              <button
                type="button"
                onClick={() => {
                  setShowInvite(true);
                  setError('');
                  setForm({ name: '', email: '', designationId: '', roleId: '' });
                }}
                className="btn-primary mt-4 px-4 py-2 rounded-lg text-sm"
              >
                Add user
              </button>
            )}
          </div>
        )}
      </div>

      {showInvite && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => setShowInvite(false)}
        >
          <div
            className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl shadow-xl max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 lg:p-8">
              <h2 className="text-lg font-semibold text-[color:var(--text-primary)] mb-2">Invite user</h2>
              <p className="text-sm text-[color:var(--text-muted)] mb-6">
                They will receive an email with a temporary password. They must change it on first login.
              </p>
              <form onSubmit={handleInvite} className="space-y-4">
                {error && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                    {error}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Name</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    className="w-full px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                    placeholder="Full name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Email</label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    required
                    className="w-full px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                    placeholder="email@example.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">
                    Designation (optional)
                  </label>
                  <select
                    value={form.designationId}
                    onChange={(e) => setForm((f) => ({ ...f, designationId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                  >
                    <option value="">— None —</option>
                    {designations.map((d) => (
                      <option key={d._id} value={d._id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Role *</label>
                  <select
                    value={form.roleId}
                    onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}
                    required
                    className="w-full px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                  >
                    <option value="">— Select —</option>
                    {roles.map((r) => (
                      <option key={r._id} value={r._id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                  >
                    {submitting ? 'Sending invite…' : 'Invite'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowInvite(false)}
                    className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {editUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60"
          onClick={() => !editSubmitting && setEditUser(null)}
        >
          <div
            className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl shadow-xl max-w-md w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 lg:p-8">
              <h2 className="text-lg font-semibold text-[color:var(--text-primary)] mb-2">Edit user</h2>
              <p className="text-sm text-[color:var(--text-muted)] mb-6">
                Update name, role, designation, or status for {editUser.email}.
              </p>
              <form onSubmit={handleEditSubmit} className="space-y-4">
                {editError && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                    {editError}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Name</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    className="w-full px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                    placeholder="Full name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Role</label>
                  <select
                    value={editForm.roleId}
                    onChange={(e) => setEditForm((f) => ({ ...f, roleId: e.target.value }))}
                    required
                    className="w-full px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                  >
                    <option value="">— Select —</option>
                    {roles.map((r) => (
                      <option key={r._id} value={r._id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">
                    Designation (optional)
                  </label>
                  <select
                    value={editForm.designationId}
                    onChange={(e) => setEditForm((f) => ({ ...f, designationId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                  >
                    <option value="">— None —</option>
                    {designations.map((d) => (
                      <option key={d._id} value={d._id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                {editUser._id !== currentUser?.id && (
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id="edit-enabled"
                      checked={editForm.enabled}
                      onChange={(e) => setEditForm((f) => ({ ...f, enabled: e.target.checked }))}
                      className="w-4 h-4 rounded border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-[color:var(--accent)] focus:ring-[color:var(--accent)]/40"
                    />
                    <label htmlFor="edit-enabled" className="text-sm text-[color:var(--text-primary)]">
                      User enabled (disabled users cannot log in)
                    </label>
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={editSubmitting}
                    className="btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                  >
                    {editSubmitting ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => !editSubmitting && setEditUser(null)}
                    disabled={editSubmitting}
                    className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
