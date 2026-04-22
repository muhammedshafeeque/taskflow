import { NavLink, useNavigate, useLocation, useParams, Link } from 'react-router-dom';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNotifications } from '../contexts/NotificationsContext';
import { toAppPath } from '../lib/navigationUrl';
import NotificationToast from './NotificationToast';
import ConfirmModal from './ConfirmModal';
import { projectsApi, issuesApi, type Project, type Issue, getIssueKey } from '../lib/api';
import { APP_VERSION } from '../appVersion';
import {
  DashboardIcon,
  InboxIcon,
  ProjectsIcon,
  UsersIcon,
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
  const nav: NavItem[] = [
    { to: '/', label: 'Dashboard', icon: <DashboardIcon />, end: true },
    { to: '/inbox', label: 'Inbox', icon: <InboxIcon /> },
  ];
  const has = (p: string) => perms.includes(p);
  if (has('project.project.list') || has('projects:list') || has('project.project.create') || has('projects:create')) {
    nav.push({ to: '/projects', label: 'Projects', icon: <ProjectsIcon /> });
  }
  if (has('project.project.create') || has('projects:create')) {
    nav.push({ to: '/project-templates', label: 'Templates', icon: <PackageIcon /> });
  }
  if (has('project.project.list') || has('projects:list')) {
    nav.push({ to: '/issues', label: 'All Issues', icon: <IssuesIcon /> });
  }
  if (has('taskflow.report.read') || has('reports:view')) {
    nav.push({ to: '/timesheet', label: 'Timesheet', icon: <TimesheetIcon /> });
  }
  if (has('taskflow.analytics.view') || has('analytics:view')) {
    nav.push({ to: '/performance-report', label: 'Performance', icon: <TimesheetIcon /> });
    nav.push({ to: '/workload', label: 'Workload', icon: <TimesheetIcon /> });
  }
  if (has('taskflow.report.read') || has('reports:view')) {
    nav.push({ to: '/estimates', label: 'Estimates', icon: <TimesheetIcon /> });
  }
  if (user?.role === 'admin') {
    nav.push({ to: '/audit-logs', label: 'Audit logs', icon: <SettingsIcon /> });
  }
  if (has('taskflow.analytics.view') || has('analytics:view')) {
    nav.push({ to: '/analytics', label: 'Analytics', icon: <SettingsIcon /> });
  }
  if (has('taskflow.report.read') || has('reports:view')) {
    nav.push({ to: '/reports', label: 'Reports', icon: <SettingsIcon /> });
  }
  if (has('taskflow.cost_report.view')) {
    nav.push({ to: '/cost-usage', label: 'Cost report', icon: <TimesheetIcon /> });
  }
  if (has('auth.user.list') || has('auth.user.create') || has('users:list') || has('users:invite')) {
    nav.push({ to: '/users', label: 'Users', icon: <UsersIcon /> });
  }
  if (has('auth.role.manage_all') || has('roles:manage')) {
    nav.push({ to: '/roles', label: 'Roles', icon: <RolesIcon /> });
  }
  if (
    has('taskflow.customer_portal.org.manage') ||
    has('taskflow.customer_portal.org.view') ||
    has('customers:manage') ||
    has('customers:view')
  ) {
    nav.push({ to: '/admin/customer-orgs', label: 'Customer Orgs', icon: <UsersIcon /> });
  }
  if (has('taskflow.customer_portal.request.approve') || has('customer-requests:approve')) {
    nav.push({ to: '/admin/customer-requests', label: 'Customer Requests', icon: <IssuesIcon /> });
  }
  nav.push({ to: '/profile', label: 'Profile', icon: <ProfileIcon /> });
  return nav;
}

const PROJECT_NAV_ITEMS: { to: string; label: string; icon: ReactNode; permission: string; global?: boolean; globalPerm?: boolean }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: <DashboardIcon />, permission: 'issue.issue.read' },
  { to: '/issues', label: 'Issues', icon: <IssuesIcon />, permission: 'issue.issue.read' },
  { to: '/boards', label: 'Boards', icon: <BoardsIcon />, permission: 'board.board.read' },
  { to: '/backlog', label: 'Backlog', icon: <BoardsIcon />, permission: 'sprint.sprint.read' },
  { to: '/sprints', label: 'Sprints', icon: <SprintsIcon />, permission: 'sprint.sprint.read' },
  { to: '/gantt', label: 'Gantt', icon: <GanttIcon />, permission: 'issue.issue.read' },
  { to: '/roadmap', label: 'Roadmap', icon: <GanttIcon />, permission: 'roadmap.roadmap.read' },
  { to: '/versions', label: 'Versions', icon: <VersionsIcon />, permission: 'version.version.read' },
  { to: '/timesheet', label: 'Timesheet', icon: <TimesheetIcon />, permission: 'issue.issue.read' },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon />, permission: 'setting.project_setting.update' },
];

function projectNav(projectId: string, projectPermissions: string[], globalPermissions: string[]) {
  const base = `/projects/${projectId}`;
  const pp = projectPermissions;
  const gp = globalPermissions;
  const can = (item: (typeof PROJECT_NAV_ITEMS)[number]) => {
    if (item.globalPerm) {
      return gp.includes(item.permission) || gp.includes('taskflow.hr.designation.manage') || gp.includes('designations:manage');
    }
    return (
      pp.includes(item.permission) ||
      (item.permission === 'issue.issue.read' && (pp.includes('project:view') || pp.includes('issues:view'))) ||
      (item.permission === 'board.board.read' && pp.includes('boards:view')) ||
      (item.permission === 'sprint.sprint.read' && pp.includes('sprints:view')) ||
      (item.permission === 'roadmap.roadmap.read' && pp.includes('roadmaps:view')) ||
      (item.permission === 'version.version.read' && pp.includes('versions:view')) ||
      (item.permission === 'setting.project_setting.update' && pp.includes('settings:manage'))
    );
  };
  const items = [
    { to: '/projects', label: 'Projects', icon: <ProjectsIcon />, end: true },
    { to: '/inbox', label: 'Inbox', icon: <InboxIcon />, end: true },
    ...PROJECT_NAV_ITEMS.filter((item) => can(item)).map((item) => ({
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
  const nav = projectId ? projectNav(projectId, projectPermissions, user?.permissions ?? []) : globalNavItems;

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Issue[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

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

  function performLogout() {
    setLogoutConfirmOpen(false);
    logout();
    navigate('/login');
  }

  return (
    <div className="h-screen min-h-0 flex bg-[color:var(--bg-page)] text-[color:var(--text-primary)]">
      <aside
        className={`flex flex-col border-r border-[color:var(--sidebar-active-bg)] bg-[color:var(--sidebar-bg)] card-shadow shrink-0 transition-[width] duration-200 ease-in-out ${
          sidebarCollapsed ? 'w-16' : 'w-55'
        }`}
      >
        <div className="p-3 border-b border-[color:var(--sidebar-active-bg)] flex items-center gap-2 min-h-[4.5rem]">
          {sidebarCollapsed ? (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--sidebar-logo-bg)] text-[color:var(--sidebar-text-active)] font-bold text-sm flex-1" title="TaskFlow">
              TF
            </span>
          ) : (
            <div className="min-w-0 flex-1 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--sidebar-logo-bg)] text-[color:var(--sidebar-text-active)] font-bold text-sm shrink-0">
                TF
              </span>
              <div className="min-w-0">
                <h1 className="text-base font-bold tracking-tight text-[color:var(--sidebar-text-active)]">TaskFlow</h1>
                {projectId && (
                  <p className="text-[11px] text-[color:var(--sidebar-text)] mt-0.5 truncate" title={project?.name ?? '…'}>
                    {projectLoading ? 'Loading…' : project?.name ?? '…'}
                  </p>
                )}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={() => setSidebarCollapsed((c) => !c)}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md border border-[color:var(--sidebar-active-bg)] text-[color:var(--sidebar-text)] hover:bg-[color:var(--sidebar-hover-bg)] hover:text-[color:var(--sidebar-text-active)] transition"
          >
            {sidebarCollapsed ? (
              <ChevronRightIcon className="w-4 h-4" />
            ) : (
              <ChevronLeftIcon className="w-4 h-4" />
            )}
          </button>
        </div>
        <nav className="flex-1 p-2 space-y-0.5 overflow-x-hidden mt-1">
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
                  return `sidebar-nav-item animation-delay-${(i + 1) * 100} animate-fade-in ${
                    sidebarCollapsed ? 'justify-center' : ''
                  } ${active ? 'active' : ''}`;
                }}
              >
                <span className="w-5 h-5 flex shrink-0 items-center justify-center">{item.icon}</span>
                {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
              </NavLink>
            );
          })}
        </nav>
        <div
          className={`border-t border-[color:var(--sidebar-active-bg)] p-3 ${
            sidebarCollapsed ? 'flex flex-col items-center gap-2' : 'space-y-2'
          }`}
        >
          {!sidebarCollapsed ? (
            <>
              <Link
                to="/profile"
                className="block rounded-md px-1 py-1 text-left transition hover:bg-[color:var(--sidebar-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--sidebar-bg)]"
                title={user?.email}
              >
                <div className="truncate text-xs font-medium text-[color:var(--sidebar-text-active)]">
                  {user?.name ?? 'Profile'}
                </div>
                {user?.email && (
                  <div className="mt-0.5 truncate text-[10px] text-[color:var(--sidebar-text)]/80">{user.email}</div>
                )}
              </Link>
              <button
                type="button"
                onClick={() => setLogoutConfirmOpen(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[color:var(--sidebar-text)] transition hover:bg-[color:var(--sidebar-hover-bg)] hover:text-[color:var(--sidebar-text-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--sidebar-bg)]"
              >
                <LogOutIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Sign out
              </button>
              <p className="px-1 pt-1 text-[10px] text-[color:var(--sidebar-text)]/50" title={`TaskFlow v${APP_VERSION}`}>
                v{APP_VERSION}
              </p>
            </>
          ) : (
            <>
              <Link
                to="/profile"
                title={user?.name ?? 'Profile'}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--sidebar-logo-bg)] text-xs font-semibold text-[color:var(--sidebar-text-active)] hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/40"
              >
                {(user?.name?.trim().charAt(0) || user?.email?.charAt(0) || '?').toUpperCase()}
              </Link>
              <button
                type="button"
                onClick={() => setLogoutConfirmOpen(true)}
                title="Sign out"
                aria-label="Sign out"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[color:var(--sidebar-text)] transition hover:bg-[color:var(--sidebar-hover-bg)] hover:text-[color:var(--sidebar-text-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/40"
              >
                <LogOutIcon className="h-4 w-4" aria-hidden />
              </button>
              <span className="text-[9px] text-[color:var(--sidebar-text)]/50" title={`TaskFlow v${APP_VERSION}`}>
                v{APP_VERSION}
              </span>
            </>
          )}
        </div>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="shrink-0 flex items-center justify-end gap-3 px-4 py-2 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] shadow-[0_1px_0_var(--border-subtle)]">
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
                  className="absolute -top-0.5 -right-0.5 min-w-2.5 h-2.5 px-1 rounded-full bg-[color:var(--color-blocked)] ring-2 ring-[color:var(--bg-surface)] text-[10px] text-white flex items-center justify-center"
                  aria-hidden
                >
                  {unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : ''}
                </span>
              )}
            </button>

            {notifOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />
                <div className="absolute right-0 z-20 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] shadow-[0_8px_24px_rgba(0,0,0,0.24)] overflow-hidden">
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
                          const isUnread = n.isRead === false || (!n.isRead && !n.readAt);
                          const href = toAppPath(n.link || n.url || '');
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
              className="w-full px-3 py-1.5 pl-8 rounded-md bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] text-xs focus:bg-[color:var(--bg-surface)] focus:border-[color:var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/40 outline-none disabled:opacity-60 disabled:cursor-not-allowed transition"
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
                <div className="absolute right-0 z-20 mt-1 w-full rounded-lg bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] shadow-[0_8px_24px_rgba(0,0,0,0.24)] max-h-64 overflow-y-auto">
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
      <ConfirmModal
        open={logoutConfirmOpen}
        title="Sign out?"
        message="You will need to sign in again to continue."
        confirmLabel="Sign out"
        variant="default"
        onConfirm={performLogout}
        onCancel={() => setLogoutConfirmOpen(false)}
      />
    </div>
  );
}
