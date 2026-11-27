import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FiCheck, FiGift, FiX } from 'react-icons/fi';
import { useAuth } from '../contexts/AuthContext';
import { updatesApi, type AppUpdateItem, type AppUpdateType } from '../lib/api';

const TYPE_BADGE_STYLES: Record<AppUpdateType, { label: string; className: string }> = {
  feature: {
    label: 'Feature',
    className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  improvement: {
    label: 'Improvement',
    className: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  },
  fix: {
    label: 'Fix',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  security: {
    label: 'Security',
    className: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
  },
  other: {
    label: 'Update',
    className: 'bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)] border-[color:var(--border-subtle)]',
  },
};

function splitUpdateDetails(details: string): string[] {
  return details
    .split(/\s+;\s+/)
    .map((point) => point.trim())
    .filter(Boolean);
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');
  return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute('aria-hidden')
  );
}

export interface WhatsNewModalProps {
  open: boolean;
  updates: AppUpdateItem[];
  onDismiss: () => void;
  dismissing?: boolean;
}

export function WhatsNewModal({
  open,
  updates,
  onDismiss,
  dismissing = false,
}: WhatsNewModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const gotItButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const raf = window.requestAnimationFrame(() => {
      if (gotItButtonRef.current) {
        gotItButtonRef.current.focus();
      } else {
        dialogRef.current?.focus();
      }
    });
    return () => {
      window.cancelAnimationFrame(raf);
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
        return;
      }

      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = getFocusableElements(dialogRef.current);
        if (focusable.length === 0) {
          event.preventDefault();
          dialogRef.current.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (event.shiftKey) {
          if (!active || active === first || !dialogRef.current.contains(active)) {
            event.preventDefault();
            last.focus();
          }
        } else if (!active || active === last || !dialogRef.current.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onDismiss]);

  if (!open || updates.length === 0 || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4"
      onClick={onDismiss}
      data-testid="whats-new-overlay"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        aria-describedby="whats-new-subtitle"
        tabIndex={-1}
        className="w-full max-w-4xl max-h-[85vh] flex flex-col bg-[color:var(--bg-modal)] border border-[color:var(--border-subtle)] rounded-xl card-shadow shadow-xl animate-scale-in outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--border-subtle)] px-6 py-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent-subtle)] text-[color:var(--accent)]"
              aria-hidden
            >
              <FiGift className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 id="whats-new-title" className="text-base font-bold text-[color:var(--text-primary)]">
                What&apos;s New
              </h2>
              <p id="whats-new-subtitle" className="text-xs text-[color:var(--text-muted)]">
                Recent features, improvements, and fixes in your workspace
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            disabled={dismissing}
            aria-label="Close What's New"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/50"
          >
            <FiX className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-3">
          {updates.map((item) => {
            const badge = TYPE_BADGE_STYLES[item.type] ?? TYPE_BADGE_STYLES.other;
            const points = splitUpdateDetails(item.details);

            return (
              <article
                key={item.updateId}
                className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                    <span className="text-[11px] font-mono text-[color:var(--text-subtle)]">
                      {item.updateId}
                    </span>
                  </div>
                  <time
                    dateTime={item.date}
                    className="text-xs text-[color:var(--text-muted)] tabular-nums"
                  >
                    {item.date}
                  </time>
                </div>

                <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">
                  {item.title}
                </h3>

                {points.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 space-y-1 text-[13px] leading-relaxed text-[color:var(--text-muted)]">
                    {points.map((point, idx) => (
                      <li key={idx}>{point}</li>
                    ))}
                  </ul>
                )}
              </article>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[color:var(--border-subtle)] px-6 py-4 shrink-0">
          <span className="text-xs text-[color:var(--text-muted)]">
            {updates.length} {updates.length === 1 ? 'update' : 'updates'}
          </span>
          <button
            ref={gotItButtonRef}
            type="button"
            onClick={onDismiss}
            disabled={dismissing}
            className="btn-primary inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--btn-primary-ring)]"
          >
            <FiCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {dismissing ? 'Closing…' : 'Got it'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Fetches unseen updates once per login session for staff users and renders WhatsNewModal. */
export function WhatsNewChecker() {
  const { token, user, loading } = useAuth();
  const [updates, setUpdates] = useState<AppUpdateItem[]>([]);
  const [open, setOpen] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const checkedUserIdRef = useRef<string | null>(null);
  const dismissingRef = useRef(false);

  useEffect(() => {
    if (loading) return;

    if (!token || !user) {
      checkedUserIdRef.current = null;
      setUpdates([]);
      setOpen(false);
      return;
    }

    if (user.userType === 'customer' || user.mustSetupTwoFactor) {
      return;
    }

    if (checkedUserIdRef.current === user.id) {
      return;
    }

    checkedUserIdRef.current = user.id;
    let cancelled = false;

    updatesApi
      .getUnseen(token)
      .then((res) => {
        if (cancelled) return;
        if (res.success && Array.isArray(res.data) && res.data.length > 0) {
          setUpdates(res.data);
          setOpen(true);
        } else if (!res.success) {
          console.error('[WhatsNew] Failed to fetch unseen updates:', res.message);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[WhatsNew] Failed to fetch unseen updates:', err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [loading, token, user]);

  const handleDismiss = useCallback(async () => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    setDismissing(true);

    const updateIds = updates.map((u) => u.updateId);
    try {
      if (token && updateIds.length > 0) {
        const res = await updatesApi.acknowledge(updateIds, token);
        if (!res.success) {
          console.error('[WhatsNew] Failed to acknowledge updates:', res.message);
        }
      }
    } catch (err) {
      console.error('[WhatsNew] Failed to acknowledge updates:', err);
    } finally {
      dismissingRef.current = false;
      setDismissing(false);
      setOpen(false);
      setUpdates([]);
    }
  }, [token, updates]);

  return (
    <WhatsNewModal
      open={open}
      updates={updates}
      onDismiss={() => void handleDismiss()}
      dismissing={dismissing}
    />
  );
}
