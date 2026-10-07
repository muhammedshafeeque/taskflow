import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { userHasPermission } from '../utils/permissions';
import { CUSTOMER_PERMISSIONS } from '@shared/constants/permissions';
import {
  FiGrid,
  FiList,
  FiPlusCircle,
  FiUsers,
  FiShield,
  FiFolder,
  FiCheckSquare,
  FiLogOut,
  FiChevronLeft,
  FiChevronRight,
  FiMenu,
  FiX,
  FiLifeBuoy,
} from 'react-icons/fi';
import AtriumLogo from './AtriumLogo';
import { APP_NAME } from '../brand';

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

export default function PortalLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('portal_sidebar_collapsed') === 'true';
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const perms = user?.customerPermissions ?? [];

  const navItems: NavItem[] = [
    { to: '/portal', label: 'Dashboard', icon: <FiGrid />, end: true },
    { to: '/portal/requests', label: 'Issues', icon: <FiList /> },
    { to: '/portal/requests/new', label: 'New issue', icon: <FiPlusCircle /> },
    { to: '/portal/tickets', label: 'Tickets', icon: <FiLifeBuoy /> },
    { to: '/portal/projects', label: 'Projects', icon: <FiFolder /> },
    { to: '/portal/status-reports', label: 'Status reports', icon: <FiList /> },
  ];

  if (userHasPermission(perms, CUSTOMER_PERMISSIONS.LEGACY.REQUEST.APPROVE)) {
    navItems.push({ to: '/portal/approval-queue', label: 'Approval Queue', icon: <FiCheckSquare /> });
  }
  if (userHasPermission(perms, CUSTOMER_PERMISSIONS.LEGACY.TEAM.VIEW)) {
    navItems.push({ to: '/portal/team', label: 'Team', icon: <FiUsers /> });
  }
  if (userHasPermission(perms, CUSTOMER_PERMISSIONS.LEGACY.ROLE_MANAGE)) {
    navItems.push({ to: '/portal/roles', label: 'Roles', icon: <FiShield /> });
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem('portal_sidebar_collapsed', String(next));
    } catch {
      // ignore
    }
  }

  const navLinks = (
    <nav className="flex-1 p-3 space-y-0.5 overflow-x-hidden overflow-y-auto">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          title={collapsed ? item.label : undefined}
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-3 min-h-11 rounded-md text-sm font-medium transition ${
              isActive
                ? 'bg-[color:var(--accent)]/15 text-[color:var(--accent)]'
                : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]'
            }`
          }
        >
          <span className="shrink-0 text-base">{item.icon}</span>
          {(!collapsed || drawerOpen) && <span className="truncate">{item.label}</span>}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="h-screen min-h-0 flex bg-[color:var(--bg-page)] text-[color:var(--text-primary)] overflow-x-hidden">
      <aside
        className={`hidden md:flex flex-col border-r border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] shrink-0 transition-[width] duration-200 ease-in-out ${
          collapsed ? 'w-16' : 'w-55'
        }`}
      >
        <div className="p-4 border-b border-[color:var(--border-subtle)] flex items-center gap-2 min-h-[4.5rem]">
          {collapsed ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm flex-1" title={`${APP_NAME} Customer Portal`}>
              <AtriumLogo variant="mark" className="h-7 w-7" useSvg={false} />
            </span>
          ) : (
            <div className="min-w-0 flex-1 flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
                <AtriumLogo variant="mark" className="h-7 w-7" useSvg={false} />
              </span>
              <div className="min-w-0">
                <h1 className="text-base font-semibold tracking-tight">Customer Portal</h1>
                {user?.orgId && (
                  <p className="text-xs text-[color:var(--text-muted)] mt-0.5 truncate">
                    {user.name}
                  </p>
                )}
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="shrink-0 w-11 h-11 flex items-center justify-center rounded-md text-[color:var(--text-muted)] border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)] transition"
          >
            {collapsed ? <FiChevronRight className="w-4 h-4" /> : <FiChevronLeft className="w-4 h-4" />}
          </button>
        </div>
        {navLinks}
        <div className="p-3 border-t border-[color:var(--border-subtle)] space-y-1">
          <button
            type="button"
            onClick={handleLogout}
            title={collapsed ? 'Sign out' : undefined}
            className="w-full flex items-center gap-3 px-3 py-3 min-h-11 rounded-md text-sm font-medium text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-red-400 transition"
          >
            <FiLogOut className="shrink-0 text-base" />
            {!collapsed && <span className="truncate">Sign out</span>}
          </button>
        </div>
      </aside>

      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="relative h-full w-[min(20rem,85vw)] flex flex-col bg-[color:var(--bg-surface)] border-r border-[color:var(--border-subtle)] shadow-xl">
            <div className="p-4 border-b border-[color:var(--border-subtle)] flex items-center justify-between min-h-[4.5rem]">
              <div className="flex items-center gap-2.5 min-w-0">
                <AtriumLogo variant="mark" className="h-7 w-7" useSvg={false} />
                <h1 className="text-base font-semibold truncate">Customer Portal</h1>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="w-11 h-11 flex items-center justify-center rounded-md"
                aria-label="Close"
              >
                <FiX />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-3 min-h-11 rounded-md text-sm font-medium transition ${
                      isActive
                        ? 'bg-[color:var(--accent)]/15 text-[color:var(--accent)]'
                        : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)]'
                    }`
                  }
                >
                  <span className="shrink-0 text-base">{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </NavLink>
              ))}
            </nav>
            <div className="p-3 border-t border-[color:var(--border-subtle)]">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-3 py-3 min-h-11 rounded-md text-sm font-medium text-[color:var(--text-muted)]"
              >
                <FiLogOut /> Sign out
              </button>
            </div>
          </aside>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="shrink-0 min-h-[4.5rem] flex items-center justify-between px-4 md:px-6 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] pt-[env(safe-area-inset-top)]">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              className="md:hidden w-11 h-11 flex items-center justify-center rounded-md border border-[color:var(--border-subtle)]"
              aria-label="Open menu"
              onClick={() => setDrawerOpen(true)}
            >
              <FiMenu />
            </button>
            {user?.isOrgAdmin && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[color:var(--accent)]/15 text-[color:var(--accent)]">
                Admin
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-[color:var(--text-muted)] hidden sm:block">{user?.email}</span>
            <Link
              to="/portal/profile"
              className="flex items-center gap-3 rounded-md hover:opacity-90 transition min-h-11"
              title="Profile"
            >
              <div className="w-8 h-8 rounded-full bg-[color:var(--accent)]/20 flex items-center justify-center text-xs font-semibold text-[color:var(--accent)]">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.name} className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  getInitials(user?.name ?? 'U')
                )}
              </div>
              <span className="text-sm font-medium text-[color:var(--text-primary)] hidden sm:block">{user?.name}</span>
            </Link>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden pb-[env(safe-area-inset-bottom)]">
          {children}
        </main>
      </div>
    </div>
  );
}
