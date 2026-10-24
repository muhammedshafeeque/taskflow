import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink } from 'react-router-dom';
import { FiX } from 'react-icons/fi';
import { ModuleLoader } from '../../components/loaders/ModuleLoader';
import {
  resourcesApi,
  type AllocationCheck,
  type ResourceAllocation,
  type ResourceOptions,
  type ResourceSettingsRow,
} from '../../lib/api';
import { PersonSelect, toPeople } from '../../components/people';

/* ─── Dates (UTC day keys, matching the API) ─────────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;

export function todayKey(): string {
  return new Date().toLocaleDateString('en-CA');
}

export function addDaysKey(key: string, n: number): string {
  return new Date(new Date(`${key.slice(0, 10)}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

export function diffDaysKey(a: string, b: string): number {
  return Math.round((new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime() - new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime()) / DAY_MS);
}

export function toInputDate(v?: string | null): string {
  if (!v) return '';
  return String(v).slice(0, 10);
}

export function fmtDate(v?: string | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!v) return '—';
  return new Date(`${String(v).slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', ...opts });
}

export function fmtShort(v?: string | null): string {
  return fmtDate(v, { day: 'numeric', month: 'short' });
}

export function relDays(key: string | null | undefined, today = todayKey()): string {
  if (!key) return '';
  const d = diffDaysKey(today, key);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

/** Monday on or before a day key. */
export function weekStartKey(key: string): string {
  const dow = new Date(`${key}T00:00:00Z`).getUTCDay();
  return addDaysKey(key, -((dow + 6) % 7));
}

/* ─── Refs ───────────────────────────────────────────────────────────────── */

type Ref = { _id?: string; name?: string; key?: string; email?: string; title?: string } | string | null | undefined;

export function refName(ref: Ref, withKey = true): string {
  if (!ref) return '—';
  if (typeof ref === 'string') return ref;
  if (ref.key && withKey) return ref.name ? `${ref.key} · ${ref.name}` : ref.key;
  return ref.name ?? ref.title ?? ref.email ?? '—';
}

export function refKey(ref: Ref): string {
  if (!ref) return '';
  if (typeof ref === 'string') return ref;
  return ref._id ?? '';
}

export function errorOf(res: unknown, fallback = 'Something went wrong'): string {
  return (res as { message?: string })?.message ?? fallback;
}

/* ─── Load tones ─────────────────────────────────────────────────────────── */

export type LoadLevel = 'none' | 'bench' | 'partial' | 'busy' | 'over';

export const DEFAULT_SETTINGS: ResourceSettingsRow = {
  defaultCapacityHoursPerWeek: 40,
  benchThresholdPct: 20,
  busyThresholdPct: 80,
  overAllocationPct: 100,
  forecastHorizonWeeks: 13,
  conflictLookaheadDays: 90,
  freeingSoonDays: 30,
  hoursPerStoryPoint: null,
  defaultTaskHours: null,
  includePendingStageEstimates: true,
  includeLoggedTime: true,
  includeCalendarEvents: true,
};

export function loadLevel(pct: number, s: Pick<ResourceSettingsRow, 'benchThresholdPct' | 'busyThresholdPct' | 'overAllocationPct'>): LoadLevel {
  if (pct <= 0) return 'none';
  if (pct > s.overAllocationPct) return 'over';
  if (pct >= s.busyThresholdPct) return 'busy';
  if (pct >= s.benchThresholdPct) return 'partial';
  return 'bench';
}

export const LEVEL_COLOR: Record<LoadLevel, string> = {
  none: 'var(--border-subtle)',
  bench: '#38bdf8',
  partial: '#22c55e',
  busy: '#f59e0b',
  over: '#ef4444',
};

export const LEVEL_LABEL: Record<LoadLevel, string> = {
  none: 'Unassigned',
  bench: 'Bench',
  partial: 'Partial',
  busy: 'Fully booked',
  over: 'Over-allocated',
};

export function LoadBar({
  hard,
  soft = 0,
  settings,
  className = '',
  showLabel = true,
}: {
  hard: number;
  soft?: number;
  settings: Pick<ResourceSettingsRow, 'benchThresholdPct' | 'busyThresholdPct' | 'overAllocationPct'>;
  className?: string;
  showLabel?: boolean;
}) {
  const scale = Math.max(settings.overAllocationPct, 100, hard + soft);
  const level = loadLevel(hard, settings);
  return (
    <div className={`flex items-center gap-2 min-w-[7rem] ${className}`}>
      <div
        className="relative h-2 flex-1 rounded-full bg-[color:var(--bg-elevated)] overflow-hidden"
        role="meter"
        aria-valuenow={hard}
        aria-valuemin={0}
        aria-valuemax={scale}
        aria-label={`${hard}% committed${soft ? `, ${soft}% soft` : ''}`}
      >
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(Math.min(hard, scale) / scale) * 100}%`, background: LEVEL_COLOR[level] }} />
        {soft > 0 && (
          <div
            className="absolute inset-y-0 rounded-r-full"
            style={{
              left: `${(Math.min(hard, scale) / scale) * 100}%`,
              width: `${(Math.min(soft, scale - Math.min(hard, scale)) / scale) * 100}%`,
              background: `repeating-linear-gradient(45deg, ${LEVEL_COLOR.busy}88 0 3px, transparent 3px 6px)`,
            }}
          />
        )}
        <div className="absolute inset-y-0 w-px bg-[color:var(--text-muted)]/60" style={{ left: `${(settings.overAllocationPct / scale) * 100}%` }} />
      </div>
      {showLabel && (
        <span className="text-xs tabular-nums w-12 text-right" style={{ color: level === 'over' ? LEVEL_COLOR.over : undefined }}>
          {Math.round(hard)}%
        </span>
      )}
    </div>
  );
}

export function LevelDot({ level }: { level: LoadLevel }) {
  return <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: LEVEL_COLOR[level] }} />;
}

/* ─── Layout primitives ──────────────────────────────────────────────────── */

export const inputCls =
  'w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm text-[color:var(--text-primary)] focus:outline-none focus:border-[color:var(--accent)]';

export const btnSecondary =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] text-sm hover:border-[color:var(--accent)]/50 transition disabled:opacity-50';

export const btnPrimary = 'btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm disabled:opacity-50';

export function PageShell({
  eyebrow = 'Resources',
  title,
  description,
  actions,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in w-full space-y-5">
      <header className="relative overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-5 py-5 sm:px-7">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 100% at 0% 0%, color-mix(in srgb, #0ea5e9 14%, transparent), transparent 50%), radial-gradient(ellipse 50% 80% at 100% 100%, color-mix(in srgb, var(--accent) 10%, transparent), transparent 45%)',
          }}
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">{eyebrow}</p>
            <h1 className="text-2xl font-bold tracking-tight mt-1">{title}</h1>
            {description && <p className="text-[13px] text-[color:var(--text-muted)] mt-1 max-w-2xl">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </header>
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  to,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'warn' | 'bad' | 'good';
  to?: string;
}) {
  const toneCls =
    tone === 'bad' ? 'text-red-400' : tone === 'warn' ? 'text-amber-400' : tone === 'good' ? 'text-emerald-400' : 'text-[color:var(--text-primary)]';
  const body = (
    <div className="h-full rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-4 py-3.5 card-shadow hover-elevated">
      <p className="text-[11px] font-medium uppercase tracking-wider text-[color:var(--text-muted)]">{label}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${toneCls}`}>{value}</p>
      {hint && <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">{hint}</p>}
    </div>
  );
  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Chip({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'warn' | 'bad' | 'good' | 'info'; title?: string }) {
  const cls = {
    neutral: 'bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)]',
    accent: 'bg-[color:var(--accent-subtle)] text-[color:var(--accent)]',
    warn: 'bg-amber-500/15 text-amber-400',
    bad: 'bg-red-500/15 text-red-400',
    good: 'bg-emerald-500/15 text-emerald-400',
    info: 'bg-sky-500/15 text-sky-400',
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap ${cls}`}>
      {children}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[color:var(--border-subtle)] p-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-[color:var(--text-muted)]">{children}</div>}
    </div>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return <ModuleLoader label={label} size="block" />;
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400 flex items-center justify-between gap-3">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="text-xs underline" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'sm',
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode; count?: number }>;
  size?: 'sm' | 'xs';
}) {
  return (
    <div className="inline-flex rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-0.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md ${size === 'xs' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs'} font-medium transition ${
            value === o.value
              ? 'bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] shadow-sm'
              : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
          }`}
        >
          {o.label}
          {o.count != null && <span className="ml-1 opacity-60 tabular-nums">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children, className = '' }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-xs space-y-1 ${className}`}>
      <span className="text-[color:var(--text-muted)] font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-[color:var(--text-muted)]">{hint}</span>}
    </label>
  );
}

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  width = 'max-w-lg',
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`bg-[color:var(--bg-modal)] border border-[color:var(--border-subtle)] rounded-2xl ${width} w-full p-6 shadow-xl animate-scale-in my-8`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            {subtitle && <div className="text-xs text-[color:var(--text-muted)] mt-0.5">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-md text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]" aria-label="Close">
            <FiX />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

/** Secondary nav shown under page headers so related screens are one click apart. */
export function ResourceSubnav({ links }: { links: Array<{ to: string; label: string }> }) {
  return (
    <nav className="flex flex-wrap gap-1.5 text-xs">
      {links.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end
          className={({ isActive }) =>
            `px-2.5 py-1 rounded-md border transition ${
              isActive
                ? 'border-[color:var(--accent)]/50 bg-[color:var(--accent-subtle)] text-[color:var(--accent)]'
                : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
            }`
          }
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  );
}

/* ─── Teams ───────────────────────────────────────────────────────────────── */

export function teamColor(color?: string): string {
  return color || 'var(--accent)';
}

export function TeamChip({ name, color, onClick, active }: { name: string; color?: string; onClick?: () => void; active?: boolean }) {
  const body = (
    <>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: teamColor(color) }} />
      <span className="truncate">{name}</span>
    </>
  );
  const cls = `inline-flex items-center gap-1 max-w-[10rem] rounded-full px-1.5 py-px text-[10px] font-medium border whitespace-nowrap ${
    active ? 'border-[color:var(--accent)] text-[color:var(--accent)]' : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)]'
  }`;
  return onClick ? (
    <button type="button" className={`${cls} hover:text-[color:var(--text-primary)]`} onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className={cls} style={{ background: `color-mix(in srgb, ${teamColor(color)} 10%, transparent)` }}>
      {body}
    </span>
  );
}

/* ─── Data hooks ─────────────────────────────────────────────────────────── */

const EMPTY_OPTIONS: ResourceOptions = { users: [], projects: [], demands: [], departments: [], settings: DEFAULT_SETTINGS };

export function useResourceOptions(token: string | null | undefined, workspaceKey = '') {
  const [options, setOptions] = useState<ResourceOptions>(EMPTY_OPTIONS);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!token) return;
    let stale = false;
    resourcesApi.options(token).then((res) => {
      if (!stale && res.success && res.data) setOptions({ ...EMPTY_OPTIONS, ...res.data, settings: { ...DEFAULT_SETTINGS, ...res.data.settings } });
    });
    return () => {
      stale = true;
    };
  }, [token, workspaceKey, tick]);
  return { options, reloadOptions: () => setTick((t) => t + 1) };
}

/* ─── Allocation editor ──────────────────────────────────────────────────── */

export interface AllocationDraft {
  id?: string;
  userId: string;
  projectId: string;
  percent: number;
  startDate: string;
  endDate: string;
  billable: boolean;
  softBooked: boolean;
  roleLabel: string;
  notes: string;
  demandId: string;
}

export function blankAllocation(overrides: Partial<AllocationDraft> = {}): AllocationDraft {
  return {
    userId: '',
    projectId: '',
    percent: 50,
    startDate: todayKey(),
    endDate: '',
    billable: true,
    softBooked: false,
    roleLabel: '',
    notes: '',
    demandId: '',
    ...overrides,
  };
}

export function draftFromAllocation(a: ResourceAllocation, copy = false): AllocationDraft {
  return {
    id: copy ? undefined : a._id,
    userId: refKey(a.userId as Ref),
    projectId: refKey(a.projectId as Ref),
    percent: a.percent,
    startDate: copy && a.endDate ? addDaysKey(toInputDate(a.endDate), 1) : toInputDate(a.startDate),
    endDate: copy ? '' : toInputDate(a.endDate),
    billable: a.billable,
    softBooked: a.softBooked,
    roleLabel: a.roleLabel ?? '',
    notes: a.notes ?? '',
    demandId: refKey(a.demandId as Ref),
  };
}

const LENGTHS: Array<{ label: string; days: number | null }> = [
  { label: '2 wks', days: 13 },
  { label: '1 mo', days: 29 },
  { label: '3 mo', days: 90 },
  { label: '6 mo', days: 181 },
  { label: 'Open-ended', days: null },
];

export function AllocationModal({
  open,
  draft,
  options,
  token,
  onClose,
  onSaved,
  lockUser = false,
}: {
  open: boolean;
  draft: AllocationDraft | null;
  options: ResourceOptions;
  token: string;
  onClose: () => void;
  onSaved: (message?: string) => void;
  lockUser?: boolean;
}) {
  const [form, setForm] = useState<AllocationDraft>(draft ?? blankAllocation());
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [check, setCheck] = useState<AllocationCheck | null>(null);
  const settings = options.settings;

  useEffect(() => {
    if (open) {
      setForm(draft ?? blankAllocation());
      setError('');
      setCheck(null);
    }
  }, [open, draft]);

  // Live load check while editing (debounced).
  useEffect(() => {
    if (!open || !form.userId || !form.startDate) {
      setCheck(null);
      return;
    }
    if (form.endDate && form.endDate < form.startDate) return;
    const t = window.setTimeout(() => {
      resourcesApi
        .checkAllocation(token, {
          userId: form.userId,
          startDate: form.startDate,
          endDate: form.endDate || undefined,
          percent: Number(form.percent) || undefined,
          softBooked: form.softBooked,
          excludeId: form.id,
        })
        .then((res) => res.success && res.data && setCheck(res.data));
    }, 300);
    return () => window.clearTimeout(t);
  }, [open, token, form.userId, form.startDate, form.endDate, form.percent, form.softBooked, form.id]);

  const set = <K extends keyof AllocationDraft>(k: K, v: AllocationDraft[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (form.endDate && form.endDate < form.startDate) {
      setError('End date must be on or after the start date.');
      return;
    }
    setSaving(true);
    const body = {
      userId: form.userId,
      projectId: form.projectId,
      percent: Number(form.percent),
      startDate: form.startDate,
      endDate: form.endDate || null,
      billable: form.billable,
      softBooked: form.softBooked,
      roleLabel: form.roleLabel,
      notes: form.notes,
      demandId: form.demandId || null,
    };
    const res = form.id ? await resourcesApi.updateAllocation(form.id, body, token) : await resourcesApi.createAllocation(body, token);
    setSaving(false);
    if (!res.success) {
      setError(errorOf(res, 'Failed to save allocation'));
      return;
    }
    const c = res.data?.conflicts;
    onSaved(
      c?.overAllocated
        ? `Saved — this person peaks at ${c.committedPercent}% committed (limit ${c.overAllocationPct}%).`
        : form.id
          ? 'Allocation updated.'
          : 'Allocation added.'
    );
  }

  const demandsForProject = options.demands.filter((d) => !d.projectId || !form.projectId || d.projectId === form.projectId);
  const person = options.users.find((u) => u.id === form.userId);
  const lengthDays = form.endDate ? diffDaysKey(form.startDate, form.endDate) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={form.id ? 'Edit allocation' : 'New allocation'}
      subtitle={person ? `${person.name}${person.department ? ` · ${person.department}` : ''}` : 'Book a person onto a project for a share of their week.'}
      width="max-w-2xl"
    >
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Person">
            <PersonSelect
              required
              disabled={lockUser && !!form.userId}
              value={form.userId}
              onChange={(v) => set('userId', v)}
              people={toPeople(options.users)}
              placeholder="Search person…"
              aria-label="Person"
            />
          </Field>
          <Field label="Project">
            <select required value={form.projectId} onChange={(e) => set('projectId', e.target.value)} className={inputCls}>
              <option value="">Select…</option>
              {options.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.key} · {p.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label={`Commitment — ${form.percent}% of week`}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={form.percent}
              onChange={(e) => set('percent', Number(e.target.value))}
              className="flex-1 accent-[color:var(--accent)]"
            />
            <input
              type="number"
              min={1}
              max={100}
              required
              value={form.percent}
              onChange={(e) => set('percent', Number(e.target.value))}
              className={`${inputCls} w-20`}
            />
          </div>
          <div className="flex gap-1 pt-1">
            {[25, 50, 75, 100].map((p) => (
              <button key={p} type="button" onClick={() => set('percent', p)} className={`px-2 py-0.5 rounded text-[11px] border ${form.percent === p ? 'border-[color:var(--accent)] text-[color:var(--accent)]' : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)]'}`}>
                {p}%
              </button>
            ))}
          </div>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Start">
            <input type="date" required value={form.startDate} onChange={(e) => set('startDate', e.target.value)} className={inputCls} />
          </Field>
          <Field label="End" hint={form.endDate ? `${(lengthDays ?? 0) + 1} days` : 'Open-ended'}>
            <input type="date" min={form.startDate} value={form.endDate} onChange={(e) => set('endDate', e.target.value)} className={inputCls} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-1 -mt-2">
          {LENGTHS.map((l) => (
            <button
              key={l.label}
              type="button"
              className="px-2 py-0.5 rounded text-[11px] border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
              onClick={() => set('endDate', l.days == null ? '' : addDaysKey(form.startDate || todayKey(), l.days))}
            >
              {l.label}
            </button>
          ))}
        </div>

        {check && (
          <div
            className={`rounded-xl border px-4 py-3 text-xs space-y-1 ${
              check.overAllocated
                ? 'border-red-500/40 bg-red-500/10'
                : check.softRisk
                  ? 'border-amber-500/40 bg-amber-500/10'
                  : 'border-emerald-500/30 bg-emerald-500/10'
            }`}
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                Already committed (peak): <b className="tabular-nums">{check.existingPeakPercent}%</b>
              </span>
              <span>
                With this booking: <b className="tabular-nums">{form.softBooked ? check.peakWithSoftPercent : check.committedPercent}%</b>
              </span>
              <span className="text-[color:var(--text-muted)]">Limit {check.overAllocationPct}%</span>
            </div>
            <LoadBar
              hard={check.committedPercent}
              soft={form.softBooked ? Math.max(0, check.peakWithSoftPercent - check.committedPercent) : 0}
              settings={settings}
            />
            {check.overAllocated && (
              <p className="text-red-400">
                Over-allocated{' '}
                {check.windows
                  .slice(0, 3)
                  .map((w) => `${fmtShort(w.start)}–${fmtShort(w.end)} (${w.peakPercent}%)`)
                  .join(', ')}
                . Headroom is {check.headroomPercent}%.
              </p>
            )}
            {!check.overAllocated && check.softRisk && <p className="text-amber-400">Fits as booked, but pending soft bookings would push this person over the limit.</p>}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Role on project">
            <input value={form.roleLabel} onChange={(e) => set('roleLabel', e.target.value)} className={inputCls} placeholder="e.g. Backend lead" />
          </Field>
          <Field label="Fulfils demand">
            <select value={form.demandId} onChange={(e) => set('demandId', e.target.value)} className={inputCls}>
              <option value="">None</option>
              {demandsForProject.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-5 text-xs">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.billable} onChange={(e) => set('billable', e.target.checked)} />
            Billable
          </label>
          <label className="flex items-center gap-2" title="Tentative booking — shown on plans but not counted as committed">
            <input type="checkbox" checked={form.softBooked} onChange={(e) => set('softBooked', e.target.checked)} />
            Soft booking (tentative)
          </label>
        </div>
        <Field label="Notes">
          <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={inputCls} />
        </Field>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving} className={`${btnPrimary} px-4 py-2`}>
            {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add allocation'}
          </button>
          <button type="button" className={`${btnSecondary} px-4 py-2`} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onDone, 5000);
    return () => window.clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return createPortal(
    <div className="fixed bottom-5 right-5 z-[60] max-w-sm rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] px-4 py-3 text-sm shadow-xl animate-fade-in">
      {message}
    </div>,
    document.body
  );
}
