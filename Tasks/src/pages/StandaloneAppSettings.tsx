import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Inbox from './Inbox';
import { taskflowAppSettingsHref } from '../lib/appSettingsHref';
import { SunIcon, MoonIcon, InboxIcon, LogOutIcon, DashboardIcon, SettingsIcon } from '../components/icons/NavigationIcons';
import { APP_VERSION } from '../appVersion';
import { organizationsApi, projectsApi, inboxApi, type TaskflowOrganizationSummary } from '../lib/api';
import { canAccessTaskflowWorkspaceSettings } from '../utils/taskflowWorkspaceSettingsAccess';

type TabId = 'home' | 'inbox' | 'shortcuts';

function hasPerm(perms: string[], p: string) {
  return perms.includes(p);
}

function canSeeCustomerOrgs(perms: string[]) {
  return (
    hasPerm(perms, 'taskflow.customer_portal.org.manage') ||
    hasPerm(perms, 'taskflow.customer_portal.org.view') ||
    hasPerm(perms, 'customers:manage') ||
    hasPerm(perms, 'customers:view')
  );
}

export default function StandaloneAppSettings() {
  const navigate = useNavigate();
  const { user, token, refreshUser, switchWorkspace, logout } = useAuth();
  const [tab, setTab] = useState<TabId>('home');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = window.localStorage.getItem('taskflow_theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });

  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [projectTotal, setProjectTotal] = useState<number | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [inboxUnread, setInboxUnread] = useState<number | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('taskflow_theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const openProjectManagerInNewTab = useCallback((path: string) => {
    const base = import.meta.env.BASE_URL ?? '/';
    const trimmed = base === '/' ? '' : base.replace(/\/$/, '');
    const url = `${window.location.origin}${trimmed}${path.startsWith('/') ? path : `/${path}`}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }, []);

  const perms = user?.permissions ?? [];
  const workspaceSettingsAllowed = canAccessTaskflowWorkspaceSettings(user);
  const shortcutLinks = useMemo(() => {
    const items: { label: string; path: string }[] = [{ label: 'Dashboard', path: '/' }];
    if (hasPerm(perms, 'auth.user.list') || hasPerm(perms, 'auth.user.create') || hasPerm(perms, 'users:list') || hasPerm(perms, 'users:invite')) {
      items.push({ label: 'Users', path: '/users' });
    }
    if (hasPerm(perms, 'auth.role.manage_all') || hasPerm(perms, 'roles:manage')) {
      items.push({ label: 'Roles', path: '/roles' });
    }
    if (canSeeCustomerOrgs(perms)) {
      items.push({ label: 'Customer organisations', path: '/admin/customer-orgs' });
    }
    if (workspaceSettingsAllowed) {
      items.push({ label: 'Workspace', path: '/settings/workspace' });
    }
    items.push({ label: 'Profile', path: '/profile' });
    return items;
  }, [perms, workspaceSettingsAllowed]);

  const orgs: TaskflowOrganizationSummary[] = user?.organizations ?? [];
  const activeOrgId = user?.activeOrganizationId ?? orgs[0]?.id;
  const activeOrg = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];
  const hasWorkspaceAccess = orgs.length > 0;

  useEffect(() => {
    if (!token || !activeOrgId || user?.userType !== 'taskflow') {
      setMemberCount(null);
      setProjectTotal(null);
      return;
    }
    let cancelled = false;
    setUsageLoading(true);
    void (async () => {
      const [orgRes, projRes] = await Promise.all([
        organizationsApi.get(activeOrgId, token),
        projectsApi.list(1, 50, token),
      ]);
      if (cancelled) return;
      if (orgRes.success && orgRes.data?.members) {
        setMemberCount(orgRes.data.members.filter((m) => m.status === 'active').length);
      } else setMemberCount(null);
      if (projRes.success && projRes.data) {
        setProjectTotal(projRes.data.total);
      } else setProjectTotal(null);
      setUsageLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [token, activeOrgId, user?.userType]);

  useEffect(() => {
    if (!token) {
      setInboxUnread(null);
      return;
    }
    let cancelled = false;
    void inboxApi.unreadCount(token).then((res) => {
      if (cancelled) return;
      if (res.success && res.data) setInboxUnread(res.data.unread);
      else setInboxUnread(null);
    });
    return () => {
      cancelled = true;
    };
  }, [token, tab]);

  async function enterWorkspaceInProjectManager(orgId: string) {
    if (!orgId) return;
    if (orgId !== user?.activeOrganizationId) {
      const r = await switchWorkspace(orgId);
      if (!r.ok) {
        window.alert(r.error ?? 'Could not switch workspace');
        return;
      }
      await refreshUser();
    }
    navigate('/');
  }

  async function submitCreateWorkspace(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !createName.trim()) return;
    setCreateBusy(true);
    setCreateError(null);
    const res = await organizationsApi.create({ name: createName.trim(), description: createDesc.trim() || undefined }, token);
    setCreateBusy(false);
    if (!res.success || !res.data) {
      setCreateError((res as { message?: string }).message ?? 'Could not create workspace');
      return;
    }
    const org = res.data.organization as { _id?: string; id?: string } | undefined;
    const newId = org?._id ?? org?.id;
    if (newId) {
      const sw = await switchWorkspace(String(newId));
      if (!sw.ok) {
        setCreateError(sw.error ?? 'Workspace created but could not switch to it');
        await refreshUser();
        setCreateOpen(false);
        setCreateName('');
        setCreateDesc('');
        return;
      }
    }
    await refreshUser();
    setCreateOpen(false);
    setCreateName('');
    setCreateDesc('');
  }

  return (
    <div className="min-h-screen flex flex-col bg-[color:var(--bg-page)] text-[color:var(--text-primary)]">
      <header className="shrink-0 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-4 sm:px-5 lg:px-6 xl:px-8 py-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[color:var(--sidebar-logo-bg)] text-[color:var(--sidebar-text-active)] font-bold text-sm shrink-0">
            TF
          </span>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight">TaskFlow — workspace &amp; settings</h1>
            <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5 truncate">
              This window uses a separate layout from the Project Manager. You can close the tab when you are done.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-surface)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40 focus:ring-offset-0"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <SunIcon className="w-3.5 h-3.5" /> : <MoonIcon className="w-3.5 h-3.5" />}
          </button>
          {hasWorkspaceAccess && (
            <button
              type="button"
              onClick={() => navigate('/')}
              className="rounded-md border border-[color:var(--border-subtle)] px-3 py-1.5 text-xs font-medium text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)]"
            >
              Open Project Manager
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <nav
          className="shrink-0 flex flex-col gap-1 p-3 border-b lg:border-b-0 lg:border-r border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] lg:w-64"
          aria-label="Settings sections"
        >
          <div className="flex flex-row lg:flex-col gap-1 lg:w-full overflow-x-auto pb-1 lg:pb-0 min-w-0">
            {(
              [
                { id: 'home' as const, label: 'Home', icon: <DashboardIcon className="w-3.5 h-3.5" /> },
                { id: 'inbox' as const, label: 'Inbox', icon: <InboxIcon className="w-3.5 h-3.5" /> },
                { id: 'shortcuts' as const, label: 'Project Manager links', icon: <SettingsIcon className="w-3.5 h-3.5" /> },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-left text-xs font-medium transition lg:w-full ${
                  tab === item.id
                    ? 'bg-[color:var(--accent)]/15 text-[color:var(--accent)] ring-1 ring-[color:var(--accent)]/30'
                    : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]'
                }`}
              >
                <span className="inline-flex items-center gap-2">
                  {item.icon}
                  {item.label}
                </span>
              </button>
            ))}
          </div>

          <div className="flex lg:hidden w-full border-t border-[color:var(--border-subtle)] pt-2 mt-1 px-1">
            <button
              type="button"
              onClick={() => {
                logout();
                navigate('/login', { replace: true });
              }}
              className="flex w-full items-center justify-center gap-2 rounded-md px-2 py-2 text-xs text-[color:var(--text-muted)] transition hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]"
            >
              <LogOutIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Sign out
            </button>
          </div>

          <div className="hidden lg:block mt-auto w-full border-t border-[color:var(--border-subtle)] pt-3">
            <button
              type="button"
              onClick={() => navigate('/profile')}
              className="block w-full rounded-md px-1 py-1 text-left transition hover:bg-[color:var(--bg-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35"
              title={user?.email}
            >
              <div className="truncate text-xs font-medium text-[color:var(--text-primary)]">
                {user?.name ?? 'Profile'}
              </div>
              {user?.email && (
                <div className="mt-0.5 truncate text-[10px] text-[color:var(--text-muted)]/80">{user.email}</div>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                logout();
                navigate('/login', { replace: true });
              }}
              className="mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[color:var(--text-muted)] transition hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]"
            >
              <LogOutIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Sign out
            </button>
            <p className="px-1 pt-2 text-[10px] text-[color:var(--text-muted)]/60" title={`TaskFlow v${APP_VERSION}`}>
              v{APP_VERSION}
            </p>
          </div>
        </nav>

        <main className="flex-1 min-h-0 overflow-y-auto w-full min-w-0 px-4 sm:px-5 lg:px-6 xl:px-8 py-4 lg:py-6">
          {tab === 'home' && (
            <section className="space-y-6 w-full min-w-0">
              <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 sm:p-6">
                <h2 className="text-lg font-semibold tracking-tight text-[color:var(--text-primary)]">Workspace hub</h2>
                <p className="mt-1 text-sm text-[color:var(--text-muted)]">
                  Choose a workspace below to open the Project Manager with that context, or create a new one. For workspace
                  profile and integrations, open the Project Manager and use the <strong className="text-[color:var(--text-primary)]">Workspace</strong>{' '}
                  item in the left sidebar.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:gap-4">
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-4 sm:p-5">
                  <p className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">Inbox</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {inboxUnread === null ? '—' : inboxUnread}
                  </p>
                  <p className="mt-1 text-xs text-[color:var(--text-muted)]">Unread messages (global)</p>
                  <button
                    type="button"
                    onClick={() => setTab('inbox')}
                    className="mt-3 text-xs font-medium text-[color:var(--accent)] hover:underline"
                  >
                    Open inbox →
                  </button>
                </div>
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-4 sm:p-5">
                  <p className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">Active workspace</p>
                  <p className="mt-2 text-base font-semibold truncate">{activeOrg?.name ?? '—'}</p>
                  <p className="mt-1 text-xs text-[color:var(--text-muted)]">
                    {usageLoading ? (
                      'Loading stats…'
                    ) : (
                      <>
                        <span className="text-[color:var(--text-primary)] font-medium">{memberCount ?? '—'}</span> members ·{' '}
                        <span className="text-[color:var(--text-primary)] font-medium">{projectTotal ?? '—'}</span> projects
                      </>
                    )}
                  </p>
                </div>
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-4 sm:p-5">
                  <p className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">Account</p>
                  <p className="mt-2 text-base font-semibold truncate">{user?.name ?? 'User'}</p>
                  <p className="mt-1 text-xs text-[color:var(--text-muted)] truncate">{user?.email ?? 'Signed in'}</p>
                </div>
              </div>

              <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">Your workspaces</h3>

              {!hasWorkspaceAccess ? (
                <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-8 text-center">
                  <p className="text-sm text-[color:var(--text-muted)]">You are not in any workspace yet.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setCreateError(null);
                      setCreateOpen(true);
                    }}
                    className="mt-4 rounded-lg bg-[color:var(--accent)] px-4 py-2 text-xs font-medium text-white"
                  >
                    Create your first workspace
                  </button>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {orgs.map((o) => {
                    const isActive = o.id === activeOrgId;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        onClick={() => void enterWorkspaceInProjectManager(o.id)}
                        className={`rounded-xl border p-4 text-left transition hover:bg-[color:var(--bg-surface)] ${
                          isActive
                            ? 'border-[color:var(--accent)]/60 ring-1 ring-[color:var(--accent)]/25 bg-[color:var(--bg-elevated)]'
                            : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold text-[color:var(--text-primary)] truncate">{o.name}</span>
                          {isActive && (
                            <span className="shrink-0 text-[10px] uppercase font-semibold text-[color:var(--accent)]">Active</span>
                          )}
                        </div>
                        <p className="mt-1 font-mono text-[11px] text-[color:var(--text-muted)] truncate">{o.slug}</p>
                        <p className="mt-2 text-xs text-[color:var(--text-muted)]">
                          Role: <span className="text-[color:var(--text-primary)]">{o.role === 'org_admin' ? 'Admin' : 'Member'}</span>
                        </p>
                        <p className="mt-3 text-xs font-medium text-[color:var(--accent)]">Open in Project Manager →</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {tab === 'inbox' && (
            <section className="h-full min-h-0 w-full min-w-0">
              <Inbox forceLoad />
            </section>
          )}

          {tab === 'shortcuts' && (
            <section className="space-y-4 w-full min-w-0">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">Open in Project Manager</h2>
              <p className="text-xs text-[color:var(--text-muted)]">
                Opens the standard TaskFlow layout in a new browser tab (same account).
              </p>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {shortcutLinks.map((item) => (
                  <li key={item.path + item.label} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => openProjectManagerInNewTab(item.path)}
                      className="w-full min-w-0 h-full text-left rounded-md border border-[color:var(--border-subtle)] px-3 py-2.5 text-xs font-medium hover:bg-[color:var(--bg-surface)]"
                    >
                      {item.label}
                      <span className="block text-[10px] font-normal text-[color:var(--text-muted)] mt-0.5 font-mono">{item.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-[color:var(--text-muted)]">
                This window: <span className="font-mono text-[color:var(--text-primary)]">{taskflowAppSettingsHref()}</span>
              </p>
            </section>
          )}
        </main>
      </div>

      {createOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-ws-title"
        >
          <div className="w-full max-w-md rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] p-5 shadow-xl">
            <h2 id="create-ws-title" className="text-sm font-semibold text-[color:var(--text-primary)] mb-1">
              Create workspace
            </h2>
            <p className="text-[11px] text-[color:var(--text-muted)] mb-4">You will become an org admin and can switch to it immediately.</p>
            {createError && (
              <div className="mb-3 rounded-md border border-[color:var(--color-blocked)]/40 bg-[color:var(--color-blocked)]/10 px-2 py-1.5 text-xs text-[color:var(--color-blocked)]">
                {createError}
              </div>
            )}
            <form onSubmit={submitCreateWorkspace} className="space-y-3">
              <label className="block space-y-1">
                <span className="text-[11px] text-[color:var(--text-muted)]">Name</span>
                <input
                  required
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-2 text-xs"
                  placeholder="Acme delivery"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] text-[color:var(--text-muted)]">Description (optional)</span>
                <textarea
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-2 text-xs"
                />
              </label>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={createBusy}
                  onClick={() => {
                    setCreateOpen(false);
                    setCreateError(null);
                  }}
                  className="rounded-md border border-[color:var(--border-subtle)] px-3 py-1.5 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createBusy}
                  className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {createBusy ? 'Creating…' : 'Create & switch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
