import { useState, useRef, useEffect } from 'react';
import type { QuickFilterValue } from './constants';

export interface SavedFilter {
  id: string;
  name: string;
  filters: {
    project?: string[];
    status: string[];
    assignee: string[];
    reporter: string[];
    type: string[];
    priority: string[];
    labels: string[];
    storyPoints: string[];
    hasStoryPoints?: boolean;
  };
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
  /** When there are no saved filters, clicking "Saved" can open the filter modal or save dialog. */
  onSavedEmptyClick?: () => void;
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
}: QuickFiltersBarProps) {
  const [savedDropdownOpen, setSavedDropdownOpen] = useState(false);
  const savedDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!savedDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (savedDropdownRef.current && !savedDropdownRef.current.contains(e.target as Node)) {
        setSavedDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [savedDropdownOpen]);

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4 py-3 border-b border-[color:var(--border-subtle)]">
      <span className="text-[11px] font-semibold text-[color:var(--text-muted)] uppercase tracking-wider">Quick filters</span>
      <div className="flex rounded-lg border border-[color:var(--border-subtle)] overflow-hidden bg-[color:var(--bg-surface)]">
        <button
          type="button"
          onClick={() => updateUrl({ quickFilter: 'my', page: 1 })}
          className={`px-3 py-1.5 text-xs transition ${
            quickFilter === 'my'
              ? 'bg-[color:var(--bg-page)] text-[color:var(--text-primary)]'
              : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]'
          }`}
        >
          My open issues
        </button>
        <button
          type="button"
          onClick={() => updateUrl({ quickFilter: 'open', page: 1 })}
          className={`px-3 py-1.5 text-xs transition ${
            quickFilter === 'open'
              ? 'bg-[color:var(--bg-page)] text-[color:var(--text-primary)]'
              : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]'
          }`}
        >
          Open issues
        </button>
        <button
          type="button"
          onClick={() => updateUrl({ quickFilter: 'all', page: 1 })}
          className={`px-3 py-1.5 text-xs transition ${
            quickFilter === 'all'
              ? 'bg-[color:var(--bg-page)] text-[color:var(--text-primary)]'
              : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)]'
          }`}
        >
          All issues
        </button>
      </div>

      <span className="text-[11px] font-semibold text-[color:var(--text-muted)] uppercase tracking-wider shrink-0 ml-1">Saved</span>
      {savedFiltersError && (
        <span className="text-xs text-red-500">{savedFiltersError}</span>
      )}
      {savedFiltersLoading ? (
        <span className="text-xs text-[color:var(--text-muted)]">Loading…</span>
      ) : savedFilters.length > 0 ? (
        <div className="relative" ref={savedDropdownRef}>
          <button
            type="button"
            onClick={() => setSavedDropdownOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] text-xs hover:bg-[color:var(--bg-page)]"
          >
            Saved ({savedFilters.length}) <span className="text-[10px]">{savedDropdownOpen ? '▲' : '▼'}</span>
          </button>
          {savedDropdownOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 py-1 min-w-[180px] rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-xl max-h-64 overflow-y-auto">
              {savedFilters.map((sf) => (
                <div
                  key={sf.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-[color:var(--bg-page)] group"
                >
                  <button
                    type="button"
                    onClick={() => {
                      applySavedFilter(sf);
                      setSavedDropdownOpen(false);
                    }}
                    className="flex-1 text-left text-xs text-[color:var(--text-primary)] font-medium truncate"
                  >
                    {sf.name}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSavedFilter(sf.id);
                    }}
                    className="text-[color:var(--text-muted)] hover:text-red-500 text-sm leading-none opacity-0 group-hover:opacity-100 transition"
                    aria-label={`Remove ${sf.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={onSavedEmptyClick}
          className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] underline"
        >
          No saved filters — open Filter to save current view
        </button>
      )}
    </div>
  );
}
