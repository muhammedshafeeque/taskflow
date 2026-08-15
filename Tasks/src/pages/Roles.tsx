import { Fragment, useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { rolesApi, permissionsApi, type Role } from '../lib/api';
import ConfirmModal from '../components/ConfirmModal';
import { TrashIcon, ChevronDownIcon, ChevronUpIcon, RolesIcon } from '../components/icons/NavigationIcons';

export default function Roles() {
  const { token } = useAuth();
  const [roles, setRoles] = useState<Role[]>([]);
  const [permMap, setPermMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return roles;
    return roles.filter((r) => r.name.toLowerCase().includes(q));
  }, [roles, search]);

  function loadRoles() {
    if (!token) return;
    rolesApi.list(token).then((res) => {
      if (res.success && res.data) setRoles(Array.isArray(res.data) ? res.data : []);
    });
  }

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([rolesApi.list(token), permissionsApi.list(token)]).then(([rolesRes, permRes]) => {
      setLoading(false);
      if (rolesRes.success && rolesRes.data) setRoles(Array.isArray(rolesRes.data) ? rolesRes.data : []);
      if (permRes.success && permRes.data && Array.isArray(permRes.data)) {
        setPermMap(new Map(permRes.data.map((p) => [p.code, p.label])));
      }
    });
  }, [token]);

  async function handleDelete() {
    if (!token || !deleteId) return;
    const res = await rolesApi.delete(deleteId, token);
    setDeleteId(null);
    if (res.success) loadRoles();
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
          <h1 className="text-2xl font-semibold text-[color:var(--text-primary)]">Roles</h1>
          <p className="text-sm text-[color:var(--text-muted)] mt-1">
            Create and edit roles. Assign permissions from the predefined catalog.
          </p>
        </div>
        <Link
          to="/roles/new/permissions"
          className="btn-primary shrink-0 px-4 py-2 rounded-lg text-sm inline-flex items-center justify-center"
        >
          Add role
        </Link>
      </div>

      <input
        type="search"
        placeholder="Search roles…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
      />

      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
        <table className="w-full text-sm table-fixed">
          <colgroup>
            <col style={{ width: '4%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '52%' }} />
            <col style={{ width: '16%' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/50">
              <th className="w-10 px-6 py-4" />
              <th className="text-left px-6 py-4 text-sm font-medium text-[color:var(--text-muted)]">Name</th>
              <th className="text-left px-6 py-4 text-sm font-medium text-[color:var(--text-muted)]">Permissions</th>
              <th className="text-right px-6 py-4 text-sm font-medium text-[color:var(--text-muted)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredRoles.map((role) => {
              const perms = role.permissions ?? [];
              const isExpanded = expandedId === role._id;
              return (
                <Fragment key={role._id}>
                  <tr className="border-b border-[color:var(--border-subtle)]/60 last:border-b-0 hover:bg-[color:var(--bg-page)]/30 transition-colors">
                    <td className="px-6 py-4">
                      {perms.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : role._id)}
                          className="p-1 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--accent)] hover:bg-[color:var(--bg-page)] transition-colors"
                          title={isExpanded ? 'Collapse' : 'Expand'}
                        >
                          {isExpanded ? (
                            <ChevronUpIcon className="w-4 h-4" />
                          ) : (
                            <ChevronDownIcon className="w-4 h-4" />
                          )}
                        </button>
                      ) : (
                        <span className="w-6 block" />
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-medium text-[color:var(--text-primary)]">{role.name}</span>
                    </td>
                    <td className="px-6 py-4 text-[color:var(--text-muted)]">
                      {perms.length} permission{perms.length !== 1 ? 's' : ''}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to={`/roles/${role._id}/permissions`}
                          title="Manage permissions"
                          aria-label="Manage permissions"
                          className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--accent)] hover:bg-[color:var(--bg-page)] transition-colors"
                        >
                          <RolesIcon className="w-4 h-4" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => setDeleteId(role._id)}
                          title="Delete"
                          className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && perms.length > 0 && (
                    <tr className="border-b border-[color:var(--border-subtle)]/60 last:border-b-0 bg-[color:var(--bg-page)]/20">
                      <td className="px-6 py-0" />
                      <td colSpan={3} className="px-6 py-4">
                        <div className="flex flex-wrap gap-2">
                          {perms.map((code) => (
                            <span
                              key={code}
                              className="inline-flex px-2 py-1 rounded-md bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)]"
                            >
                              {permMap.get(code) ?? code}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {filteredRoles.length === 0 && (
          <div className="px-6 py-12 text-center">
            <p className="text-sm text-[color:var(--text-muted)]">
              {roles.length === 0
                ? 'No roles yet. Create one to get started.'
                : 'No roles match your search.'}
            </p>
            {roles.length === 0 && (
              <Link
                to="/roles/new/permissions"
                className="btn-primary mt-4 px-4 py-2 rounded-lg text-sm inline-flex"
              >
                Add role
              </Link>
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!deleteId}
        title="Delete role"
        message="Are you sure? Users with this role will lose these permissions."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}
