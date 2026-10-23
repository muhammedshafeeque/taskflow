/**
 * Module-aware loading states. Each module gets its own animated scene that
 * depicts what is actually happening (cards moving across a board, books
 * balancing, a contract being signed…) plus a short rotating status line.
 *
 * The module is taken from the nearest module layout via context, so a bare
 * <ModuleLoader /> inside /crm renders the CRM scene. Pass `module` to override.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { ModuleId } from '../../utils/moduleAccess';
import { useCurrentModule } from './moduleLoaderContext';
import './moduleLoaders.css';

type LoaderModule = ModuleId | 'app';

type LoaderTheme = {
  /** Primary and secondary scene colours; both read on dark and light surfaces. */
  accent: string;
  accent2: string;
  /** Steps shown under the label, cycled while loading. */
  steps: string[];
  scene: () => ReactNode;
};

const THEMES: Record<LoaderModule, LoaderTheme> = {
  pm: {
    accent: '#3b82f6',
    accent2: '#22d3ee',
    steps: ['Gathering issues', 'Lining up the sprint', 'Arranging the board'],
    scene: PmScene,
  },
  auth: {
    accent: '#6366f1',
    accent2: '#a78bfa',
    steps: ['Verifying identity', 'Checking roles', 'Applying permissions'],
    scene: AuthScene,
  },
  crm: {
    accent: '#f97316',
    accent2: '#facc15',
    steps: ['Warming up the pipeline', 'Qualifying leads', 'Totalling deal value'],
    scene: CrmScene,
  },
  service: {
    accent: '#14b8a6',
    accent2: '#5eead4',
    steps: ['Triaging tickets', 'Checking SLA clocks', 'Routing to agents'],
    scene: ServiceScene,
  },
  'portal-admin': {
    accent: '#0ea5e9',
    accent2: '#7dd3fc',
    steps: ['Opening the portal', 'Laying out pages', 'Preparing customer view'],
    scene: PortalScene,
  },
  inbox: {
    accent: '#ec4899',
    accent2: '#f9a8d4',
    steps: ['Fetching new messages', 'Sorting by priority', 'Marking what matters'],
    scene: InboxScene,
  },
  hrms: {
    accent: '#8b5cf6',
    accent2: '#f472b6',
    steps: ['Gathering the team', 'Syncing attendance', 'Updating leave balances'],
    scene: HrmsScene,
  },
  accounts: {
    accent: '#10b981',
    accent2: '#6ee7b7',
    steps: ['Balancing the books', 'Reconciling entries', 'Posting journals'],
    scene: AccountsScene,
  },
  contracts: {
    accent: '#a855f7',
    accent2: '#e879f9',
    steps: ['Reviewing clauses', 'Checking obligations', 'Collecting signatures'],
    scene: ContractsScene,
  },
  billing: {
    accent: '#22c55e',
    accent2: '#bef264',
    steps: ['Printing invoices', 'Applying taxes', 'Totalling amounts due'],
    scene: BillingScene,
  },
  assets: {
    accent: '#f59e0b',
    accent2: '#fcd34d',
    steps: ['Scanning inventory', 'Mapping CI relationships', 'Checking warranties'],
    scene: AssetsScene,
  },
  resources: {
    accent: '#06b6d4',
    accent2: '#818cf8',
    steps: ['Measuring capacity', 'Balancing allocations', 'Finding free hands'],
    scene: ResourcesScene,
  },
  procurement: {
    accent: '#ea580c',
    accent2: '#fdba74',
    steps: ['Comparing vendor quotes', 'Raising purchase orders', 'Tracking deliveries'],
    scene: ProcurementScene,
  },
  documents: {
    accent: '#3b82f6',
    accent2: '#93c5fd',
    steps: ['Opening folders', 'Indexing pages', 'Fetching latest versions'],
    scene: DocumentsScene,
  },
  calendar: {
    accent: '#ef4444',
    accent2: '#fca5a5',
    steps: ['Plotting your schedule', 'Finding free slots', 'Syncing reminders'],
    scene: CalendarScene,
  },
  monitor: {
    accent: '#22c55e',
    accent2: '#4ade80',
    steps: ['Checking the pulse', 'Collecting signals', 'Reading error rates'],
    scene: MonitorScene,
  },
  core: {
    accent: '#64748b',
    accent2: '#38bdf8',
    steps: ['Loading settings', 'Wiring up modules', 'Applying configuration'],
    scene: CoreScene,
  },
  app: {
    accent: '#3b82f6',
    accent2: '#a78bfa',
    steps: ['Preparing your workspace', 'Connecting modules', 'Almost there'],
    scene: CoreScene,
  },
};

const STEP_INTERVAL_MS = 1800;

function useCyclingStep(count: number) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (count < 2) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % count), STEP_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [count]);
  return index;
}

export type ModuleLoaderSize = 'page' | 'block' | 'inline';

export function ModuleLoader({
  module,
  label,
  size = 'page',
  className = '',
}: {
  module?: ModuleId | 'app';
  /** What is being loaded, e.g. "Loading invoice…". Shown above the cycling step. */
  label?: string;
  size?: ModuleLoaderSize;
  className?: string;
}) {
  const fromLayout = useCurrentModule();
  const key: LoaderModule = module ?? fromLayout ?? 'app';
  const theme = THEMES[key] ?? THEMES.app;
  const step = useCyclingStep(theme.steps.length);
  const Scene = theme.scene;
  const style = { '--ml-accent': theme.accent, '--ml-accent-2': theme.accent2 } as CSSProperties;
  const title = label ?? 'Loading…';

  if (size === 'inline') {
    return (
      <span
        role="status"
        aria-live="polite"
        className={`module-loader module-loader--inline ${className}`}
        style={style}
        data-module={key}
      >
        <span className="module-loader__orb" aria-hidden />
        <span>{title}</span>
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={`module-loader module-loader--${size} ${className}`}
      style={style}
      data-module={key}
    >
      <div className="module-loader__stage" aria-hidden>
        <div className="module-loader__halo" />
        <svg viewBox="0 0 120 120" className="module-loader__svg" fill="none">
          <Scene />
        </svg>
      </div>
      <p className="module-loader__title">{title}</p>
      <p className="module-loader__step" key={step}>
        {theme.steps[step]}
        <span className="module-loader__dots">
          <i />
          <i />
          <i />
        </span>
      </p>
      <div className="module-loader__progress" aria-hidden>
        <span />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scenes — 120×120, coloured with --ml-accent / --ml-accent-2.        */
/* Shared stroke/fill helpers live in moduleLoaders.css (ml-*).        */
/* ------------------------------------------------------------------ */

/** A card travels To do → In progress → Done and gets ticked off. */
function PmScene() {
  return (
    <>
      {[14, 46, 78].map((x, i) => (
        <g key={x}>
          <rect x={x} y="22" width="28" height="76" rx="6" className="ml-panel" />
          <rect x={x + 6} y="28" width="16" height="3" rx="1.5" className="ml-fill-soft" />
          <rect x={x + 4} y={i === 1 ? 64 : 38} width="20" height="11" rx="3" className="ml-fill-faint" />
        </g>
      ))}
      <g className="ml-pm-card">
        <rect x="18" y="38" width="20" height="18" rx="3" className="ml-fill" />
        <rect x="21" y="42" width="11" height="2.5" rx="1" className="ml-ink" />
        <rect x="21" y="47" width="7" height="2.5" rx="1" className="ml-ink" />
      </g>
      <path d="M85 46l4 4 8-8" className="ml-stroke-2 ml-pm-check" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

/** A shield is scanned, then a lock clicks shut. */
function AuthScene() {
  return (
    <>
      <path d="M60 14l34 12v26c0 24-15 40-34 50-19-10-34-26-34-50V26z" className="ml-panel ml-stroke" strokeWidth="2" />
      <clipPath id="ml-auth-clip">
        <path d="M60 14l34 12v26c0 24-15 40-34 50-19-10-34-26-34-50V26z" />
      </clipPath>
      <g clipPath="url(#ml-auth-clip)">
        <rect x="20" y="10" width="80" height="6" className="ml-fill-2 ml-auth-scan" />
      </g>
      <rect x="47" y="56" width="26" height="22" rx="4" className="ml-fill" />
      <path d="M52 56v-7a8 8 0 0116 0v7" className="ml-stroke ml-auth-shackle" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="60" cy="66" r="3" className="ml-ink" />
      <rect x="58.75" y="67" width="2.5" height="6" rx="1" className="ml-ink" />
    </>
  );
}

/** Leads fall into a funnel and come out as coins. */
function CrmScene() {
  return (
    <>
      <path d="M20 26h80L68 64v22l-16 8V64z" className="ml-panel ml-stroke" strokeWidth="2" strokeLinejoin="round" />
      {[34, 52, 70, 86].map((x, i) => (
        <circle key={x} cx={x} cy="14" r="4" className="ml-fill-2 ml-crm-lead" style={{ animationDelay: `${i * 0.35}s` }} />
      ))}
      <g className="ml-crm-coin">
        <circle cx="60" cy="102" r="8" className="ml-fill" />
        <text x="60" y="106" textAnchor="middle" className="ml-ink-text" fontSize="10" fontWeight="700">
          $
        </text>
      </g>
    </>
  );
}

/** A ticket with an SLA ring counting down around it. */
function ServiceScene() {
  return (
    <>
      <circle cx="60" cy="60" r="44" className="ml-track" strokeWidth="5" />
      <circle cx="60" cy="60" r="44" className="ml-stroke ml-sla-ring" strokeWidth="5" strokeLinecap="round" pathLength="100" transform="rotate(-90 60 60)" />
      <g className="ml-bob">
        <path d="M36 46h48v8a6 6 0 000 12v8H36v-8a6 6 0 000-12z" className="ml-fill" />
        <path d="M70 48v24" className="ml-ink-stroke" strokeWidth="1.5" strokeDasharray="3 3" />
        <rect x="42" y="54" width="20" height="3" rx="1.5" className="ml-ink" />
        <rect x="42" y="61" width="13" height="3" rx="1.5" className="ml-ink" />
      </g>
    </>
  );
}

/** A browser window whose page blocks assemble in sequence. */
function PortalScene() {
  return (
    <>
      <rect x="14" y="20" width="92" height="78" rx="8" className="ml-panel ml-stroke" strokeWidth="2" />
      <path d="M14 34h92" className="ml-stroke" strokeWidth="2" />
      {[22, 29, 36].map((x) => (
        <circle key={x} cx={x} cy="27" r="2.2" className="ml-fill-soft" />
      ))}
      <rect x="22" y="42" width="76" height="14" rx="3" className="ml-fill ml-build" style={{ animationDelay: '0s' }} />
      <rect x="22" y="60" width="36" height="30" rx="3" className="ml-fill-2 ml-build" style={{ animationDelay: '0.3s' }} />
      <rect x="62" y="60" width="36" height="13" rx="3" className="ml-fill-soft ml-build" style={{ animationDelay: '0.6s' }} />
      <rect x="62" y="77" width="36" height="13" rx="3" className="ml-fill-soft ml-build" style={{ animationDelay: '0.9s' }} />
    </>
  );
}

/** Letters fly into an envelope and the unread badge pops. */
function InboxScene() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <rect key={i} x="44" y="10" width="32" height="22" rx="3" className="ml-fill-2 ml-inbox-letter" style={{ animationDelay: `${i * 0.6}s` }} />
      ))}
      <rect x="22" y="46" width="76" height="52" rx="6" className="ml-fill" />
      <path d="M22 50l38 26 38-26" className="ml-ink-stroke" strokeWidth="2.5" strokeLinejoin="round" />
      <g className="ml-pop">
        <circle cx="96" cy="46" r="10" className="ml-fill-2" />
        <text x="96" y="50" textAnchor="middle" className="ml-ink-text" fontSize="10" fontWeight="700">
          3
        </text>
      </g>
    </>
  );
}

/** An org chart draws itself and people appear. */
function HrmsScene() {
  const person = (cx: number, cy: number, cls: string, delay: number) => (
    <g className="ml-pop" style={{ animationDelay: `${delay}s` }}>
      <circle cx={cx} cy={cy} r="11" className={cls} />
      <circle cx={cx} cy={cy - 3} r="4" className="ml-ink" />
      <path d={`M${cx - 6} ${cy + 7}a6 5 0 0112 0`} className="ml-ink" />
    </g>
  );
  return (
    <>
      <path d="M60 40v14M28 54h64M28 54v12M60 54v12M92 54v12" className="ml-stroke ml-draw" strokeWidth="2.5" strokeLinecap="round" pathLength="100" />
      {person(60, 26, 'ml-fill', 0)}
      {person(28, 80, 'ml-fill-2', 0.4)}
      {person(60, 80, 'ml-fill-2', 0.6)}
      {person(92, 80, 'ml-fill-2', 0.8)}
    </>
  );
}

/** A balance scale settles: debits equal credits. */
function AccountsScene() {
  return (
    <>
      <path d="M60 22v74M42 98h36" className="ml-stroke" strokeWidth="3" strokeLinecap="round" />
      <circle cx="60" cy="22" r="4" className="ml-fill" />
      <g className="ml-scale-beam">
        <path d="M24 32h72" className="ml-stroke" strokeWidth="3" strokeLinecap="round" />
        <path d="M24 32l-10 24h20zM96 32l-10 24h20z" className="ml-stroke-soft" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M12 56a12 6 0 0024 0z" className="ml-fill" />
        <path d="M84 56a12 6 0 0024 0z" className="ml-fill-2" />
        <text x="24" y="52" textAnchor="middle" className="ml-accent-text" fontSize="9" fontWeight="700">
          Dr
        </text>
        <text x="96" y="52" textAnchor="middle" className="ml-accent-text" fontSize="9" fontWeight="700">
          Cr
        </text>
      </g>
    </>
  );
}

/** A contract page receives a hand-drawn signature and a seal. */
function ContractsScene() {
  return (
    <>
      <path d="M28 12h46l18 18v78H28z" className="ml-panel ml-stroke" strokeWidth="2" strokeLinejoin="round" />
      <path d="M74 12v18h18" className="ml-stroke" strokeWidth="2" strokeLinejoin="round" />
      {[38, 46, 54, 62].map((y, i) => (
        <rect key={y} x="36" y={y} width={i === 3 ? 26 : 46} height="3" rx="1.5" className="ml-fill-soft" />
      ))}
      <path d="M36 88h40" className="ml-stroke-soft" strokeWidth="1.5" />
      <path d="M38 84c4-10 8-10 8-2s4 6 8-4 6 0 6 4 4 0 8-4" className="ml-stroke-2 ml-draw" strokeWidth="2.5" strokeLinecap="round" pathLength="100" />
      <g className="ml-pop" style={{ animationDelay: '1.1s' }}>
        <circle cx="90" cy="92" r="12" className="ml-fill" />
        <path d="M84 92l4 4 8-8" className="ml-ink-stroke" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </>
  );
}

/** An invoice prints out of the terminal line by line. */
function BillingScene() {
  return (
    <>
      <clipPath id="ml-bill-clip">
        <rect x="20" y="30" width="80" height="90" />
      </clipPath>
      <g clipPath="url(#ml-bill-clip)">
        <g className="ml-bill-paper">
          <path d="M34 30h52v66l-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5-6.5-5-6.5 5z" className="ml-panel ml-stroke-soft" strokeWidth="1.5" />
          <rect x="40" y="40" width="24" height="3" rx="1.5" className="ml-fill" />
          <rect x="40" y="50" width="40" height="2.5" rx="1" className="ml-fill-soft" />
          <rect x="40" y="57" width="34" height="2.5" rx="1" className="ml-fill-soft" />
          <rect x="40" y="64" width="38" height="2.5" rx="1" className="ml-fill-soft" />
          <path d="M40 73h40" className="ml-stroke-soft" strokeWidth="1" strokeDasharray="2 2" />
          <rect x="58" y="78" width="22" height="4" rx="1.5" className="ml-fill-2" />
        </g>
      </g>
      <rect x="20" y="18" width="80" height="16" rx="5" className="ml-fill" />
      <rect x="30" y="29" width="60" height="3" rx="1.5" className="ml-ink" />
      <circle cx="88" cy="24" r="2.5" className="ml-fill-2 ml-blink" />
    </>
  );
}

/** A server rack with blinking status lights and a scanning beam. */
function AssetsScene() {
  return (
    <>
      {[20, 46, 72].map((y, i) => (
        <g key={y}>
          <rect x="26" y={y} width="68" height="22" rx="4" className="ml-panel ml-stroke" strokeWidth="2" />
          {[36, 44, 52].map((x, j) => (
            <circle key={x} cx={x} cy={y + 11} r="2.6" className={j === 0 ? 'ml-fill-2 ml-blink' : 'ml-fill-soft ml-blink'} style={{ animationDelay: `${i * 0.3 + j * 0.2}s` }} />
          ))}
          <rect x="64" y={y + 8} width="22" height="6" rx="2" className="ml-fill-faint" />
        </g>
      ))}
      <rect x="20" y="16" width="80" height="3" rx="1.5" className="ml-fill ml-assets-scan" />
    </>
  );
}

/** Capacity bars rise and settle around a 100% line. */
function ResourcesScene() {
  return (
    <>
      <path d="M14 98h92" className="ml-stroke-soft" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 38h92" className="ml-stroke-2" strokeWidth="1.5" strokeDasharray="4 4" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={20 + i * 18} y="30" width="12" height="68" rx="3" className={i === 2 ? 'ml-fill-2 ml-bar' : 'ml-fill ml-bar'} style={{ animationDelay: `${i * 0.18}s` }} />
      ))}
      <text x="104" y="34" textAnchor="end" className="ml-accent-text" fontSize="8" fontWeight="700">
        100%
      </text>
    </>
  );
}

/** A parcel closes up and rides the conveyor to delivery. */
function ProcurementScene() {
  return (
    <>
      <path d="M8 88h104" className="ml-stroke" strokeWidth="3" strokeLinecap="round" />
      {[18, 38, 58, 78, 98].map((x) => (
        <circle key={x} cx={x} cy="96" r="4" className="ml-stroke-soft ml-spin" strokeWidth="2" style={{ transformOrigin: `${x}px 96px` }} />
      ))}
      <g className="ml-parcel">
        <rect x="40" y="52" width="40" height="34" rx="3" className="ml-fill" />
        <path d="M40 52l-6-10h40l6 10M80 52l6-10" className="ml-stroke-2" strokeWidth="2" strokeLinejoin="round" />
        <rect x="56" y="52" width="8" height="34" className="ml-fill-2" />
        <rect x="46" y="74" width="10" height="6" rx="1" className="ml-ink" />
      </g>
    </>
  );
}

/** Pages fan out of a folder as they are indexed. */
function DocumentsScene() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <g key={i} className="ml-doc-page" style={{ animationDelay: `${i * 0.45}s` }}>
          <rect x="38" y="28" width="44" height="54" rx="4" className="ml-panel ml-stroke" strokeWidth="1.5" />
          <rect x="45" y="38" width="30" height="3" rx="1.5" className="ml-fill" />
          <rect x="45" y="46" width="24" height="2.5" rx="1" className="ml-fill-soft" />
          <rect x="45" y="52" width="28" height="2.5" rx="1" className="ml-fill-soft" />
        </g>
      ))}
      <path d="M18 56h28l6 6h50v36a4 4 0 01-4 4H22a4 4 0 01-4-4z" className="ml-fill" />
      <path d="M18 66h84" className="ml-ink-stroke" strokeWidth="1.5" />
    </>
  );
}

/** Calendar days get ticked off one by one. */
function CalendarScene() {
  const cells = Array.from({ length: 12 }, (_, i) => i);
  return (
    <>
      <rect x="16" y="22" width="88" height="80" rx="8" className="ml-panel ml-stroke" strokeWidth="2" />
      <path d="M16 30a8 8 0 018-8h72a8 8 0 018 8v10H16z" className="ml-fill" />
      <path d="M38 14v14M82 14v14" className="ml-stroke" strokeWidth="4" strokeLinecap="round" />
      {cells.map((i) => {
        const x = 26 + (i % 4) * 18;
        const y = 50 + Math.floor(i / 4) * 16;
        return (
          <g key={i}>
            <rect x={x} y={y} width="13" height="11" rx="2" className="ml-fill-faint" />
            <rect x={x} y={y} width="13" height="11" rx="2" className="ml-fill-2 ml-cal-day" style={{ animationDelay: `${i * 0.15}s` }} />
          </g>
        );
      })}
    </>
  );
}

/** A heartbeat trace sweeps across the screen. */
function MonitorScene() {
  return (
    <>
      <rect x="10" y="20" width="100" height="72" rx="8" className="ml-panel ml-stroke" strokeWidth="2" />
      {[38, 56, 74].map((y) => (
        <path key={y} d={`M14 ${y}h92`} className="ml-stroke-soft" strokeWidth="0.75" strokeDasharray="2 3" />
      ))}
      <path d="M14 58h22l6-16 8 32 8-40 8 34 6-10h34" className="ml-stroke ml-ecg" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength="100" />
      <circle cx="98" cy="30" r="3" className="ml-fill-2 ml-blink" />
      <rect x="44" y="96" width="32" height="6" rx="3" className="ml-fill-soft" />
    </>
  );
}

/** Module nodes orbit the platform core. */
function CoreScene() {
  return (
    <>
      <circle cx="60" cy="60" r="40" className="ml-track" strokeWidth="1.5" strokeDasharray="3 5" />
      <circle cx="60" cy="60" r="24" className="ml-track" strokeWidth="1.5" />
      <g className="ml-orbit" style={{ transformOrigin: '60px 60px' }}>
        <circle cx="60" cy="20" r="6" className="ml-fill-2" />
        <circle cx="25" cy="80" r="5" className="ml-fill" />
        <circle cx="95" cy="80" r="4" className="ml-fill-soft" />
      </g>
      <g className="ml-orbit-rev" style={{ transformOrigin: '60px 60px' }}>
        <circle cx="84" cy="60" r="4" className="ml-fill" />
        <circle cx="36" cy="60" r="3" className="ml-fill-2" />
      </g>
      <circle cx="60" cy="60" r="11" className="ml-fill ml-breathe" style={{ transformOrigin: '60px 60px' }} />
      <circle cx="60" cy="60" r="4" className="ml-ink" />
    </>
  );
}
