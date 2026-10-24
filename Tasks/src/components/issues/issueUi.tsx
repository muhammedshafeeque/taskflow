import { MetaIconGlyph, type MetaIconKey } from '../../pages/ProjectSettings';
import { formatDateDDMMYYYY } from '../../lib/dateFormat';

/** Small visual primitives shared by the issue table, list and header. */

export type IssueMeta = { icon?: string; color?: string; fontColor?: string } | undefined;

const AVATAR_PALETTE = ['#388bfd', '#3fb950', '#d29922', '#bc8cff', '#f85149', '#e8912d', '#58b9de', '#79c0ff'];

function avatarColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = char.charCodeAt(0) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function Avatar({ name, size = 24 }: { name: string | null | undefined; size?: number }) {
  if (!name) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-[color:var(--border-emphasis)] text-[color:var(--text-muted)]"
        style={{ width: size, height: size, fontSize: size * 0.42 }}
        title="Unassigned"
      >
        ?
      </span>
    );
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ring-2 ring-[color:var(--bg-surface)]"
      style={{ width: size, height: size, fontSize: size * 0.38, backgroundColor: avatarColor(name) }}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

export function PersonCell({ name }: { name: string | null | undefined }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar name={name} />
      <span className={`truncate text-[13px] ${name ? 'text-[color:var(--text-primary)]' : 'text-[color:var(--text-muted)]'}`} title={name ?? 'Unassigned'}>
        {name ?? 'Unassigned'}
      </span>
    </span>
  );
}

/** Status as a soft pill with a coloured dot; colour comes from project settings. */
export function StatusPill({ label, meta }: { label: string; meta: IssueMeta }) {
  const color = meta?.color;
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold"
      style={
        color
          ? { backgroundColor: `${color}1f`, borderColor: `${color}3d`, color: meta?.fontColor || color }
          : { backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }
      }
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color ?? 'currentColor' }} />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Priority as icon (or dot) + label, without a heavy badge. */
export function PriorityTag({ label, meta }: { label: string; meta: IssueMeta }) {
  const color = meta?.color;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 text-[12px] font-medium text-[color:var(--text-primary)]">
      {meta?.icon ? (
        <span style={color ? { color } : undefined} className="shrink-0">
          <MetaIconGlyph icon={meta.icon as MetaIconKey} className="h-3.5 w-3.5" />
        </span>
      ) : (
        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: color ?? 'var(--text-muted)' }} />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Type as a compact icon + label. */
export function TypeTag({ label, meta }: { label: string; meta: IssueMeta }) {
  const color = meta?.color;
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 text-[12px] text-[color:var(--text-muted)]">
      <span
        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded"
        style={{ backgroundColor: color ? `${color}26` : 'var(--bg-elevated)', color: color ?? 'var(--text-muted)' }}
      >
        {meta?.icon ? (
          <MetaIconGlyph icon={meta.icon as MetaIconKey} className="h-3 w-3" />
        ) : (
          <span className="text-[9px] font-bold uppercase">{label.slice(0, 1)}</span>
        )}
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
}

const DAY = 86_400_000;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Due date with an at-a-glance state: overdue, today, soon. */
export function DueDate({ value }: { value?: string | null }) {
  if (!value) return <span className="text-[12px] text-[color:var(--text-muted)]">—</span>;
  const diff = Math.round((startOfDay(new Date(value)) - startOfDay(new Date())) / DAY);
  const full = formatDateDDMMYYYY(value);
  if (diff < 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-red-500/12 px-1.5 py-0.5 text-[11px] font-semibold text-red-500" title={full}>
        {Math.abs(diff)}d overdue
      </span>
    );
  }
  if (diff === 0) {
    return (
      <span className="inline-flex items-center rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-500" title={full}>
        Today
      </span>
    );
  }
  return (
    <span className={`text-[12px] ${diff <= 3 ? 'font-medium text-amber-500' : 'text-[color:var(--text-muted)]'}`} title={full}>
      {diff <= 7 ? `in ${diff}d` : full}
    </span>
  );
}

/** "3d ago" style date with the exact date on hover. */
function relativeText(value: string): string {
  const mins = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  if (mins < 60 * 24 * 30) return `${Math.round(mins / (60 * 24))}d ago`;
  return formatDateDDMMYYYY(value);
}

export function RelativeDate({ value }: { value?: string | null }) {
  if (!value) return <span className="text-[12px] text-[color:var(--text-muted)]">—</span>;
  const text = relativeText(value);
  return (
    <span className="text-[12px] tabular-nums text-[color:var(--text-muted)]" title={formatDateDDMMYYYY(value)}>
      {text}
    </span>
  );
}

/** Loading placeholder that mirrors the table/list row shape. */
export function IssuesSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]">
      <div className="h-9 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]/60" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-4 border-b border-[color:var(--border-subtle)]/50 px-4 py-3.5 last:border-0" style={{ animationDelay: `${i * 60}ms` }}>
          <div className="h-4 w-4 rounded bg-[color:var(--bg-elevated)]" />
          <div className="h-3.5 w-16 rounded bg-[color:var(--bg-elevated)]" />
          <div className="h-3.5 rounded bg-[color:var(--bg-elevated)]" style={{ width: `${30 + ((i * 17) % 30)}%` }} />
          <div className="ml-auto h-5 w-20 rounded-md bg-[color:var(--bg-elevated)]" />
          <div className="h-6 w-6 rounded-full bg-[color:var(--bg-elevated)]" />
        </div>
      ))}
    </div>
  );
}

/** Empty result with the next sensible action. */
export function IssuesEmptyState({
  filtered,
  onClearFilters,
  onCreate,
}: {
  filtered: boolean;
  onClearFilters?: () => void;
  onCreate?: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-6 py-16 text-center">
      <svg viewBox="0 0 64 64" className="mx-auto mb-4 h-14 w-14" fill="none" aria-hidden>
        <rect x="10" y="12" width="44" height="40" rx="8" fill="var(--accent-subtle)" stroke="var(--accent)" strokeOpacity=".35" strokeWidth="1.5" />
        <path d="M20 26h18M20 34h24M20 42h12" stroke="var(--accent)" strokeOpacity=".6" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="46" cy="44" r="9" fill="var(--bg-surface)" stroke="var(--accent)" strokeWidth="2" />
        <path d="M52.5 50.5L57 55" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <p className="text-[15px] font-semibold text-[color:var(--text-primary)]">
        {filtered ? 'No issues match this view' : 'No issues yet'}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-[13px] text-[color:var(--text-muted)]">
        {filtered
          ? 'Try removing a filter or switching scope to see more.'
          : 'Create the first issue to start tracking work here.'}
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        {filtered && onClearFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className="h-8 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-4 text-[12px] font-semibold text-[color:var(--text-primary)] transition hover:border-[color:var(--border-emphasis)]"
          >
            Clear filters
          </button>
        )}
        {onCreate && (
          <button type="button" onClick={() => onCreate()} className="btn-primary btn-primary-sm font-semibold">
            New issue
          </button>
        )}
      </div>
    </div>
  );
}
