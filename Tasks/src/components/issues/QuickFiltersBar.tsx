import { useState, useRef, useEffect } from 'react';
import { FiBookmark, FiChevronDown, FiEye, FiGrid, FiUser, FiX } from 'react-icons/fi';
import type { FiltersShape, QuickFilterValue } from './constants';

export interface SavedFilter {
  id: string;
  name: string;
  filters: Partial<FiltersShape> & Pick<FiltersShape, 'status' | 'assignee' | 'reporter' | 'type' | 'priority' | 'labels' | 'storyPoints'>;
  quickFilter: QuickFilterValue;
  jql?: string;
  viewMode?: 'list' | 'table' | 'kanban';
}

interface QuickFiltersBarProps {
  quickFilter: QuickFilterValue;
  updateUrl: (updates: { quickFilter?: QuickFilterValue; page?: number }) => void;
  savedFilters: SavedFilter[];
  savedFiltersLoading: boolean;
  savedFiltersError: string | null;
  applySavedFilter: (sf: SavedFilter) => void;
  removeSavedFilter: (id: string) => void;
  onSavedEmptyClick?: () => void;
  totalCounts: { my: number; open: number; all: number } | null;
  hideQuickTabs?: boolean;
}

export function QuickFiltersBar({
  quickFilter,
  updateUrl,
  savedFilters,
  savedFiltersLoading,
  savedFiltersError,
  applySavedFilter,
  removeSavedFilter,
  onSavedEmptyClick,
  totalCounts,
  hideQuickTabs = false,
}: QuickFiltersBarProps) {
  const [savedDropdownOpen, setSavedDropdownOpen] = useState(false);
  const savedDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!savedDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (savedDropdownRef.current && !savedDropdownRef.current.contains(e.target as Node)) {
        setSavedDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [savedDropdownOpen]);

  const VISIBLE_SAVED = 5;
  const visibleSaved = savedFilters.slice(0, VISIBLE_SAVED);
  const overflowSaved = savedFilters.slice(VISIBLE_SAVED);

  const tabs = [
    { key: 'my' as QuickFilterValue, label: 'My Open', Icon: FiUser, count: totalCounts?.my },
    { key: 'open' as QuickFilterValue, label: 'Open', Icon: FiEye, count: totalCounts?.open },
    { key: 'all' as QuickFilterValue, label: 'All', Icon: FiGrid, count: totalCounts?.all },
  ];

  const hasSavedContent = Boolean(savedFiltersError || savedFiltersLoading || savedFilters.length > 0);

  // With the scope tabs living in the page header, an empty saved-filter strip is just noise.
  if (hideQuickTabs && !hasSavedContent) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pb-2.5">

      {/* Quick filter tabs */}
      {!hideQuickTabs && (
        <div className="flex items-center gap-1">
          {tabs.map(({ key, label, Icon, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => updateUrl({ quickFilter: key, page: 1 })}
              className={`group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                quickFilter === key
                  ? 'bg-[color:var(--accent)] text-white border-[color:var(--accent)] shadow-sm'
                  : 'bg-transparent border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] hover:border-[color:var(--border-subtle)]'
              }`}
            >
              <Icon className="h-3 w-3 shrink-0" aria-hidden />
              {label}
              {count !== undefined && (
                <span className={`inline-flex items-center justify-center px-1.5 min-w-[1.2rem] h-5 rounded-full text-[10px] font-bold transition-colors ${
                  quickFilter === key
                    ? 'bg-white/25 text-white'
                    : 'bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)] group-hover:bg-[color:var(--bg-page)]'
                }`}>
                  {count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Divider */}
      {!hideQuickTabs && hasSavedContent && (
        <div className="h-4 w-px bg-[color:var(--border-subtle)] shrink-0" />
      )}

      {/* Saved filters */}
      {savedFiltersError && (
        <span className="text-xs text-red-500 shrink-0">{savedFiltersError}</span>
      )}

      {savedFiltersLoading ? (
        <span className="text-xs text-[color:var(--text-muted)] animate-pulse">Loading…</span>
      ) : savedFilters.length > 0 ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-semibold text-[color:var(--text-muted)] uppercase tracking-wider shrink-0 flex items-center gap-1">
            <FiBookmark className="h-3 w-3" aria-hidden />
            Saved views
          </span>

          {visibleSaved.map((sf) => (
            <span
              key={sf.id}
              className="group inline-flex h-7 items-center gap-0.5 rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] pl-3 pr-1 text-[12px] text-[color:var(--text-primary)] transition-all hover:border-[color:var(--accent)]/50 hover:bg-[color:var(--accent-subtle)]"
            >
              <button
                type="button"
                onClick={() => applySavedFilter(sf)}
                className="max-w-[140px] truncate text-left font-medium"
                title={sf.name}
              >
                {sf.name}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); removeSavedFilter(sf.id); }}
                className="ml-0.5 p-0.5 rounded text-[color:var(--text-muted)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                aria-label={`Remove ${sf.name}`}
              >
                <FiX className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}

          {overflowSaved.length > 0 && (
            <div className="relative" ref={savedDropdownRef}>
              <button
                type="button"
                onClick={() => setSavedDropdownOpen((o) => !o)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:border-[color:var(--border-emphasis)] transition"
              >
                +{overflowSaved.length} more
                <FiChevronDown className={`h-3 w-3 transition-transform ${savedDropdownOpen ? '-rotate-180' : ''}`} aria-hidden />
              </button>
              {savedDropdownOpen && (
                <div className="absolute left-0 top-full z-30 mt-1 py-1 min-w-[160px] rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-xl max-h-52 overflow-y-auto">
                  {overflowSaved.map((sf) => (
                    <div key={sf.id} className="group/item flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-[color:var(--bg-page)] transition">
                      <button
                        type="button"
                        onClick={() => { applySavedFilter(sf); setSavedDropdownOpen(false); }}
                        className="flex-1 text-left text-xs text-[color:var(--text-primary)] font-medium truncate"
                      >
                        {sf.name}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removeSavedFilter(sf.id); }}
                        className="p-0.5 rounded text-[color:var(--text-muted)] hover:text-red-500 opacity-0 group-hover/item:opacity-100 transition"
                        aria-label={`Remove ${sf.name}`}
                      >
                        <FiX className="h-3 w-3" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : hideQuickTabs ? null : (
        <button
          type="button"
          onClick={onSavedEmptyClick}
          className="inline-flex items-center gap-1.5 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:underline transition"
        >
          <FiBookmark className="h-3 w-3" aria-hidden />
          Save current view as filter
        </button>
      )}
    </div>
  );
}
