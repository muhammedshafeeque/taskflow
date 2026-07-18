import { useEffect } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { downloadCsv, type CsvColumn } from '../lib/exportCsv';

/** Currency formatter shared across the business modules. */
export function money(n: number | undefined, currency = 'USD'): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function EmptyChart({ label }: { label: string }) {
  return <div className="h-64 flex items-center justify-center text-sm text-[color:var(--text-muted)]">{label}</div>;
}

export function LoadingCard({ label }: { label: string }) {
  return (
    <div className="p-8 w-full px-4 sm:px-6 lg:px-8">
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-10 text-center text-[color:var(--text-muted)] animate-pulse">
        {label}
      </div>
    </div>
  );
}

type HeaderAction = { to?: string; label: string; onClick?: () => void; primary?: boolean };

export function ModuleHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  accent = 'var(--accent)',
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: HeaderAction[];
  accent?: string;
}) {
  return (
    <header className="relative overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-6 py-5 sm:px-8">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 70% 110% at 0% 0%, color-mix(in srgb, ${accent} 14%, transparent), transparent 50%), radial-gradient(ellipse 60% 90% at 100% 100%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 45%)`,
        }}
      />
      <div className="relative flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--accent)]">{eyebrow}</p>
          <h1 className="text-2xl font-bold tracking-tight mt-1">{title}</h1>
          {subtitle && <p className="text-[13px] text-[color:var(--text-muted)] mt-1 max-w-xl">{subtitle}</p>}
        </div>
        {actions && actions.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {actions.map((a) =>
              a.to ? (
                <Link
                  key={a.label}
                  to={a.to}
                  className={
                    a.primary
                      ? 'btn-primary btn-primary-sm px-3 py-1.5 rounded-lg'
                      : 'px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/40 transition'
                  }
                >
                  {a.label}
                </Link>
              ) : (
                <button
                  key={a.label}
                  onClick={a.onClick}
                  className={
                    a.primary
                      ? 'btn-primary btn-primary-sm px-3 py-1.5 rounded-lg'
                      : 'px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]/40 transition'
                  }
                >
                  {a.label}
                </button>
              )
            )}
          </div>
        )}
      </div>
    </header>
  );
}

const STATUS_TONES: Record<string, string> = {
  green: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  red: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  blue: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  slate: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  violet: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
};

export function StatusPill({ label, tone = 'slate' }: { label: string; tone?: keyof typeof STATUS_TONES }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_TONES[tone] ?? STATUS_TONES.slate}`}>
      {label.replace(/_/g, ' ')}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8" onClick={onClose}>
      <div
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] shadow-xl animate-fade-in`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] px-5 py-3.5">
          <h2 className="text-sm font-bold">{title}</h2>
          <button onClick={onClose} className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]">✕</button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4 space-y-3">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-[color:var(--border-subtle)] px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-3 py-2 text-sm outline-none focus:border-[color:var(--accent)] transition';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function PrimaryButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`btn-primary btn-primary-sm px-4 py-2 rounded-lg text-sm disabled:opacity-50 ${props.className ?? ''}`}>
      {children}
    </button>
  );
}

/** One-click CSV export of the currently loaded rows. */
export function ExportButton<T>({
  rows,
  columns,
  filename,
  label = 'Export CSV',
}: {
  rows: T[];
  columns: CsvColumn<T>[];
  filename: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      disabled={rows.length === 0}
      onClick={() => downloadCsv(filename, rows, columns)}
      title={rows.length === 0 ? 'Nothing to export' : `Export ${rows.length} rows`}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm hover:border-[color:var(--accent)]/40 transition disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {label}
    </button>
  );
}

export function GhostButton({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`px-3 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm hover:border-[color:var(--accent)]/40 transition ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

/** Standard scaffold for a module section: header + filters + table area. */
export function SectionPage({
  title,
  subtitle,
  toolbar,
  children,
}: {
  title: string;
  subtitle?: string;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-[13px] text-[color:var(--text-muted)] mt-0.5 max-w-2xl">{subtitle}</p>}
        </div>
        {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
      </div>
      {children}
    </div>
  );
}

export function idOf(v: string | { _id: string } | undefined | null): string | undefined {
  if (!v) return undefined;
  return typeof v === 'string' ? v : v._id;
}

export function nameOf(v: string | { name?: string } | undefined | null, fallback = '—'): string {
  if (!v) return fallback;
  return typeof v === 'string' ? fallback : v.name ?? fallback;
}
