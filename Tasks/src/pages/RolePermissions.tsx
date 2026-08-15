import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { rolesApi, permissionsApi, type PermissionItem, type Role } from '../lib/api';
import { PermissionCatalogCards } from '../components/PermissionCatalogCards';
import { userHasPermission } from '../utils/permissions';
import { TASK_FLOW_PERMISSIONS } from '@shared/constants/permissions';

export default function RolePermissions() {
  const { roleId } = useParams<{ roleId: string }>();
  const isNew = roleId === 'new';
  const navigate = useNavigate();
  const { token, user: currentUser } = useAuth();
  const canManageRoles =
    userHasPermission(currentUser?.permissions ?? [], TASK_FLOW_PERMISSIONS.AUTH.ROLE.MANAGE_ALL) ||
    userHasPermission(currentUser?.permissions ?? [], 'roles:manage');

  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [allPermissions, setAllPermissions] = useState<PermissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [initialSelected, setInitialSelected] = useState<string[]>([]);
  const [initialName, setInitialName] = useState('');

  useEffect(() => {
    if (!token || !roleId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setError('');
    setSaved(false);

    const load = async () => {
      const pRes = await permissionsApi.list(token);
      if (cancelled) return;
      if (pRes.success && pRes.data) {
        setAllPermissions(Array.isArray(pRes.data) ? pRes.data : []);
      }

      if (isNew) {
        setName('');
        setSelected([]);
        setInitialName('');
        setInitialSelected([]);
        setLoading(false);
        return;
      }

      const rRes = await rolesApi.get(roleId, token);
      if (cancelled) return;
      setLoading(false);
      if (!rRes.success || !rRes.data) {
        setLoadError((rRes as { message?: string }).message ?? 'Role not found');
        return;
      }
      const role = rRes.data as Role;
      setName(role.name);
      setSelected(role.permissions ?? []);
      setInitialName(role.name);
      setInitialSelected(role.permissions ?? []);
    };

    load().catch(() => {
      if (!cancelled) {
        setLoading(false);
        setLoadError('Failed to load role');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [token, roleId, isNew]);

  function isChecked(code: string) {
    return selected.includes(code);
  }

  function togglePermission(code: string) {
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
    setSaved(false);
  }

  function toggleMany(perms: PermissionItem[]) {
    const codes = perms.map((p) => p.code);
    const allOn = codes.every((c) => selected.includes(c));
    setSelected((prev) => {
      if (allOn) return prev.filter((c) => !codes.includes(c));
      return [...new Set([...prev, ...codes])];
    });
    setSaved(false);
  }

  function handleReset() {
    setName(initialName);
    setSelected(initialSelected);
    setError('');
    setSaved(false);
  }

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault();
    if (!token) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Role name is required');
      return;
    }
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      if (isNew) {
        const res = await rolesApi.create(
          { name: trimmed, permissions: selected },
          token
        );
        if (res.success && res.data) {
          const created = res.data as Role;
          navigate(`/roles/${created._id}/permissions`, { replace: true });
          setSaved(true);
        } else {
          setError((res as { message?: string }).message ?? 'Failed to create role');
        }
      } else if (roleId) {
        const res = await rolesApi.update(
          roleId,
          { name: trimmed, permissions: selected },
          token
        );
        if (res.success && res.data) {
          const updated = res.data as Role;
          setName(updated.name);
          setSelected(updated.permissions ?? []);
          setInitialName(updated.name);
          setInitialSelected(updated.permissions ?? []);
          setSaved(true);
        } else {
          setError((res as { message?: string }).message ?? 'Failed to update role');
        }
      }
    } finally {
      setSaving(false);
    }
  }

  if (!canManageRoles) {
    return <Navigate to="/roles" replace />;
  }

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <p className="text-sm text-[color:var(--text-muted)]">Loading permissions…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6 lg:p-8 space-y-4">
        <p className="text-sm text-red-400">{loadError}</p>
        <Link to="/roles" className="text-sm text-[color:var(--accent)] hover:underline">
          Back to roles
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 w-full space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <Link
            to="/roles"
            className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--accent)]"
          >
            ← Roles
          </Link>
          <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">
            {isNew ? 'New role' : 'Role permissions'}
          </h1>
          <div className="max-w-md">
            <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">
              Role name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
              required
              className="w-full px-3 py-2 rounded-lg bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
              placeholder="e.g. Admin"
            />
          </div>
          <p className="text-xs text-[color:var(--text-muted)]">
            Assign permissions by module. {selected.length} selected.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleSave()}
            disabled={saving}
            className="btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {saving ? 'Saving…' : isNew ? 'Create role' : 'Save permissions'}
          </button>
          {!isNew && (
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] disabled:opacity-50"
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}
      {saved && !error && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
          {isNew ? 'Role created.' : 'Permissions saved.'}
        </div>
      )}

      <PermissionCatalogCards
        permissions={allPermissions}
        isChecked={isChecked}
        onToggle={togglePermission}
        onToggleMany={toggleMany}
      />
    </div>
  );
}
