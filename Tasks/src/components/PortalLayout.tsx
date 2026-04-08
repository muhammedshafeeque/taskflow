import { NavLink, useNavigate } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
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
  FiUser,
} from 'react-icons/fi';

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
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('portal_sidebar_collapsed') === 'true';
  });

  const perms = user?.customerPermissions ?? [];

  const navItems: NavItem[] = [
    { to: '/portal', label: 'Dashboard', icon: <FiGrid />, end: true },
    { to: '/portal/requests', label: 'My Requests', icon: <FiList /> },
    { to: '/portal/requests/new', label: 'New Request', icon: <FiPlusCircle /> },
    { to: '/portal/projects', label: 'Projects', icon: <FiFolder /> },
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

  return (
    <div className="h-screen min-h-0 flex bg-[color:var(--bg-page)] text-[color:var(--text-primary)]">
      {/* Sidebar */}
      <aside
        className={`flex flex-col border-r border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] shrink-0 transition-[width] duration-200 ease-in-out ${
          collapsed ? 'w-16' : 'w-55'
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-[color:var(--border-subtle)] flex items-center gap-2 min-h-[4.5rem]">
          {collapsed ? (
            <span className="text-lg font-semibold tracking-tight flex-1 text-center" title="Customer Portal">
              CP
            </span>
          ) : (
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold tracking-tight">Customer Portal</h1>
              {user?.orgId && (
                <p className="text-xs text-[color:var(--text-muted)] mt-0.5 truncate">
                  {user.name}
                </p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-[color:var(--text-muted)] border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)] transition"
          >
            {collapsed ? <FiChevronRight className="w-4 h-4" /> : <FiChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-x-hidden overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition ${
                  isActive
                    ? 'bg-[color:var(--accent)]/15 text-[color:var(--accent)]'
                    : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]'
                }`
              }
            >
              <span className="shrink-0 text-base">{item.icon}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-[color:var(--border-subtle)] space-y-1">
          <NavLink
            to="/portal/profile"
            title={collapsed ? 'Profile' : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition ${
                isActive
                  ? 'bg-[color:var(--accent)]/15 text-[color:var(--accent)]'
                  : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]'
              }`
            }
          >
            <FiUser className="shrink-0 text-base" />
            {!collapsed && <span className="truncate">Profile</span>}
          </NavLink>
          <button
            type="button"
            onClick={handleLogout}
            title={collapsed ? 'Sign out' : undefined}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-red-400 transition"
          >
            <FiLogOut className="shrink-0 text-base" />
            {!collapsed && <span className="truncate">Sign out</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="shrink-0 h-[4.5rem] flex items-center justify-between px-6 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]">
          <div className="flex items-center gap-3 min-w-0">
            {user?.isOrgAdmin && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[color:var(--accent)]/15 text-[color:var(--accent)]">
                Admin
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-[color:var(--text-muted)] hidden sm:block">{user?.email}</span>
            <div className="w-8 h-8 rounded-full bg-[color:var(--accent)]/20 flex items-center justify-center text-xs font-semibold text-[color:var(--accent)]">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.name} className="w-8 h-8 rounded-full object-cover" />
              ) : (
                getInitials(user?.name ?? 'U')
              )}
            </div>
            <span className="text-sm font-medium text-[color:var(--text-primary)] hidden sm:block">{user?.name}</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
