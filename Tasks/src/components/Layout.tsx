import { NavLink, useNavigate, useLocation, useParams, Link } from 'react-router-dom';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationsContext';
import NotificationToast from './NotificationToast';
import { projectsApi, issuesApi, type Project, type Issue, getIssueKey } from '../lib/api';
import {
  DashboardIcon,
  InboxIcon,
  ProjectsIcon,
  UsersIcon,
  DesignationsIcon,
  RolesIcon,
  ProfileIcon,
  IssuesIcon,
  BoardsIcon,
  GanttIcon,
  SprintsIcon,
  VersionsIcon,
  TimesheetIcon,
  SettingsIcon,
  SearchIcon,
  SunIcon,
  MoonIcon,
  BellIcon,
  PackageIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LogOutIcon,
  FullscreenIcon,
  FullscreenExitIcon,
} from './icons/NavigationIcons';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

function buildGlobalNav(user: { mustChangePassword?: boolean; permissions?: string[]; role?: string } | null): NavItem[] {
  const perms = user?.permissions ?? [];
  const firstLogin = user?.mustChangePassword === true;
  if (firstLogin) {
    return [
      { to: '/inbox', label: 'Inbox', icon: <InboxIcon /> },
      { to: '/projects', label: 'Projects', icon: <ProjectsIcon /> },
      { to: '/project-templates', label: 'Templates', icon: <PackageIcon /> },
      { to: '/profile', label: 'Profile', icon: <ProfileIcon /> },
    ];
  }
  const nav: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: <DashboardIcon />, end: true },
    { to: '/inbox', label: 'Inbox', icon: <InboxIcon /> },
    { to: '/projects', label: 'Projects', icon: <ProjectsIcon /> },
    { to: '/project-templates', label: 'Templates', icon: <PackageIcon /> },
    { to: '/issues', label: 'All Issues', icon: <IssuesIcon /> },
    { to: '/timesheet', label: 'Timesheet', icon: <TimesheetIcon /> },
    { to: '/workload', label: 'Workload', icon: <TimesheetIcon /> },
    { to: '/estimates', label: 'Estimates', icon: <TimesheetIcon /> },
  ];
  if (user?.role === 'admin') {
    nav.push({ to: '/audit-logs', label: 'Audit logs', icon: <SettingsIcon /> });
  }
  if (perms.includes('analytics:view')) {
    nav.push({ to: '/analytics', label: 'Analytics', icon: <SettingsIcon /> });
  }
  if (perms.includes('reports:view')) {
    nav.push({ to: '/reports', label: 'Reports', icon: <SettingsIcon /> });
  }
  if (perms.includes('issues:view')) {
    nav.push({ to: '/cost-usage', label: 'Cost report', icon: <TimesheetIcon /> });
  }
  if (perms.includes('users:list') || perms.includes('users:invite')) {
    nav.push({ to: '/users', label: 'Users', icon: <UsersIcon /> });
  }
  if (perms.includes('designations:manage')) {
    nav.push({ to: '/designations', label: 'Designations', icon: <DesignationsIcon /> });
  }
  if (perms.includes('roles:manage')) {
    nav.push({ to: '/roles', label: 'Roles', icon: <RolesIcon /> });
  }
  nav.push({ to: '/profile', label: 'Profile', icon: <ProfileIcon /> });
  return nav;
}

const PROJECT_NAV_ITEMS: { to: string; label: string; icon: ReactNode; permission: string; global?: boolean }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: <DashboardIcon />, permission: 'project:view' },
  { to: '/issues', label: 'Issues', icon: <IssuesIcon />, permission: 'issues:view' },
  { to: '/boards', label: 'Boards', icon: <BoardsIcon />, permission: 'boards:view' },
  { to: '/backlog', label: 'Backlog', icon: <BoardsIcon />, permission: 'sprints:view' },
  { to: '/sprints', label: 'Sprints', icon: <SprintsIcon />, permission: 'sprints:view' },
  { to: '/gantt', label: 'Gantt', icon: <GanttIcon />, permission: 'issues:view' },
  { to: '/roadmap', label: 'Roadmap', icon: <GanttIcon />, permission: 'roadmaps:view' },
  { to: '/versions', label: 'Versions', icon: <VersionsIcon />, permission: 'versions:view' },
  { to: '/timesheet', label: 'Timesheet', icon: <TimesheetIcon />, permission: 'project:view' },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon />, permission: 'settings:manage' },
];

function projectNav(projectId: string, projectPermissions: string[]) {
  const base = `/projects/${projectId}`;
  const items = [
    { to: '/projects', label: 'Projects', icon: <ProjectsIcon />, end: true },
    { to: '/inbox', label: 'Inbox', icon: <InboxIcon />, end: true },
    ...PROJECT_NAV_ITEMS.filter((item) => projectPermissions.includes(item.permission)).map((item) => ({
      to: item.global ? item.to : `${base}${item.to}`,
      label: item.label,
      icon: item.icon,
    })),
  ];
  return items;
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout, token } = useAuth();
  const {
    latestInboxMessage,
    latestPushNotification,
    dismissInboxToast,
    dismissPushToast,
    notifications,
    unreadCount,
    markRead,
    markAllRead,
  } = useNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId: projectIdParam } = useParams<{ projectId?: string }>();
  const projectIdFromPath = location.pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const projectId = projectIdParam ?? projectIdFromPath;
  const [project, setProject] = useState<Project | null>(null);
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectPermissions, setProjectPermissions] = useState<string[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = window.localStorage.getItem('taskflow_theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('taskflow_sidebar_collapsed') === 'true';
  });
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    function onFullScreenChange() {
      setIsFullScreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener('fullscreenchange', onFullScreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullScreenChange);
  }, []);

  async function toggleFullScreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // e.g. user denied or not supported
    }
  }

  useEffect(() => {
    try {
      window.localStorage.setItem('taskflow_sidebar_collapsed', String(sidebarCollapsed));
    } catch {
      // ignore
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!projectId || !token) {
      setProject(null);
      setProjectLoading(false);
      setProjectPermissions([]);
      return;
    }
    setProjectLoading(true);
    projectsApi.get(projectId, token).then((res) => {
      setProjectLoading(false);
      if (res.success && res.data) setProject(res.data);
      else {
        setProject(null);
        setProjectPermissions([]);
        navigate('/projects', { replace: true });
      }
    });
  }, [projectId, token, navigate]);

  useEffect(() => {
    if (!projectId || !token) return;
    projectsApi.getMyPermissions(projectId, token).then((res) => {
      if (res.success && res.data && 'permissions' in res.data) {
        setProjectPermissions((res.data as { permissions: string[] }).permissions ?? []);
      } else setProjectPermissions([]);
    });
  }, [projectId, token]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('taskflow_theme', theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const globalNavItems = useMemo(() => buildGlobalNav(user), [user]);
  const nav = projectId ? projectNav(projectId, projectPermissions) : globalNavItems;

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Issue[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchOpen(false);
      return;
    }
    if (!token || !projectId) return;
    const t = setTimeout(() => {
      setSearchLoading(true);
      issuesApi.search(projectId, searchQuery.trim(), 1, 10, token).then((res) => {
        setSearchLoading(false);
        if (res.success && res.data) {
          setSearchResults(res.data.data);
          setSearchOpen(true);
        } else setSearchResults([]);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [searchQuery, token, projectId]);

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="h-screen min-h-0 flex bg-[color:var(--bg-page)] text-[color:var(--text-primary)]">
      <aside
        className={`flex flex-col border-r border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] shrink-0 transition-[width] duration-200 ease-in-out ${
          sidebarCollapsed ? 'w-16' : 'w-64'
        }`}
      >
        <div className="p-4 border-b border-[color:var(--border-subtle)] flex items-center gap-2 min-h-[4.5rem]">
          {sidebarCollapsed ? (
            <span className="text-lg font-semibold tracking-tight flex-1 text-center" title="TaskFlow">
              TF
            </span>
          ) : (
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-tight">TaskFlow</h1>
              {projectId && (
                <p className="text-xs text-[color:var(--text-muted)] mt-1 truncate" title={project?.name ?? '…'}>
                  {projectLoading ? 'Loading…' : project?.name ?? '…'}
                </p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-[color:var(--text-muted)] border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)] transition"
          >
            {sidebarCollapsed ? (
              <ChevronRightIcon className="w-4 h-4" />
            ) : (
              <ChevronLeftIcon className="w-4 h-4" />
            )}
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-0.5 overflow-x-hidden">
          {nav.map((item, i) => {
            const isProjectsLink = item.to === '/projects';
            const useEnd = 'end' in item ? (item as { end?: boolean }).end : isProjectsLink;
            return (
              <NavLink
                key={item.to + item.label}
                to={item.to}
                end={useEnd}
                title={sidebarCollapsed ? item.label : undefined}
                className={({ isActive }) => {
                  const active =
                    isProjectsLink ? isActive : isActive || (projectId && location.pathname.startsWith(item.to));
                  return `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition animation-delay-${
                    (i + 1) * 100
                  } animate-fade-in hover-elevated ${
                    sidebarCollapsed ? 'justify-center px-0 py-2.5' : ''
                  } ${
                    active
                      ? 'bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] border border-[color:var(--border-subtle)]'
                      : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)]'
                  }`;
                }}
              >
                <span className="w-5 h-5 flex shrink-0 items-center justify-center">{item.icon}</span>
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>
        <div className={`p-3 border-t border-[color:var(--border-subtle)] space-y-2 ${sidebarCollapsed ? 'flex flex-col items-center' : ''}`}>
          {!sidebarCollapsed && (
            <div className="px-3 py-2 text-[color:var(--text-muted)] text-xs truncate" title={user?.email}>
              {user?.name}
            </div>
          )}
          <button
            type="button"
            onClick={handleLogout}
            title="Sign out"
            className={`flex items-center justify-center rounded-md text-[color:var(--text-muted)] border border-transparent hover:border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-surface)] transition ${
              sidebarCollapsed ? 'w-full py-2 px-0' : 'w-full px-3 py-1.5 text-xs'
            }`}
          >
            {sidebarCollapsed ? (
              <LogOutIcon className="w-5 h-5" aria-hidden />
            ) : (
              'Sign out'
            )}
          </button>
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="shrink-0 flex items-center justify-end gap-3 px-4 py-2 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]">
          <button
            type="button"
            onClick={toggleFullScreen}
            title={isFullScreen ? 'Exit full screen' : 'Full screen'}
            aria-label={isFullScreen ? 'Exit full screen' : 'Full screen'}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-surface)] hover:text-[color:var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40 focus:ring-offset-0 transition"
          >
            {isFullScreen ? (
              <FullscreenExitIcon className="w-3.5 h-3.5" />
            ) : (
              <FullscreenIcon className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-surface)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40 focus:ring-offset-0"
          >
            {theme === 'dark' ? <SunIcon className="w-3.5 h-3.5" /> : <MoonIcon className="w-3.5 h-3.5" />}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setNotifOpen((o) => !o)}
              aria-label="Notifications"
              className="relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-surface)] hover:text-[color:var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40 focus:ring-offset-0 transition"
            >
              <BellIcon className="w-3.5 h-3.5" />
              {(unreadCount > 0 || latestInboxMessage || latestPushNotification) && (
                <span
                  className="absolute -top-0.5 -right-0.5 min-w-2.5 h-2.5 px-1 rounded-full bg-[color:var(--accent)] ring-2 ring-[color:var(--bg-surface)] text-[10px] text-white flex items-center justify-center"
                  aria-hidden
                >
                  {unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : ''}
                </span>
              )}
            </button>

            {notifOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] shadow-2xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-[color:var(--border-subtle)] flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[color:var(--text-primary)]">Notifications</span>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => markAllRead()}
                        className="text-[11px] text-[color:var(--accent)] hover:underline font-medium"
                        disabled={unreadCount === 0}
                      >
                        Mark all read
                      </button>
                      <Link to="/inbox" className="text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]">
                        Inbox →
                      </Link>
                    </div>
                  </div>
                  <div className="max-h-96 overflow-auto">
                    {notifications.length === 0 ? (
                      <div className="px-4 py-6 text-xs text-[color:var(--text-muted)]">No notifications yet.</div>
                    ) : (
                      <ul className="divide-y divide-[color:var(--border-subtle)]/70">
                        {notifications.slice(0, 20).map((n) => {
                          const isUnread = !n.readAt;
                          const href = n.url && n.url.startsWith('http') ? n.url : (n.url || '');
                          return (
                            <li key={n._id} className={`px-4 py-3 hover:bg-[color:var(--bg-surface)] transition ${isUnread ? 'bg-[color:var(--bg-surface)]/40' : ''}`}>
                              <Link
                                to={href || '/'}
                                onClick={async () => {
                                  if (isUnread) await markRead(n._id);
                                  setNotifOpen(false);
                                }}
                                className="block"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="text-xs font-medium text-[color:var(--text-primary)] truncate">{n.title}</div>
                                    {n.body && (
                                      <div className="mt-0.5 text-[11px] text-[color:var(--text-muted)] line-clamp-2">{n.body}</div>
                                    )}
                                  </div>
                                  {isUnread && <span className="mt-1 h-2 w-2 rounded-full bg-[color:var(--accent)] shrink-0" />}
                                </div>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="relative w-full max-w-xs">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => projectId && searchResults.length > 0 && setSearchOpen(true)}
              placeholder={projectId ? 'Search by Ticket ID or title…' : 'Open a project to search issues'}
              disabled={!projectId}
              className="w-full px-3 py-1.5 pl-8 rounded-md bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] text-xs focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/40 outline-none disabled:opacity-60 disabled:cursor-not-allowed"
            />
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--text-muted)] pointer-events-none">
              {searchLoading ? (
                <span className="text-[10px]">…</span>
              ) : (
                <SearchIcon className="w-3.5 h-3.5" />
              )}
            </span>
            {searchOpen && projectId && searchResults.length > 0 && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSearchOpen(false)} />
                <div className="absolute right-0 z-20 mt-1 w-full rounded-md bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] shadow-xl max-h-64 overflow-y-auto">
                  {searchResults.map((issue) => (
                    <Link
                      key={issue._id}
                      to={`/projects/${projectId}/issues/${encodeURIComponent(getIssueKey(issue))}`}
                      onClick={() => {
                        setSearchOpen(false);
                        setSearchQuery('');
                        setSearchResults([]);
                      }}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-[color:var(--bg-surface)] text-left transition"
                    >
                      <span className="font-mono text-[11px] text-[color:var(--text-muted)] shrink-0">
                        {getIssueKey(issue)}
                      </span>
                      <span className="text-xs text-[color:var(--text-primary)] truncate">
                        {issue.title}
                      </span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-auto bg-[color:var(--bg-page)] flex flex-col">
          {children}
        </main>
      </div>
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        <div className="pointer-events-auto">
          {latestPushNotification && (
            <NotificationToast
              title={latestPushNotification.title}
              body={latestPushNotification.body}
              url={latestPushNotification.url}
              onDismiss={dismissPushToast}
            />
          )}
        </div>
        <div className="pointer-events-auto">
          {latestInboxMessage && (() => {
            const meta = latestInboxMessage.meta as { url?: string; projectId?: string; issueKey?: string } | undefined;
            const inboxUrl = meta?.url ?? (meta?.projectId && meta?.issueKey
              ? `/projects/${meta.projectId}/issues/${encodeURIComponent(meta.issueKey)}`
              : '/inbox');
            return (
              <NotificationToast
                title={(latestInboxMessage.title as string) ?? 'New message'}
                body={(latestInboxMessage.body as string) ?? ''}
                url={inboxUrl}
                onDismiss={dismissInboxToast}
              />
            );
          })()}
        </div>
      </div>
    </div>
  );
}
