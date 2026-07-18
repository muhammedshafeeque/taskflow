/**
 * Lightweight CSS/SVG “live” scenes for Home module cards.
 * Prefer motion that reads at card size; respects prefers-reduced-motion.
 */

type HubVisualId =
  | 'pm'
  | 'auth'
  | 'crm'
  | 'mail'
  | 'service'
  | 'portal-admin'
  | 'inbox'
  | 'hrms'
  | 'accounts'
  | 'contracts'
  | 'billing'
  | 'assets'
  | 'resources'
  | 'procurement'
  | 'documents'
  | 'calendar';

export function HubModuleVisual({ id }: { id: string }) {
  switch (id as HubVisualId) {
    case 'pm':
      return <PmBoardVisual />;
    case 'auth':
      return <AuthShieldVisual />;
    case 'crm':
      return <CrmPipelineVisual />;
    case 'mail':
      return <MailFlyVisual />;
    case 'service':
      return <ServiceTicketVisual />;
    case 'portal-admin':
      return <PortalWindowVisual />;
    case 'inbox':
      return <InboxPulseVisual />;
    case 'hrms':
      return <HrmsPeopleVisual />;
    case 'accounts':
      return <AccountsBooksVisual />;
    case 'contracts':
      return <ContractsVisual />;
    case 'billing':
      return <BillingVisual />;
    case 'assets':
      return <AssetsVisual />;
    case 'resources':
      return <ResourcesVisual />;
    case 'procurement':
      return <ProcurementVisual />;
    case 'documents':
      return <DocumentsVisual />;
    case 'calendar':
      return <CalendarVisual />;
    default:
      return <PmBoardVisual />;
  }
}

function Frame({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div
      className="hub-visual relative flex h-full min-h-[4.5rem] w-full items-center justify-center overflow-hidden rounded-lg bg-[color:var(--bg-elevated)]/50 ring-1 ring-white/10 transition group-hover:ring-[color:var(--accent)]/35"
      aria-hidden
      data-visual={label}
    >
      {children}
    </div>
  );
}

function PmBoardVisual() {
  return (
    <Frame label="pm">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        {/* Kanban columns */}
        {[28, 64, 100].map((x, i) => (
          <g key={x}>
            <rect x={x} y="14" width="28" height="72" rx="4" className="fill-white/5 stroke-sky-400/30" strokeWidth="1" />
            <rect
              x={x + 4}
              y="22"
              width="20"
              height="10"
              rx="2"
              className="fill-sky-400/70 hub-anim-float"
              style={{ animationDelay: `${i * 0.25}s` }}
            />
            <rect
              x={x + 4}
              y="36"
              width="20"
              height="10"
              rx="2"
              className="fill-blue-400/45 hub-anim-float"
              style={{ animationDelay: `${0.4 + i * 0.2}s` }}
            />
            {i < 2 && (
              <rect
                x={x + 4}
                y="50"
                width="20"
                height="10"
                rx="2"
                className="fill-indigo-400/35 hub-anim-slide-x"
                style={{ animationDelay: `${0.6 + i * 0.3}s` }}
              />
            )}
          </g>
        ))}
        {/* Moving card between columns */}
        <rect x="40" y="64" width="20" height="10" rx="2" className="fill-cyan-300/80 hub-anim-kanban-card" />
      </svg>
    </Frame>
  );
}

function AuthShieldVisual() {
  return (
    <Frame label="auth">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        <circle cx="52" cy="42" r="14" className="stroke-sky-400/50" strokeWidth="1.5" />
        <circle cx="52" cy="38" r="5" className="fill-sky-300/70 hub-anim-pulse" />
        <path d="M42 54c2-6 18-6 20 0" className="stroke-sky-300/60" strokeWidth="1.5" strokeLinecap="round" />
        <path
          d="M98 22l22 8v16c0 14-10 24-22 30-12-6-22-16-22-30V30l22-8z"
          className="fill-sky-500/15 stroke-sky-400/70 hub-anim-pulse"
          strokeWidth="1.5"
        />
        <path d="M92 44l6 6 12-12" className="stroke-cyan-300 hub-anim-check" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <g>
          <circle cx="118" cy="48" r="3" className="fill-sky-300/80" />
          <animateTransform attributeName="transform" type="rotate" from="0 98 48" to="360 98 48" dur="4s" repeatCount="indefinite" />
        </g>
        <g>
          <circle cx="118" cy="48" r="2.5" className="fill-blue-300/60" />
          <animateTransform attributeName="transform" type="rotate" from="180 98 48" to="540 98 48" dur="5.5s" repeatCount="indefinite" />
        </g>
      </svg>
    </Frame>
  );
}

function CrmPipelineVisual() {
  return (
    <Frame label="crm">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        {[
          { x: 18, w: 36, h: 56, y: 28, fill: 'fill-violet-400/35' },
          { x: 58, w: 30, h: 44, y: 40, fill: 'fill-purple-400/45' },
          { x: 92, w: 24, h: 32, y: 52, fill: 'fill-fuchsia-400/50' },
          { x: 120, w: 18, h: 22, y: 62, fill: 'fill-pink-300/55' },
        ].map((s, i) => (
          <rect
            key={s.x}
            x={s.x}
            y={s.y}
            width={s.w}
            height={s.h}
            rx="4"
            className={`${s.fill} stroke-violet-300/30 hub-anim-grow-y`}
            strokeWidth="1"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
        {/* Deal chip marching through funnel */}
        <circle r="5" className="fill-violet-200 hub-anim-funnel-dot">
          <animateMotion dur="3.5s" repeatCount="indefinite" path="M36,48 C58,48 70,56 96,60 C112,62 126,68 130,72" />
        </circle>
        <text x="22" y="22" className="fill-violet-200/70" fontSize="8" fontFamily="system-ui">
          Pipeline
        </text>
      </svg>
    </Frame>
  );
}

function MailFlyVisual() {
  return (
    <Frame label="mail">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        <rect x="36" y="30" width="72" height="48" rx="6" className="fill-cyan-500/15 stroke-cyan-400/50" strokeWidth="1.5" />
        <path d="M36 38l36 22 36-22" className="stroke-cyan-300/80 hub-anim-pulse" strokeWidth="1.5" strokeLinejoin="round" />
        {/* Flying envelope */}
        <g className="hub-anim-mail-fly">
          <rect x="0" y="0" width="22" height="14" rx="2" className="fill-teal-300/80" />
          <path d="M0 2l11 8L22 2" className="stroke-teal-900/40" strokeWidth="1" />
        </g>
        {/* Inbox tray bounce */}
        <path d="M48 78h48l-6 10H54l-6-10z" className="fill-cyan-400/40 hub-anim-float" />
        <circle cx="126" cy="28" r="3" className="fill-cyan-300/70 hub-anim-blink" />
        <circle cx="136" cy="38" r="2" className="fill-teal-200/50 hub-anim-blink" style={{ animationDelay: '0.4s' }} />
      </svg>
    </Frame>
  );
}

function ServiceTicketVisual() {
  return (
    <Frame label="service">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        {[0, 1, 2].map((i) => (
          <g key={i} className="hub-anim-float" style={{ animationDelay: `${i * 0.35}s` }}>
            <rect
              x={30 + i * 8}
              y={24 + i * 8}
              width="70"
              height="36"
              rx="5"
              className="fill-amber-500/20 stroke-amber-400/45"
              strokeWidth="1.2"
            />
            <rect x={40 + i * 8} y={34 + i * 8} width="36" height="4" rx="1" className="fill-amber-200/50" />
            <rect x={40 + i * 8} y={42 + i * 8} width="24" height="3" rx="1" className="fill-amber-200/30" />
          </g>
        ))}
        <circle cx="124" cy="36" r="16" className="fill-orange-500/15 stroke-orange-400/60 hub-anim-pulse" strokeWidth="1.5" />
        <g>
          <line x1="124" y1="36" x2="124" y2="26" className="stroke-orange-200" strokeWidth="2" strokeLinecap="round" />
          <animateTransform attributeName="transform" type="rotate" from="0 124 36" to="360 124 36" dur="4s" repeatCount="indefinite" />
        </g>
        <g>
          <line x1="124" y1="36" x2="132" y2="40" className="stroke-amber-300/80" strokeWidth="1.5" strokeLinecap="round" />
          <animateTransform attributeName="transform" type="rotate" from="0 124 36" to="360 124 36" dur="12s" repeatCount="indefinite" />
        </g>
      </svg>
    </Frame>
  );
}

function PortalWindowVisual() {
  return (
    <Frame label="portal">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        <rect x="28" y="18" width="104" height="68" rx="8" className="fill-emerald-500/10 stroke-emerald-400/45" strokeWidth="1.5" />
        <rect x="28" y="18" width="104" height="14" rx="8" className="fill-emerald-400/20" />
        <circle cx="40" cy="25" r="2.5" className="fill-red-400/70" />
        <circle cx="50" cy="25" r="2.5" className="fill-amber-300/70" />
        <circle cx="60" cy="25" r="2.5" className="fill-emerald-300/70" />
        {/* Content panels */}
        <rect x="38" y="42" width="40" height="32" rx="4" className="fill-emerald-400/20 hub-anim-float" />
        <rect x="86" y="42" width="36" height="14" rx="3" className="fill-teal-300/35 hub-anim-float" style={{ animationDelay: '0.3s' }} />
        <rect x="86" y="60" width="36" height="14" rx="3" className="fill-green-300/25 hub-anim-float" style={{ animationDelay: '0.6s' }} />
        {/* Approval check badge */}
        <circle cx="122" cy="74" r="10" className="fill-emerald-400/30 stroke-emerald-300 hub-anim-pulse" strokeWidth="1.2" />
        <path d="M117 74l3 3 7-7" className="stroke-emerald-100 hub-anim-check" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Frame>
  );
}

function InboxPulseVisual() {
  return (
    <Frame label="inbox">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        {[0, 1, 2].map((i) => (
          <g key={i} className="hub-anim-notif-in" style={{ animationDelay: `${i * 0.55}s` }}>
            <rect
              x={34 + i * 6}
              y={22 + i * 16}
              width="78"
              height="24"
              rx="5"
              className="fill-slate-400/20 stroke-slate-300/35"
              strokeWidth="1"
            />
            <circle cx={48 + i * 6} cy={34 + i * 16} r="5" className="fill-sky-400/60" />
            <rect x={58 + i * 6} y={29 + i * 16} width="40" height="3" rx="1" className="fill-slate-200/45" />
            <rect x={58 + i * 6} y={36 + i * 16} width="28" height="3" rx="1" className="fill-slate-200/25" />
          </g>
        ))}
        <g transform="translate(126 28)">
          <g>
            <path d="M0 8c0-6 4-10 8-10s8 4 8 10c0 6 2 8 2 8H-2s2-2 2-8z" className="fill-slate-300/50 stroke-slate-200/70" strokeWidth="1" />
            <circle cx="8" cy="20" r="2.5" className="fill-sky-300 hub-anim-blink" />
            <animateTransform attributeName="transform" type="rotate" values="-8;12;-10;6;0" keyTimes="0;0.2;0.45;0.7;1" dur="2.2s" repeatCount="indefinite" />
          </g>
        </g>
      </svg>
    </Frame>
  );
}

function HrmsPeopleVisual() {
  return (
    <Frame label="hrms">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        {[40, 80, 120].map((x, i) => (
          <g key={x} className="hub-anim-float" style={{ animationDelay: `${i * 0.35}s` }}>
            <circle cx={x} cy="34" r="10" className="fill-rose-400/25 stroke-rose-300/60" strokeWidth="1.2" />
            <circle cx={x} cy="31" r="4" className="fill-rose-200/70" />
            <path d={`M${x - 10} 52c2-8 18-8 20 0`} className="stroke-rose-300/55" strokeWidth="1.4" strokeLinecap="round" />
          </g>
        ))}
        {/* Calendar / attendance pulse */}
        <rect x="48" y="62" width="64" height="28" rx="5" className="fill-pink-500/15 stroke-rose-400/40" strokeWidth="1.2" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect
            key={i}
            x={56 + i * 10}
            y="72"
            width="7"
            height="10"
            rx="1.5"
            className={`hub-anim-blink ${i % 2 === 0 ? 'fill-rose-300/70' : 'fill-rose-300/30'}`}
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </svg>
    </Frame>
  );
}

function AccountsBooksVisual() {
  return (
    <Frame label="accounts">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        {[22, 38, 54, 70, 86].map((h, i) => (
          <rect
            key={h}
            x={28 + i * 18}
            y={88 - h}
            width="12"
            height={h}
            rx="2"
            className="fill-lime-400/35 stroke-lime-300/40 hub-anim-grow-y"
            strokeWidth="1"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
        <g className="hub-anim-float" style={{ animationDelay: '0.4s' }}>
          <rect x="112" y="22" width="36" height="46" rx="4" className="fill-emerald-400/20 stroke-lime-300/50" strokeWidth="1.2" />
          <rect x="118" y="30" width="24" height="3" rx="1" className="fill-lime-100/50" />
          <rect x="118" y="38" width="18" height="3" rx="1" className="fill-lime-100/35" />
          <rect x="118" y="46" width="22" height="3" rx="1" className="fill-lime-100/30" />
          <text x="118" y="62" className="fill-lime-200/80" fontSize="8" fontFamily="system-ui">
            $
          </text>
        </g>
        <circle cx="130" cy="80" r="8" className="fill-yellow-400/30 stroke-lime-300/60 hub-anim-pulse" strokeWidth="1.2" />
      </svg>
    </Frame>
  );
}

function ContractsVisual() {
  return (
    <Frame label="contracts">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        <rect x="36" y="18" width="52" height="68" rx="6" className="fill-indigo-500/15 stroke-indigo-400/50 hub-anim-float" strokeWidth="1.3" />
        <rect x="44" y="30" width="36" height="4" rx="1" className="fill-indigo-200/50" />
        <rect x="44" y="40" width="28" height="3" rx="1" className="fill-indigo-200/35" />
        <rect x="44" y="48" width="32" height="3" rx="1" className="fill-indigo-200/30" />
        <path d="M52 66l6 6 12-14" className="stroke-indigo-200 hub-anim-check" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="118" cy="40" r="18" className="fill-blue-500/15 stroke-indigo-300/50 hub-anim-pulse" strokeWidth="1.3" />
        <path d="M118 28v12l8 6" className="stroke-indigo-100" strokeWidth="1.8" strokeLinecap="round">
          <animateTransform attributeName="transform" type="rotate" from="0 118 40" to="360 118 40" dur="8s" repeatCount="indefinite" />
        </path>
      </svg>
    </Frame>
  );
}

function BillingVisual() {
  return (
    <Frame label="billing">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        <rect x="30" y="28" width="60" height="48" rx="6" className="fill-yellow-500/15 stroke-amber-400/50" strokeWidth="1.3" />
        <rect x="38" y="38" width="28" height="4" rx="1" className="fill-amber-200/55 hub-anim-blink" />
        <rect x="38" y="48" width="40" height="3" rx="1" className="fill-amber-200/35" />
        <rect x="38" y="56" width="22" height="3" rx="1" className="fill-amber-200/30" />
        <g className="hub-anim-mail-fly">
          <rect x="0" y="0" width="20" height="12" rx="2" className="fill-yellow-300/80" />
        </g>
        <circle cx="120" cy="52" r="16" className="fill-amber-400/20 stroke-yellow-300/60 hub-anim-pulse" strokeWidth="1.3" />
        <text x="114" y="57" className="fill-yellow-100" fontSize="14" fontFamily="system-ui" fontWeight="700">
          ₹
        </text>
      </svg>
    </Frame>
  );
}

function AssetsVisual() {
  return (
    <Frame label="assets">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        <rect x="28" y="30" width="40" height="28" rx="3" className="fill-stone-400/25 stroke-stone-300/50 hub-anim-float" strokeWidth="1.2" />
        <rect x="36" y="58" width="24" height="4" rx="1" className="fill-stone-300/40" />
        <rect x="72" y="24" width="28" height="44" rx="4" className="fill-zinc-400/20 stroke-stone-300/45 hub-anim-float" strokeWidth="1.2" style={{ animationDelay: '0.3s' }} />
        <rect x="78" y="32" width="16" height="10" rx="2" className="fill-stone-200/40" />
        <rect x="112" y="34" width="28" height="36" rx="3" className="fill-stone-500/20 stroke-stone-300/40 hub-anim-pulse" strokeWidth="1.2" />
        <circle cx="126" cy="70" r="4" className="fill-emerald-400/70 hub-anim-blink" />
      </svg>
    </Frame>
  );
}

function ResourcesVisual() {
  return (
    <Frame label="resources">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        {[0, 1, 2, 3].map((i) => (
          <g key={i} className="hub-anim-float" style={{ animationDelay: `${i * 0.2}s` }}>
            <circle cx={36 + i * 28} cy="34" r="9" className="fill-fuchsia-400/25 stroke-fuchsia-300/55" strokeWidth="1.2" />
            <rect x={28 + i * 28} y="50" width="16" height={20 + (i % 3) * 8} rx="2" className="fill-fuchsia-400/30 hub-anim-grow-y" style={{ animationDelay: `${i * 0.15}s` }} />
          </g>
        ))}
      </svg>
    </Frame>
  );
}

function ProcurementVisual() {
  return (
    <Frame label="procurement">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        <rect x="34" y="36" width="54" height="34" rx="4" className="fill-orange-500/15 stroke-orange-400/50" strokeWidth="1.3" />
        <path d="M40 36l8-12h26l8 12" className="stroke-orange-300/60" strokeWidth="1.3" strokeLinejoin="round" />
        <circle cx="48" cy="72" r="5" className="fill-orange-300/50 hub-anim-blink" />
        <circle cx="74" cy="72" r="5" className="fill-orange-300/50 hub-anim-blink" style={{ animationDelay: '0.4s' }} />
        <g className="hub-anim-slide-x">
          <rect x="104" y="30" width="36" height="44" rx="4" className="fill-red-400/15 stroke-orange-300/45" strokeWidth="1.2" />
          <rect x="110" y="38" width="24" height="3" rx="1" className="fill-orange-100/45" />
          <rect x="110" y="46" width="18" height="3" rx="1" className="fill-orange-100/30" />
        </g>
      </svg>
    </Frame>
  );
}

function DocumentsVisual() {
  return (
    <Frame label="documents">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        {[0, 1, 2].map((i) => (
          <g key={i} className="hub-anim-float" style={{ animationDelay: `${i * 0.35}s` }}>
            <rect
              x={40 + i * 14}
              y={22 + i * 8}
              width="48"
              height="58"
              rx="4"
              className="fill-teal-500/15 stroke-teal-400/45"
              strokeWidth="1.2"
            />
            <rect x={48 + i * 14} y={34 + i * 8} width="32" height="3" rx="1" className="fill-teal-100/45" />
            <rect x={48 + i * 14} y={42 + i * 8} width="24" height="3" rx="1" className="fill-teal-100/30" />
          </g>
        ))}
      </svg>
    </Frame>
  );
}

function CalendarVisual() {
  return (
    <Frame label="calendar">
      <svg viewBox="0 0 160 100" className="h-[85%] w-[90%]" fill="none">
        <rect x="36" y="22" width="88" height="62" rx="8" className="fill-sky-500/15 stroke-sky-400/50" strokeWidth="1.3" />
        <rect x="36" y="22" width="88" height="16" rx="8" className="fill-sky-400/25" />
        {[0, 1, 2, 3, 4].map((i) => (
          <rect
            key={i}
            x={48 + i * 14}
            y="50"
            width="10"
            height="10"
            rx="2"
            className={`hub-anim-blink ${i === 2 ? 'fill-sky-300/80' : 'fill-sky-300/30'}`}
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
        <circle cx="118" cy="30" r="3" className="fill-sky-200 hub-anim-pulse" />
      </svg>
    </Frame>
  );
}

