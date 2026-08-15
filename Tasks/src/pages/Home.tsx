import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePlatformModules } from '../contexts/PlatformModulesContext';
import { useNotifications } from '../contexts/NotificationsContext';
import { canAccessModule, canAny } from '../utils/moduleAccess';
import { useAppDisplayName } from '../hooks/useAppDisplayName';
import { BrandMark } from '../components/BrandMark';
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
  keywords: string;
}

interface ModuleDetail {
  summary: string;
  features: string[];
}

const MODULE_DETAILS: Record<string, ModuleDetail> = {
  pm: {
    summary:
      'Plan and deliver work across projects — issues, boards, sprints, roadmaps, and timesheets in one place.',
    features: [
      'Projects, issues & backlogs',
      'Kanban boards & sprints',
      'Gantt, roadmap & versions',
      'Timesheets & estimates',
      'Test plans & defect metrics',
    ],
  },
  resources: {
    summary: 'See who is free, who is overloaded, and plan staffing against delivery demand.',
    features: [
      'Team utilization views',
      'Bench & availability',
      'Allocations across projects',
      'Capacity forecasts',
      'Conflict detection',
    ],
  },
  crm: {
    summary: 'Run the sales pipeline from first lead through quote — accounts, contacts, and deals together.',
    features: [
      'Leads & opportunity pipeline',
      'Accounts & contacts',
      'Deals & activities',
      'Software estimate quotes',
      'CRM settings & reports',
    ],
  },
  contracts: {
    summary: 'Track commercial agreements, renewals, and service levels tied to your customers.',
    features: [
      'MSAs & retainers',
      'SLA definitions',
      'Renewal calendar',
      'Contract status overview',
      'Linked CRM accounts',
    ],
  },
  billing: {
    summary: 'Turn time and subscriptions into invoices with tax-ready billing workflows.',
    features: [
      'Time-to-invoice',
      'Subscriptions',
      'GST / tax invoices',
      'Billing dashboard',
      'Payment-ready documents',
    ],
  },
  accounts: {
    summary: 'Finance ledger, expenses, and cost reporting for the workspace.',
    features: [
      'General ledger',
      'Expense tracking',
      'Invoice register',
      'Cost & usage reports',
      'Financial dashboards',
    ],
  },
  hrms: {
    summary: 'People operations — employees, attendance, leave, and payroll in one module.',
    features: [
      'Employee directory',
      'Attendance tracking',
      'Leave balances & requests',
      'Payroll overview',
      'HR dashboard',
    ],
  },
  auth: {
    summary: 'Control who can sign in and what they can do across the platform.',
    features: [
      'User invites & profiles',
      'Roles & permissions',
      'Workspace access',
      'Enable / disable accounts',
      'Security administration',
    ],
  },
  core: {
    summary: 'Company identity, currencies, exchange rates, and platform-wide module switches.',
    features: [
      'Company profile',
      'Currency catalog',
      'Day-wise ROE / FX rates',
      'Enable / disable modules',
      'Workspace branding name',
    ],
  },
  assets: {
    summary: 'Track hardware, software licenses, and infrastructure inventory (CMDB).',
    features: [
      'Asset inventory',
      'Servers & devices',
      'License tracking',
      'Warranty status',
      'CMDB dashboard',
    ],
  },
  procurement: {
    summary: 'Vendors, purchase orders, and license purchases for operations.',
    features: [
      'Vendor directory',
      'Purchase orders',
      'License buys',
      'Procurement dashboard',
      'Spend visibility',
    ],
  },
  service: {
    summary: 'Support tickets, SLA queues, and a knowledge base for customer care.',
    features: [
      'Ticket queues',
      'SLA tracking',
      'Knowledge base',
      'CSAT feedback',
      'Service dashboard',
    ],
  },
  'portal-admin': {
    summary: 'Administer customer portal organizations, users, and request approvals.',
    features: [
      'Customer organizations',
      'Portal users & roles',
      'Project mappings',
      'Approval queue',
      'Request oversight',
    ],
  },
  mail: {
    summary: 'Shared mailboxes and compose flows linked to your CRM work.',
    features: [
      'Shared inboxes',
      'Compose & send',
      'CRM-linked threads',
      'Mailbox permissions',
      'Message history',
    ],
  },
  calendar: {
    summary: 'Schedule meetings, demos, standups, and reviews across teams.',
    features: [
      'Meetings calendar',
      'Demos & reviews',
      'Standups',
      'Team schedules',
      'Event overview',
    ],
  },
  documents: {
    summary: 'Templates and controlled documents — proposals, SOWs, and policies.',
    features: [
      'Proposals',
      'Statements of work',
      'Policies',
      'Document templates',
      'Document dashboard',
    ],
  },
  inbox: {
    summary: 'A single place for notifications, mentions, and cross-module activity.',
    features: [
      'Notifications feed',
      'Mentions & alerts',
      'Mark read / unread',
      'Deep links into work',
      'Push toast previews',
    ],
  },
};

function greetingForHour(hour: number): string {
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function buildTiles(
  user: ReturnType<typeof useAuth>['user'],
  enabledModules: ReturnType<typeof usePlatformModules>['enabledModules'],
  displayName: string
): HubTile[] {
  const tiles: HubTile[] = [];

  if (canAccessModule(user, 'pm', enabledModules)) {
    tiles.push({
      id: 'pm',
      title: 'Project Manager',
      description: 'Projects, issues, boards, sprints',
      to: '/dashboard',
      icon: <ProjectsIcon className="h-[18px] w-[18px]" />,
      keywords: 'pm project delivery issues boards sprints',
    });
  }
  if (canAccessModule(user, 'resources', enabledModules)) {
    tiles.push({
      id: 'resources',
      title: 'Resources',
      description: 'Allocations, utilization, bench',
      to: '/resources',
      icon: <BoardsIcon className="h-[18px] w-[18px]" />,
      keywords: 'resources staffing utilization bench',
    });
  }
  if (canAccessModule(user, 'crm', enabledModules)) {
    tiles.push({
      id: 'crm',
      title: 'CRM',
      description: 'Leads, accounts, deals, quotes',
      to: '/crm',
      icon: <UsersIcon className="h-[18px] w-[18px]" />,
      keywords: 'crm sales leads deals quotes',
    });
  }
  if (canAccessModule(user, 'contracts', enabledModules)) {
    tiles.push({
      id: 'contracts',
      title: 'Contracts',
      description: 'MSAs, SLAs, retainers, renewals',
      to: '/contracts',
      icon: <SettingsIcon className="h-[18px] w-[18px]" />,
      keywords: 'contracts msa sla retainer',
    });
  }
  if (canAccessModule(user, 'billing', enabledModules)) {
    tiles.push({
      id: 'billing',
      title: 'Billing',
      description: 'Subscriptions, invoices, tax',
      to: '/billing',
      icon: <TimesheetIcon className="h-[18px] w-[18px]" />,
      keywords: 'billing invoice subscription',
    });
  }
  if (canAccessModule(user, 'accounts', enabledModules)) {
    tiles.push({
      id: 'accounts',
      title: 'Accounts',
      description: 'Ledger, expenses, reports',
      to: '/accounts',
      icon: <PackageIcon className="h-[18px] w-[18px]" />,
      keywords: 'accounts finance ledger expenses',
    });
  }
  if (canAccessModule(user, 'hrms', enabledModules)) {
    tiles.push({
      id: 'hrms',
      title: 'HRMS',
      description: 'Employees, leave, payroll',
      to: '/hrms',
      icon: <UsersIcon className="h-[18px] w-[18px]" />,
      keywords: 'hr hrms employees leave payroll',
    });
  }
  if (canAccessModule(user, 'auth', enabledModules)) {
    tiles.push({
      id: 'auth',
      title: 'Auth',
      description: 'Users, roles, permissions',
      to: canAny(user, 'auth.user.list', 'auth.user.create', 'users:list', 'users:invite')
        ? '/users'
        : '/roles',
      icon: <RolesIcon className="h-[18px] w-[18px]" />,
      keywords: 'auth users roles permissions access',
    });
  }
  if (canAccessModule(user, 'core', enabledModules)) {
    tiles.push({
      id: 'core',
      title: 'Core',
      description: 'Company, currencies, modules',
      to: '/core/company',
      icon: <SettingsIcon className="h-[18px] w-[18px]" />,
      keywords: 'core company currency modules settings',
    });
  }
  if (canAccessModule(user, 'assets', enabledModules)) {
    tiles.push({
      id: 'assets',
      title: 'Assets & CMDB',
      description: 'Inventory, servers, licenses',
      to: '/assets',
      icon: <PackageIcon className="h-[18px] w-[18px]" />,
      keywords: 'assets cmdb inventory servers',
    });
  }
  if (canAccessModule(user, 'procurement', enabledModules)) {
    tiles.push({
      id: 'procurement',
      title: 'Procurement',
      description: 'Vendors and purchase orders',
      to: '/procurement',
      icon: <PackageIcon className="h-[18px] w-[18px]" />,
      keywords: 'procurement vendors purchase',
    });
  }
  if (canAccessModule(user, 'service', enabledModules)) {
    tiles.push({
      id: 'service',
      title: 'Service Desk',
      description: 'Tickets, SLA, knowledge base',
      to: '/service/tickets',
      icon: <IssuesIcon className="h-[18px] w-[18px]" />,
      keywords: 'service desk tickets sla support',
    });
  }
  if (canAccessModule(user, 'portal-admin', enabledModules)) {
    tiles.push({
      id: 'portal-admin',
      title: 'Customer Portal',
      description: 'Customer orgs and approvals',
      to: '/admin/customer-orgs',
      icon: <UsersIcon className="h-[18px] w-[18px]" />,
      keywords: 'portal customer orgs',
    });
  }
  if (canAccessModule(user, 'mail', enabledModules)) {
    tiles.push({
      id: 'mail',
      title: 'Mail',
      description: 'Shared inboxes and compose',
      to: '/mail',
      icon: <InboxIcon className="h-[18px] w-[18px]" />,
      keywords: 'mail email inbox compose',
    });
  }
  if (canAccessModule(user, 'calendar', enabledModules)) {
    tiles.push({
      id: 'calendar',
      title: 'Calendar',
      description: 'Meetings, demos, reviews',
      to: '/calendar',
      icon: <TimesheetIcon className="h-[18px] w-[18px]" />,
      keywords: 'calendar meetings demos',
    });
  }
  if (canAccessModule(user, 'documents', enabledModules)) {
    tiles.push({
      id: 'documents',
      title: 'Documents',
      description: 'Proposals, SOWs, policies',
      to: '/documents',
      icon: <DashboardIcon className="h-[18px] w-[18px]" />,
      keywords: 'documents proposals sow',
    });
  }
  if (canAccessModule(user, 'inbox', enabledModules)) {
    tiles.push({
      id: 'inbox',
      title: 'Inbox',
      description: `Notifications across ${displayName}`,
      to: '/inbox',
      icon: <InboxIcon className="h-[18px] w-[18px]" />,
      keywords: 'inbox notifications mentions',
    });
  }

  return tiles;
}

export default function Home() {
  const { user } = useAuth();
  const { enabledModules } = usePlatformModules();
  const { unreadCount } = useNotifications();
  const displayName = useAppDisplayName();
  const navigate = useNavigate();
  const firstName = user?.name?.trim().split(/\s+/)[0];
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const tiles = useMemo(
    () => buildTiles(user, enabledModules, displayName),
    [user, enabledModules, displayName]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tiles;
    return tiles.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.keywords.includes(q)
    );
  }, [tiles, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-hub-index="${activeIndex}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      const typing =
        tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable;

      if (!typing && e.key === '/' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }

      // Digit shortcuts when not typing (or when search focused with empty query)
      if (!e.metaKey && !e.ctrlKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const searchFocused = document.activeElement === searchRef.current;
        if (typing && !(searchFocused && !query)) return;
        const idx = Number(e.key) - 1;
        if (filtered[idx]) {
          e.preventDefault();
          navigate(filtered[idx].to);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, navigate, query]);

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && filtered[activeIndex]) {
      e.preventDefault();
      navigate(filtered[activeIndex].to);
    } else if (e.key === 'Escape') {
      if (query) setQuery('');
      else searchRef.current?.blur();
    }
  }

  const showProjects =
    canAny(user, 'project.project.list', 'projects:list') &&
    canAccessModule(user, 'pm', enabledModules);

  const greeting = greetingForHour(now.getHours());
  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  const timeLabel = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  const preview = filtered[activeIndex] ?? null;
  const previewDetail = preview ? MODULE_DETAILS[preview.id] : null;

  return (
    <div className="hub-v2 flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden lg:flex-row">
      <aside className="hub-v2-brand relative flex max-h-[42vh] shrink-0 flex-col overflow-hidden px-6 py-6 sm:px-9 sm:py-8 lg:max-h-none lg:h-full lg:w-[44%] lg:max-w-[28rem] lg:px-11 lg:py-12 xl:max-w-[30rem]">
        <div className="hub-v2-brand-wash" aria-hidden />
        <div className="hub-v2-brand-grid" aria-hidden />

        <div className="relative z-[1] flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <div className="mb-6 flex items-center gap-3 lg:mb-8">
            <span className="hub-v2-logo flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden bg-white">
              <BrandMark className="h-8 w-8" imgClassName="h-full w-full object-contain p-0.5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold tracking-tight text-[color:var(--text-primary)]">
                {displayName}
              </p>
              <p className="mt-0.5 truncate text-[12px] text-[color:var(--text-muted)]">
                {dateLabel} · {timeLabel}
              </p>
            </div>
          </div>

          {preview && previewDetail ? (
            <div key={preview.id} className="hub-v2-preview flex min-h-0 flex-1 flex-col">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-[color:var(--accent)] uppercase">
                Module
              </p>
              <div className="mt-3 flex items-start gap-3">
                <span className="hub-v2-preview-icon">{preview.icon}</span>
                <div className="min-w-0">
                  <h1 className="hub-v2-preview-title text-[color:var(--text-primary)]">{preview.title}</h1>
                  <p className="mt-1 text-[12px] text-[color:var(--text-muted)]">{preview.description}</p>
                </div>
              </div>

              <div className="hub-v2-stage group mt-5" aria-hidden>
                <HubModuleVisual id={preview.id} />
              </div>

              <div className="hub-v2-rule mt-5" aria-hidden />
              <p className="hub-v2-preview-summary mt-5 text-[14px] leading-relaxed text-[color:var(--text-muted)]">
                {previewDetail.summary}
              </p>
              <p className="mt-6 text-[11px] font-semibold tracking-[0.12em] text-[color:var(--text-subtle)] uppercase">
                Features
              </p>
              <ul className="hub-v2-features mt-3">
                {previewDetail.features.map((f, i) => (
                  <li key={f} style={{ animationDelay: `${80 + i * 45}ms` }}>
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-auto flex flex-wrap gap-2 pt-8">
                <Link to={preview.to} className="hub-v2-cta">
                  Open {preview.title}
                </Link>
              </div>
            </div>
          ) : (
            <div className="hub-v2-preview flex min-h-0 flex-1 flex-col">
              <p className="hub-v2-greet text-[13px] font-medium text-[color:var(--text-muted)]">
                {greeting}
                {firstName ? `, ${firstName}` : ''}
              </p>
              <h1 className="hub-v2-wordmark mt-2 text-[color:var(--text-primary)]">{displayName}</h1>
              <div className="hub-v2-rule mt-5" aria-hidden />
              <p className="mt-5 max-w-[18rem] text-[14px] leading-relaxed text-[color:var(--text-muted)]">
                Hover a module on the right to see details and features here.
              </p>
              <div className="mt-8 flex flex-wrap gap-2">
                {showProjects && (
                  <Link to="/projects" className="hub-v2-cta">
                    Open projects
                  </Link>
                )}
                {canAccessModule(user, 'inbox', enabledModules) && (
                  <Link to="/inbox" className="hub-v2-ghost">
                    Inbox
                    {unreadCount > 0 && (
                      <span className="hub-v2-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                    )}
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </aside>

      <section className="hub-v2-panel relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-t border-[color:var(--border-subtle)] lg:border-t-0 lg:border-l">
        <div className="shrink-0 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/92 px-4 py-3.5 backdrop-blur-md sm:px-6">
          <div className="mb-2.5 flex items-baseline justify-between gap-3">
            <h2 className="text-[11px] font-semibold tracking-[0.14em] text-[color:var(--text-muted)] uppercase">
              Modules
            </h2>
            <p className="text-[11px] tabular-nums text-[color:var(--text-subtle)]">
              {query.trim()
                ? `${filtered.length} of ${tiles.length}`
                : `${tiles.length} available`}
            </p>
          </div>
          <label className="hub-v2-search">
            <svg className="h-4 w-4 shrink-0 text-[color:var(--text-muted)]" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10.5 10.5 13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search modules…"
              className="hub-v2-search-input"
              autoComplete="off"
              spellCheck={false}
              aria-controls="hub-module-list"
            />
            {query ? (
              <button
                type="button"
                className="hub-v2-clear"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
              >
                Clear
              </button>
            ) : null}
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 sm:px-3 sm:py-3">
          {tiles.length === 0 ? (
            <p className="px-3 py-16 text-center text-[14px] text-[color:var(--text-muted)]">
              No modules available for your role.
            </p>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-14 text-center">
              <p className="text-[14px] text-[color:var(--text-muted)]">No modules match “{query}”.</p>
              <button type="button" className="hub-v2-clear mt-3 inline-flex" onClick={() => setQuery('')}>
                Clear search
              </button>
            </div>
          ) : (
            <ul ref={listRef} id="hub-module-list" className="hub-v2-list" role="listbox" aria-label="Modules">
              {filtered.map((tile, index) => {
                const isInbox = tile.id === 'inbox';
                const shortcut = index < 9 ? String(index + 1) : null;
                return (
                  <li
                    key={tile.id}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-hub-index={index}
                    className="hub-v2-item"
                    style={{ animationDelay: `${Math.min(index, 10) * 28}ms` }}
                  >
                    <Link
                      to={tile.to}
                      className={`hub-v2-row ${index === activeIndex ? 'is-active' : ''}`}
                      onMouseEnter={() => setActiveIndex(index)}
                    >
                      <span className="hub-v2-row-icon">{tile.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="block text-[14px] font-semibold tracking-tight text-[color:var(--text-primary)]">
                            {tile.title}
                          </span>
                          {isInbox && unreadCount > 0 && (
                            <span className="hub-v2-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                          )}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-[color:var(--text-muted)]">
                          {tile.description}
                        </span>
                      </span>
                      {shortcut && (
                        <span className="hub-v2-num" aria-hidden>
                          {shortcut}
                        </span>
                      )}
                      <span className="hub-v2-row-go" aria-hidden>
                        →
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
