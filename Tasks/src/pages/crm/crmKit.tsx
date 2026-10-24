import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FiEdit2, FiMoreHorizontal, FiTrash2 } from 'react-icons/fi';
import type { CrmDeal } from '../../lib/api';

/** Shared building blocks for CRM screens — generic layout comes from the resources kit. */
export {
  inputCls,
  btnPrimary,
  btnSecondary,
  Chip,
  EmptyState,
  ErrorBanner,
  Field,
  LoadingBlock,
  Modal,
  Segmented,
  Stat,
  errorOf,
} from '../resources/resourceKit';
import { PageShell } from '../resources/resourceKit';

export function CrmShell(props: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return <PageShell eyebrow="CRM" {...props} />;
}

export const btnDanger =
  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/40 text-sm text-red-400 hover:bg-red-500/10 transition disabled:opacity-50';

const moneyCache = new Map<string, { full: Intl.NumberFormat; compact: Intl.NumberFormat }>();

function formatters(currency = 'USD') {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  let f = moneyCache.get(code);
  if (!f) {
    f = {
      full: new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 0 }),
      compact: new Intl.NumberFormat(undefined, { style: 'currency', currency: code, notation: 'compact', maximumFractionDigits: 1 }),
    };
    moneyCache.set(code, f);
  }
  return f;
}

export const money = (n: number | undefined, currency?: string) => formatters(currency).full.format(n || 0);
export const moneyShort = (n: number | undefined, currency?: string) => formatters(currency).compact.format(n || 0);

export function fmtDate(v?: string | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return v ? new Date(v).toLocaleDateString(undefined, opts) : '—';
}

/** yyyy-mm-dd for <input type="date">. */
export const toDateInput = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '');

/** Local yyyy-mm-ddThh:mm for <input type="datetime-local">. */
export function toDateTimeInput(v?: string | null) {
  if (!v) return '';
  const d = new Date(v);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export const daysUntil = (v?: string | null) => (v ? Math.round((new Date(v).getTime() - Date.now()) / 86_400_000) : null);

export const prettyLabel = (s?: string | null) => (s ? s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '—');

/** Name of a populated ref (`{ name }` / `{ title }`) or empty when it is only an id. */
export function refName(ref: unknown): string {
  if (!ref || typeof ref !== 'object') return '';
  const r = ref as { name?: string; title?: string; email?: string };
  return r.name || r.title || r.email || '';
}

export function refId(ref: unknown): string {
  if (!ref) return '';
  if (typeof ref === 'string') return ref;
  return String((ref as { _id?: string })._id ?? '');
}

export const DEAL_STATUS_TONE: Record<string, 'accent' | 'good' | 'bad'> = { open: 'accent', won: 'good', lost: 'bad' };

export function dealOrgName(deal: Pick<CrmDeal, 'customerOrgId' | 'accountId'>) {
  return refName(deal.customerOrgId) || refName(deal.accountId) || '—';
}

/** Compact ⋯ menu with Edit / Delete (and any extra items). */
export function RowMenu({
  onEdit,
  onDelete,
  extra = [],
  label = 'Actions',
}: {
  onEdit?: () => void;
  onDelete?: () => void;
  extra?: Array<{ label: string; icon?: ReactNode; onClick: () => void }>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const items = [
    ...(onEdit ? [{ label: 'Edit', icon: <FiEdit2 />, onClick: onEdit, danger: false }] : []),
    ...extra.map((x) => ({ ...x, danger: false })),
    ...(onDelete ? [{ label: 'Delete', icon: <FiTrash2 />, onClick: onDelete, danger: true }] : []),
  ];
  if (!items.length) return null;
  return (
    <div ref={ref} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className="p-1.5 rounded-md text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)]"
      >
        <FiMoreHorizontal />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 min-w-[150px] rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-modal)] shadow-xl py-1 animate-scale-in">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.preventDefault();
                setOpen(false);
                it.onClick();
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-[color:var(--bg-elevated)] ${
                it.danger ? 'text-red-400' : ''
              }`}
            >
              <span className="opacity-70">{it.icon}</span>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Small inline toast-style notice for errors from save/delete. */
export function Notice({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-400 flex items-center justify-between gap-3">
      <span>{message}</span>
      <button type="button" className="text-xs underline" onClick={onClose}>
        Dismiss
      </button>
    </div>
  );
}
