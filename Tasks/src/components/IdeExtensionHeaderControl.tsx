import { useState } from 'react';
import { DownloadIcon, IdeExtensionIcon } from './icons/NavigationIcons';

/** Stable public URL for the packaged VSIX (copied into Tasks/public/downloads/). */
export const ATRIUM_WORKBENCH_VSIX_URL = '/downloads/atrium-workbench.vsix';
export const ATRIUM_WORKBENCH_VERSION_LABEL = '0.1.9';

type Variant = 'hub' | 'app';

/**
 * Header control: open instructions + download Atrium Workbench (Cursor / VS Code).
 */
export default function IdeExtensionHeaderControl({ variant = 'hub' }: { variant?: Variant }) {
  const [open, setOpen] = useState(false);

  const triggerClass =
    variant === 'hub'
      ? 'hub-icon-btn'
      : 'inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-surface)] hover:text-[color:var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40 focus:ring-offset-0 transition';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={triggerClass}
        title="IDE extension — download & install"
        aria-label="IDE extension download and instructions"
        aria-expanded={open}
      >
        <IdeExtensionIcon className="h-4 w-4" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="absolute right-0 z-20 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-[0_8px_24px_rgba(0,0,0,0.24)]"
            role="dialog"
            aria-label="Atrium Workbench extension"
          >
            <div className="border-b border-[color:var(--border-subtle)] px-4 py-3">
              <div className="text-xs font-semibold text-[color:var(--text-primary)]">Atrium Workbench</div>
              <p className="mt-0.5 text-[11px] text-[color:var(--text-muted)]">
                Cursor / VS Code extension · v{ATRIUM_WORKBENCH_VERSION_LABEL}
              </p>
            </div>

            <div className="space-y-3 px-4 py-3 text-[12px] leading-relaxed text-[color:var(--text-primary)]">
              <p className="text-[color:var(--text-muted)]">
                Browse your issues in the IDE, update status, and <strong className="font-semibold text-[color:var(--text-primary)]">Do</strong> them
                with Cursor or Claude — with screenshots as context.
              </p>

              <ol className="list-decimal space-y-1.5 pl-4 text-[color:var(--text-muted)]">
                <li>
                  Download the <code className="rounded bg-[color:var(--bg-surface)] px-1 text-[11px]">.vsix</code> below.
                </li>
                <li>
                  In Cursor or VS Code: <strong className="font-medium text-[color:var(--text-primary)]">Extensions</strong> →{' '}
                  <strong className="font-medium text-[color:var(--text-primary)]">⋯</strong> →{' '}
                  <strong className="font-medium text-[color:var(--text-primary)]">Install from VSIX…</strong>
                </li>
                <li>Reload the window when prompted.</li>
                <li>
                  Open the <strong className="font-medium text-[color:var(--text-primary)]">Atrium</strong> sidebar → Get Started →
                  set your API URL (this server) → sign in.
                </li>
                <li>Pick the project for your folder, then use <strong className="font-medium text-[color:var(--text-primary)]">Do</strong> on an issue.</li>
              </ol>

              <a
                href={ATRIUM_WORKBENCH_VSIX_URL}
                download={`atrium-workbench-${ATRIUM_WORKBENCH_VERSION_LABEL}.vsix`}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[color:var(--accent)] px-3 py-2 text-[12px] font-semibold text-white hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                onClick={() => setOpen(false)}
              >
                <DownloadIcon className="h-4 w-4" />
                Download extension (.vsix)
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
