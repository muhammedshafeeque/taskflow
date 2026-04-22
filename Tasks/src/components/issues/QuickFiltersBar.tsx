import { useState, useRef, useEffect } from 'react';
import { FiBookmark, FiChevronDown, FiEye, FiGrid, FiUser, FiX } from 'react-icons/fi';
import type { QuickFilterValue } from './constants';

const qfIcon = 'h-3.5 w-3.5 shrink-0';

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
  totalCounts: { my: number; open: number; all: number } | null;
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
      <div className="flex rounded-md border border-[color:var(--border-subtle)] overflow-hidden bg-[color:var(--bg-page)]">
        <button
          type="button"
          onClick={() => updateUrl({ quickFilter: 'my', page: 1 })}
          className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium transition ${
            quickFilter === 'my'
              ? 'bg-[color:var(--accent)] text-white'
              : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]'
          }`}
        >
          <FiUser className={qfIcon} aria-hidden />
          My open issues {totalCounts && <span className={'ml-0.5 ' + (quickFilter === 'my' ? 'opacity-80' : 'opacity-60')}>({totalCounts.my})</span>}
        </button>
        <button
          type="button"
          onClick={() => updateUrl({ quickFilter: 'open', page: 1 })}
          className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium transition ${
            quickFilter === 'open'
              ? 'bg-[color:var(--accent)] text-white'
              : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]'
          }`}
        >
          <FiEye className={qfIcon} aria-hidden />
          Open issues {totalCounts && <span className={'ml-0.5 ' + (quickFilter === 'open' ? 'opacity-80' : 'opacity-60')}>({totalCounts.open})</span>}
        </button>
        <button
          type="button"
          onClick={() => updateUrl({ quickFilter: 'all', page: 1 })}
          className={`inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium transition ${
            quickFilter === 'all'
              ? 'bg-[color:var(--accent)] text-white'
              : 'text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]'
          }`}
        >
          <FiGrid className={qfIcon} aria-hidden />
          All issues {totalCounts && <span className={'ml-0.5 ' + (quickFilter === 'all' ? 'opacity-80' : 'opacity-60')}>({totalCounts.all})</span>}
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
            <FiBookmark className={qfIcon} aria-hidden />
            Saved ({savedFilters.length})
            <FiChevronDown className={`${qfIcon} transition ${savedDropdownOpen ? '-rotate-180' : ''}`} aria-hidden />
          </button>
          {savedDropdownOpen && (
            <div className="absolute left-0 top-full z-20 mt-1 py-1 min-w-[180px] rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-[0_8px_24px_rgba(0,0,0,0.2)] max-h-64 overflow-y-auto">
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
                    className="inline-flex items-center justify-center p-0.5 rounded text-[color:var(--text-muted)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition"
                    aria-label={`Remove ${sf.name}`}
                  >
                    <FiX className="h-3.5 w-3.5" aria-hidden />
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
