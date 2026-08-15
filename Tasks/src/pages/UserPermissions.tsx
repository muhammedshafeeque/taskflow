import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usersApi, permissionsApi, type User, type PermissionItem } from '../lib/api';
import {
  PermissionCatalogCards,
  type PermSource,
} from '../components/PermissionCatalogCards';
import { userHasPermission } from '../utils/permissions';
import { TASK_FLOW_PERMISSIONS } from '@shared/constants/permissions';

export default function UserPermissions() {
  const { userId } = useParams<{ userId: string }>();
  const { token, user: currentUser, refreshUser } = useAuth();
  const canEditUsers = userHasPermission(
    currentUser?.permissions ?? [],
    TASK_FLOW_PERMISSIONS.AUTH.USER.UPDATE
  );

  const [user, setUser] = useState<User | null>(null);
  const [allPermissions, setAllPermissions] = useState<PermissionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [permGranted, setPermGranted] = useState<string[]>([]);
  const [permRevoked, setPermRevoked] = useState<string[]>([]);
  const [permSaving, setPermSaving] = useState(false);
  const [permError, setPermError] = useState('');
  const [permSaved, setPermSaved] = useState(false);

  useEffect(() => {
    if (!token || !userId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    Promise.all([usersApi.get(userId, token), permissionsApi.list(token)]).then(([uRes, pRes]) => {
      if (cancelled) return;
      setLoading(false);
      if (!uRes.success || !uRes.data) {
        setLoadError((uRes as { message?: string }).message ?? 'User not found');
        return;
      }
      const u = uRes.data as User;
      setUser(u);
      setPermGranted(u.permissionOverrides?.granted ?? []);
      setPermRevoked(u.permissionOverrides?.revoked ?? []);
      if (pRes.success && pRes.data) {
        setAllPermissions(Array.isArray(pRes.data) ? pRes.data : []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, userId]);

  const rolePerms = useMemo(() => {
    if (user?.roleId && typeof user.roleId === 'object' && 'permissions' in user.roleId) {
      return (user.roleId as { permissions?: string[] }).permissions ?? [];
    }
    return [];
  }, [user]);

  const roleName =
    user?.roleId && typeof user.roleId === 'object' && 'name' in user.roleId
      ? (user.roleId as { name: string }).name
      : user?.role ?? '—';

  function getEffectiveChecked(code: string): boolean {
    if (permRevoked.includes(code)) return false;
    if (permGranted.includes(code)) return true;
    return rolePerms.includes(code);
  }

  function getPermSource(code: string): PermSource {
    const inRole = rolePerms.includes(code);
    if (permRevoked.includes(code)) return 'revoked';
    if (permGranted.includes(code)) return 'granted';
    if (inRole) return 'role';
    return 'none';
  }

  function togglePermission(code: string) {
    const inRole = rolePerms.includes(code);
    const currentlyChecked = getEffectiveChecked(code);

    if (currentlyChecked) {
      if (inRole) {
        setPermGranted((g) => g.filter((p) => p !== code));
        setPermRevoked((r) => [...r.filter((p) => p !== code), code]);
      } else {
        setPermGranted((g) => g.filter((p) => p !== code));
      }
    } else if (inRole && permRevoked.includes(code)) {
      setPermRevoked((r) => r.filter((p) => p !== code));
    } else {
      setPermRevoked((r) => r.filter((p) => p !== code));
      setPermGranted((g) => [...g.filter((p) => p !== code), code]);
    }
    setPermSaved(false);
  }

  function toggleModuleAll(modulePerms: PermissionItem[]) {
    const codes = modulePerms.map((p) => p.code);
    const allOn = codes.every((c) => getEffectiveChecked(c));

    let nextGranted = [...permGranted];
    let nextRevoked = [...permRevoked];

    for (const code of codes) {
      const inRole = rolePerms.includes(code);
      const checked = nextRevoked.includes(code)
        ? false
        : nextGranted.includes(code)
          ? true
          : inRole;

      if (allOn && checked) {
        if (inRole) {
          nextGranted = nextGranted.filter((p) => p !== code);
          if (!nextRevoked.includes(code)) nextRevoked = [...nextRevoked, code];
        } else {
          nextGranted = nextGranted.filter((p) => p !== code);
          nextRevoked = nextRevoked.filter((p) => p !== code);
        }
      } else if (!allOn && !checked) {
        if (inRole) {
          nextRevoked = nextRevoked.filter((p) => p !== code);
        } else {
          nextRevoked = nextRevoked.filter((p) => p !== code);
          if (!nextGranted.includes(code)) nextGranted = [...nextGranted, code];
        }
      }
    }

    setPermGranted(nextGranted);
    setPermRevoked(nextRevoked);
    setPermSaved(false);
  }

  async function handleSave() {
    if (!token || !user) return;
    setPermSaving(true);
    setPermError('');
    setPermSaved(false);
    const res = await usersApi.updatePermissions(
      user._id,
      { granted: permGranted, revoked: permRevoked },
      token
    );
    setPermSaving(false);
    if (res.success && res.data) {
      const updated = res.data as User;
      setUser(updated);
      setPermGranted(updated.permissionOverrides?.granted ?? []);
      setPermRevoked(updated.permissionOverrides?.revoked ?? []);
      if (currentUser?.id === user._id) await refreshUser();
      setPermSaved(true);
    } else {
      setPermError((res as { message?: string }).message ?? 'Failed to save permissions');
    }
  }

  function handleReset() {
    if (!user) return;
    setPermGranted(user.permissionOverrides?.granted ?? []);
    setPermRevoked(user.permissionOverrides?.revoked ?? []);
    setPermError('');
    setPermSaved(false);
  }

  if (!canEditUsers) {
    return <Navigate to="/users" replace />;
  }

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <p className="text-sm text-[color:var(--text-muted)]">Loading permissions…</p>
      </div>
    );
  }

  if (loadError || !user) {
    return (
      <div className="p-6 lg:p-8 space-y-4">
        <p className="text-sm text-red-400">{loadError || 'User not found'}</p>
        <Link to="/users" className="text-sm text-[color:var(--accent)] hover:underline">
          Back to users
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8 w-full space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            to="/users"
            className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--accent)]"
          >
            ← Users
          </Link>
          <h1 className="text-xl font-semibold text-[color:var(--text-primary)] mt-1">
            Permissions
          </h1>
          <p className="text-sm text-[color:var(--text-muted)] mt-1">
            {user.name} · {user.email}
            <span className="mx-1.5 text-[color:var(--border-subtle)]">·</span>
            Role: {roleName}
          </p>
          <p className="text-xs text-[color:var(--text-muted)] mt-2">
            Overrides apply on top of the role. Grant extras or revoke role permissions per module.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={handleSave}
            disabled={permSaving}
            className="btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {permSaving ? 'Saving…' : 'Save permissions'}
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={permSaving}
            className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] disabled:opacity-50"
          >
            Reset
          </button>
        </div>
      </div>

      {permError && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {permError}
        </div>
      )}
      {permSaved && !permError && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm">
          Permissions saved.
        </div>
      )}

      <PermissionCatalogCards
        permissions={allPermissions}
        isChecked={getEffectiveChecked}
        onToggle={togglePermission}
        onToggleMany={toggleModuleAll}
        getSource={getPermSource}
        showLegend
      />
    </div>
  );
}
