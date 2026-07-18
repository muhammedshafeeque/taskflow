import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Inbox from './Inbox';
import { taskflowAppSettingsHref } from '../lib/appSettingsHref';
import { SunIcon, MoonIcon, InboxIcon, LogOutIcon, DashboardIcon, SettingsIcon } from '../components/icons/NavigationIcons';
import { APP_VERSION } from '../appVersion';
import { APP_NAME } from '../brand';
import AtriumLogo from '../components/AtriumLogo';
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
  const { user, token, logout } = useAuth();
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
      items.push({ label: 'Organization', path: '/settings/workspace' });
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
    navigate('/');
  }

  return (
    <div className="min-h-screen flex flex-col bg-[color:var(--bg-page)] text-[color:var(--text-primary)]">
      <header className="shrink-0 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-4 sm:px-5 lg:px-6 xl:px-8 py-3 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
            <AtriumLogo variant="mark" className="h-7 w-7" useSvg={false} />
          </span>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold tracking-tight">{APP_NAME} — settings</h1>
            <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5 truncate">
              Organization settings and inbox. You can close this tab when you are done.
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
              Open Home
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
            <p className="px-1 pt-2 text-[10px] text-[color:var(--text-muted)]/60" title={`${APP_NAME} v${APP_VERSION}`}>
              v{APP_VERSION}
            </p>
          </div>
        </nav>

        <main className="flex-1 min-h-0 overflow-y-auto w-full min-w-0 px-4 sm:px-5 lg:px-6 xl:px-8 py-4 lg:py-6">
          {tab === 'home' && (
            <section className="space-y-6 w-full min-w-0">
              <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 sm:p-6">
                <h2 className="text-lg font-semibold tracking-tight text-[color:var(--text-primary)]">Settings hub</h2>
                <p className="mt-1 text-sm text-[color:var(--text-muted)]">
                  Open Home to use modules, or manage your organization profile from the Project Manager sidebar.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:gap-4">
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-4 sm:p-5">
                  <p className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">Inbox</p>
                  <p className="mt-2 text-2xl font-semibold tabular-nums">
                    {inboxUnread === null ? '—' : inboxUnread}
                  </p>
                  <p className="mt-1 text-xs text-[color:var(--text-muted)]">Unread messages</p>
                  <button
                    type="button"
                    onClick={() => setTab('inbox')}
                    className="mt-3 text-xs font-medium text-[color:var(--accent)] hover:underline"
                  >
                    Open inbox →
                  </button>
                </div>
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-4 sm:p-5">
                  <p className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">Organization</p>
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
                  {hasWorkspaceAccess && (
                    <button
                      type="button"
                      onClick={() => void enterWorkspaceInProjectManager(activeOrgId!)}
                      className="mt-3 text-xs font-medium text-[color:var(--accent)] hover:underline"
                    >
                      Open Home →
                    </button>
                  )}
                </div>
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-4 sm:p-5">
                  <p className="text-xs uppercase tracking-wide text-[color:var(--text-muted)]">Account</p>
                  <p className="mt-2 text-base font-semibold truncate">{user?.name ?? 'User'}</p>
                  <p className="mt-1 text-xs text-[color:var(--text-muted)] truncate">{user?.email ?? 'Signed in'}</p>
                </div>
              </div>
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
                Opens the standard {APP_NAME} layout in a new browser tab (same account).
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
    </div>
  );
}
