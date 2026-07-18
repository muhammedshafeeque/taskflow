import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canAccessModule, canAny } from '../utils/moduleAccess';
import { APP_NAME } from '../brand';
import AtriumLogo from '../components/AtriumLogo';
import { HubModuleVisual } from '../components/HubModuleVisual';
import {
  InboxIcon,
  ProjectsIcon,
  UsersIcon,
  IssuesIcon,
  RolesIcon,
  PackageIcon,
  TimesheetIcon,
  SettingsIcon,
  BoardsIcon,
  DashboardIcon,
} from '../components/icons/NavigationIcons';

interface HubTile {
  id: string;
  title: string;
  description: string;
  to: string;
  icon: React.ReactNode;
  accent: string;
}

export default function Home() {
  const { user } = useAuth();

  const tiles: HubTile[] = [];

  // 1. Delivery
  if (canAccessModule(user, 'pm')) {
    tiles.push({
      id: 'pm',
      title: 'Project Manager',
      description: 'Projects, issues, boards, sprints, and delivery.',
      to: '/dashboard',
      icon: <ProjectsIcon className="w-7 h-7" />,
      accent: 'from-blue-500/20 to-indigo-600/10 border-blue-500/30',
    });
  }

  if (canAccessModule(user, 'resources')) {
    tiles.push({
      id: 'resources',
      title: 'Resources',
      description: 'Allocations, utilization, bench, and staffing forecasts.',
      to: '/resources',
      icon: <BoardsIcon className="w-7 h-7" />,
      accent: 'from-fuchsia-500/20 to-purple-700/10 border-fuchsia-500/30',
    });
  }

  // 2. Sales & contracts
  if (canAccessModule(user, 'crm')) {
    tiles.push({
      id: 'crm',
      title: 'CRM',
      description: 'Leads, accounts, contacts, deals, and quotes.',
      to: '/crm',
      icon: <UsersIcon className="w-7 h-7" />,
      accent: 'from-violet-500/20 to-purple-600/10 border-violet-500/30',
    });
  }

  if (canAccessModule(user, 'contracts')) {
    tiles.push({
      id: 'contracts',
      title: 'Contracts',
      description: 'MSAs, SLAs, retainers, and renewals.',
      to: '/contracts',
      icon: <SettingsIcon className="w-7 h-7" />,
      accent: 'from-indigo-500/20 to-blue-700/10 border-indigo-500/30',
    });
  }

  // 3. Finance
  if (canAccessModule(user, 'billing')) {
    tiles.push({
      id: 'billing',
      title: 'Billing',
      description: 'Time-to-invoice, subscriptions, and GST invoices.',
      to: '/billing',
      icon: <TimesheetIcon className="w-7 h-7" />,
      accent: 'from-yellow-500/20 to-amber-600/10 border-yellow-500/30',
    });
  }

  if (canAccessModule(user, 'accounts')) {
    tiles.push({
      id: 'accounts',
      title: 'Accounts',
      description: 'Ledger, expenses, cost report, and financials.',
      to: '/accounts',
      icon: <PackageIcon className="w-7 h-7" />,
      accent: 'from-lime-500/20 to-emerald-700/10 border-lime-500/30',
    });
  }

  // 4. People & access
  if (canAccessModule(user, 'hrms')) {
    tiles.push({
      id: 'hrms',
      title: 'HRMS',
      description: 'Employees, attendance, leave, and payroll.',
      to: '/hrms',
      icon: <UsersIcon className="w-7 h-7" />,
      accent: 'from-rose-500/20 to-pink-600/10 border-rose-500/30',
    });
  }

  if (canAccessModule(user, 'auth')) {
    tiles.push({
      id: 'auth',
      title: 'Auth',
      description: 'Users, roles, and access permissions.',
      to: canAny(user, 'auth.user.list', 'auth.user.create', 'users:list', 'users:invite')
        ? '/users'
        : '/roles',
      icon: <RolesIcon className="w-7 h-7" />,
      accent: 'from-sky-500/20 to-blue-600/10 border-sky-500/30',
    });
  }

  // 5. Operations
  if (canAccessModule(user, 'assets')) {
    tiles.push({
      id: 'assets',
      title: 'Assets & CMDB',
      description: 'Inventory, servers, licenses, and warranty.',
      to: '/assets',
      icon: <PackageIcon className="w-7 h-7" />,
      accent: 'from-stone-500/20 to-zinc-600/10 border-stone-500/30',
    });
  }

  if (canAccessModule(user, 'procurement')) {
    tiles.push({
      id: 'procurement',
      title: 'Procurement',
      description: 'Vendors, purchase orders, and license buys.',
      to: '/procurement',
      icon: <PackageIcon className="w-7 h-7" />,
      accent: 'from-orange-500/20 to-red-600/10 border-orange-500/30',
    });
  }

  // 6. Support & client
  if (canAccessModule(user, 'service')) {
    tiles.push({
      id: 'service',
      title: 'Service Desk',
      description: 'Tickets, SLA queues, knowledge base, and CSAT.',
      to: '/service/tickets',
      icon: <IssuesIcon className="w-7 h-7" />,
      accent: 'from-amber-500/20 to-orange-600/10 border-amber-500/30',
    });
  }

  if (canAccessModule(user, 'portal-admin')) {
    tiles.push({
      id: 'portal-admin',
      title: 'Customer Portal',
      description: 'Customer orgs, portal users, and request approvals.',
      to: '/admin/customer-orgs',
      icon: <UsersIcon className="w-7 h-7" />,
      accent: 'from-emerald-500/20 to-green-600/10 border-emerald-500/30',
    });
  }

  // 7. Collaboration
  if (canAccessModule(user, 'mail')) {
    tiles.push({
      id: 'mail',
      title: 'Mail',
      description: 'Shared inboxes, compose, and CRM-linked email.',
      to: '/mail',
      icon: <InboxIcon className="w-7 h-7" />,
      accent: 'from-cyan-500/20 to-teal-600/10 border-cyan-500/30',
    });
  }

  if (canAccessModule(user, 'calendar')) {
    tiles.push({
      id: 'calendar',
      title: 'Calendar',
      description: 'Meetings, standups, demos, and reviews.',
      to: '/calendar',
      icon: <TimesheetIcon className="w-7 h-7" />,
      accent: 'from-blue-400/20 to-sky-600/10 border-blue-400/30',
    });
  }

  if (canAccessModule(user, 'documents')) {
    tiles.push({
      id: 'documents',
      title: 'Documents',
      description: 'Templates, proposals, SOWs, and policies.',
      to: '/documents',
      icon: <DashboardIcon className="w-7 h-7" />,
      accent: 'from-teal-500/20 to-cyan-700/10 border-teal-500/30',
    });
  }

  if (canAccessModule(user, 'inbox')) {
    tiles.push({
      id: 'inbox',
      title: 'Inbox',
      description: `Notifications, mentions, and activity across ${APP_NAME}.`,
      to: '/inbox',
      icon: <InboxIcon className="w-7 h-7" />,
      accent: 'from-slate-500/20 to-zinc-600/10 border-slate-500/30',
    });
  }

  return (
    <div className="animate-fade-in flex min-h-full w-full flex-1 flex-col">
      <div className="flex w-full flex-1 flex-col px-4 py-5 sm:px-6 sm:py-6 lg:px-8 xl:px-10">
        <header className="mb-5 shrink-0">
          <div className="mb-2 flex items-center gap-2">
            <AtriumLogo variant="mark" className="h-7 w-7" useSvg={false} />
            <p className="text-[11px] uppercase tracking-widest text-[color:var(--text-muted)]">{APP_NAME}</p>
          </div>
          <h1 className="text-xl font-bold text-[color:var(--text-primary)] sm:text-2xl">
            Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
          </h1>
          <p className="mt-1 text-[13px] text-[color:var(--text-muted)]">Choose a module to get started.</p>
        </header>

        {tiles.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 text-center text-[color:var(--text-muted)]">
            No modules available for your role. Contact your admin.
          </div>
        ) : (
          <div className="grid flex-1 auto-rows-fr grid-cols-1 content-start gap-3 sm:grid-cols-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-5">
            {tiles.map((tile) => (
              <Link
                key={tile.id}
                to={tile.to}
                className={`group relative flex min-h-[8.5rem] flex-col overflow-hidden rounded-xl border bg-gradient-to-br ${tile.accent} bg-[color:var(--bg-surface)] p-3.5 transition hover:shadow-md hover:shadow-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] sm:min-h-[9.5rem]`}
              >
                <div className="flex min-h-0 flex-1 gap-3">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--bg-elevated)] text-[color:var(--accent)] transition group-hover:bg-[color:var(--accent)]/15 [&>svg]:h-4 [&>svg]:w-4">
                      {tile.icon}
                    </div>
                    <h2 className="mb-0.5 text-[14px] font-semibold leading-tight text-[color:var(--text-primary)]">{tile.title}</h2>
                    <p className="line-clamp-2 text-[11px] leading-snug text-[color:var(--text-muted)]">{tile.description}</p>
                    <span className="mt-auto pt-2 inline-flex items-center text-[11px] font-medium text-[color:var(--accent)] group-hover:underline">
                      Open →
                    </span>
                  </div>
                  <div className="hidden w-[42%] shrink-0 self-stretch sm:flex">
                    <HubModuleVisual id={tile.id} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {canAny(user, 'project.project.list', 'projects:list') && (
          <p className="mt-5 shrink-0 text-[12px] text-[color:var(--text-muted)]">
            Or jump straight to{' '}
            <Link to="/projects" className="text-[color:var(--accent)] hover:underline">
              all projects
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
