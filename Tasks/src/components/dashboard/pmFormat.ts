import { useEffect, useRef } from 'react';
import type { ProjectHealth } from '../../lib/api';

/** Shared formatting and constants for the PM and project dashboards. */

export const SERIES = { created: '#4f46e5', completed: '#0ea5e9' };

export function fmtDate(key: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) {
  if (!key) return '—';
  return new Date(`${key.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', ...opts });
}

export function daysLabel(n: number | null): string {
  if (n == null) return 'no date';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n > 0) return `in ${n} days`;
  return `${-n} days late`;
}

export function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : fmtDate(iso);
}

export function issueLink(i: { id: string; key?: string; project: { id: string } } | { id: string; key?: string; projectId: string }) {
  const pid = 'project' in i ? i.project.id : i.projectId;
  return `/projects/${pid}/issues/${encodeURIComponent(i.key ?? i.id)}`;
}

export function initials(name?: string) {
  return (name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('');
}

export const HEALTH: Record<ProjectHealth, { label: string; cls: string; dot: string; hint: string }> = {
  on_track: { label: 'On track', cls: 'bg-emerald-500/15 text-emerald-500', dot: '#10b981', hint: 'Nothing overdue and work completed in the last 14 days' },
  at_risk: { label: 'At risk', cls: 'bg-amber-500/15 text-amber-500', dot: '#f59e0b', hint: 'Something is overdue, or nothing was completed in 14 days' },
  off_track: { label: 'Off track', cls: 'bg-red-500/15 text-red-500', dot: '#ef4444', hint: 'Over 25% of dated open work is overdue, or a milestone is late' },
  idle: { label: 'Idle', cls: 'bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)]', dot: 'var(--text-muted)', hint: 'No open work' },
};

/** Short descriptions for the workspace menu; unknown routes just show their label. */

export function addDays(key: string, n: number) {
  return new Date(new Date(`${key}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
}

export const STATUS_FALLBACK = ['#94a3b8', '#64748b', '#818cf8', '#6366f1', '#a78bfa'];

export function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}
