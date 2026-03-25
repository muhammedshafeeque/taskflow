import { useCallback, useEffect, useRef, type ReactNode } from 'react';

interface KanbanScrollAreaProps {
  children: ReactNode;
  className?: string;
}

/**
 * Horizontal board scroll with a synced scrollbar above the columns so panning
 * is not visually tied to a bar under the column stack.
 */
export function KanbanScrollArea({ children, className = '' }: KanbanScrollAreaProps) {
  const mainRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  const syncSpacerWidth = useCallback(() => {
    const main = mainRef.current;
    const spacer = spacerRef.current;
    if (!main || !spacer) return;
    spacer.style.width = `${main.scrollWidth}px`;
  }, []);

  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;

    const ro = new ResizeObserver(() => {
      syncSpacerWidth();
    });
    ro.observe(main);

    const mo = new MutationObserver(() => {
      syncSpacerWidth();
    });
    mo.observe(main, { childList: true, subtree: true, attributes: true });

    syncSpacerWidth();
    window.addEventListener('resize', syncSpacerWidth);

    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', syncSpacerWidth);
    };
  }, [syncSpacerWidth]);

  function onTopScroll() {
    if (syncing.current) return;
    const main = mainRef.current;
    const top = topRef.current;
    if (!main || !top) return;
    syncing.current = true;
    main.scrollLeft = top.scrollLeft;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }

  function onMainScroll() {
    if (syncing.current) return;
    const main = mainRef.current;
    const top = topRef.current;
    if (!main || !top) return;
    syncing.current = true;
    top.scrollLeft = main.scrollLeft;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div
        ref={topRef}
        onScroll={onTopScroll}
        className="kanban-scroll-top overflow-x-auto overflow-y-hidden rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]/80 py-1 px-0.5"
        role="scrollbar"
        aria-orientation="horizontal"
        aria-label="Scroll board horizontally"
      >
        <div ref={spacerRef} className="h-2 shrink-0" aria-hidden />
      </div>
      <div
        ref={mainRef}
        onScroll={onMainScroll}
        className="kanban-scroll-main flex gap-4 overflow-x-auto pb-2 -mx-1"
      >
        {children}
      </div>
    </div>
  );
}
