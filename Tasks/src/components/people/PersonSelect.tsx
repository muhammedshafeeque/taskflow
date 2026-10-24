/**
 * Autocomplete pickers for choosing people (users, employees, members).
 *
 * Every "pick a person" control in the app goes through these so they all
 * search the same way: type part of a name or email, arrow keys to move,
 * Enter to pick, Esc to close. The dropdown is portalled so it is never
 * clipped by modals or scroll containers.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { FiCheck, FiChevronDown, FiSearch, FiX } from 'react-icons/fi';

import type { PersonOption, SpecialOption } from './people';

export type { PersonOption, SpecialOption };

const PALETTE = ['#388bfd', '#3fb950', '#d29922', '#bc8cff', '#f85149', '#e8912d', '#58b9de', '#79c0ff'];

function colorFor(name: string) {
  let h = 0;
  for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function PersonAvatar({ name, avatarUrl, size = 22 }: { name: string; avatarUrl?: string; size?: number }) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  const initials = name
    .split(' ')
    .filter(Boolean)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4, backgroundColor: colorFor(name) }}
      aria-hidden
    >
      {initials || '?'}
    </span>
  );
}

type Row =
  | { kind: 'special'; value: string; label: string; hint?: string }
  | { kind: 'person'; value: string; person: PersonOption };

function matches(q: string, ...parts: (string | undefined)[]) {
  return parts.some((p) => p?.toLowerCase().includes(q));
}

function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-[color:var(--accent)]/25 text-inherit">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

/** Shared dropdown + keyboard handling for both single and multi pickers. */
function usePicker(rows: Row[]) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const q = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      q
        ? rows.filter((r) => (r.kind === 'special' ? matches(q, r.label, r.hint) : matches(q, r.person.name, r.person.hint)))
        : rows,
    [rows, q]
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, onPick: (row: Row) => void) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (filtered.length ? (i + d + filtered.length) % filtered.length : 0));
    } else if (e.key === 'Enter') {
      if (open && filtered[active]) {
        e.preventDefault();
        onPick(filtered[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    } else if (e.key === 'Tab') {
      close();
    }
  };

  return { open, setOpen, query, setQuery, q, active, setActive, filtered, close, onKeyDown };
}

/** Positions the portalled list under (or above, when short on room) the anchor. */
function useAnchoredPosition(anchor: React.RefObject<HTMLElement | null>, open: boolean) {
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const el = anchor.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 8;
      const above = r.top - 8;
      const width = Math.max(r.width, 240);
      const left = Math.min(r.left, window.innerWidth - width - 8);
      if (below < 220 && above > below) setPos({ left, width, bottom: window.innerHeight - r.top + 4, maxHeight: Math.min(320, above) });
      else setPos({ left, width, top: r.bottom + 4, maxHeight: Math.min(320, below) });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchor, open]);
  return pos;
}

function useOutsideClose(refs: React.RefObject<HTMLElement | null>[], open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (refs.some((r) => r.current?.contains(e.target as Node))) return;
      close();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [refs, open, close]);
}

function Dropdown({
  listId,
  anchorRef,
  listRef,
  open,
  rows,
  query,
  active,
  setActive,
  isSelected,
  onPick,
  emptyText,
}: {
  listId: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  listRef: React.RefObject<HTMLUListElement | null>;
  open: boolean;
  rows: Row[];
  query: string;
  active: number;
  setActive: (i: number) => void;
  isSelected: (value: string) => boolean;
  onPick: (row: Row) => void;
  emptyText: string;
}) {
  const pos = useAnchoredPosition(anchorRef, open);

  // Keep the highlighted row visible. Adjusts only the list's own scroll —
  // scrollIntoView would also nudge the page and any scrolling ancestors.
  useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  }, [active, listRef]);

  if (!open || !pos) return null;
  return createPortal(
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      className="fixed z-[1000] overflow-y-auto overscroll-contain rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] p-1 shadow-[0_12px_32px_rgba(0,0,0,0.3)] animate-fade-in"
      style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {rows.length === 0 && <li className="px-3 py-3 text-center text-[13px] text-[color:var(--text-muted)]">{emptyText}</li>}
      {rows.map((r, i) => {
        const selected = isSelected(r.value);
        return (
          <li
            key={`${r.kind}-${r.value}`}
            role="option"
            data-index={i}
            aria-selected={selected}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(r)}
            className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] ${
              i === active ? 'bg-[color:var(--accent-subtle)]' : ''
            }`}
          >
            {r.kind === 'person' ? (
              <PersonAvatar name={r.person.name} avatarUrl={r.person.avatarUrl} />
            ) : (
              <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-dashed border-[color:var(--border-emphasis)] text-[10px] text-[color:var(--text-muted)]">
                –
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className={`block truncate ${r.kind === 'special' ? 'text-[color:var(--text-muted)]' : 'text-[color:var(--text-primary)]'}`}>
                <Highlight text={r.kind === 'person' ? r.person.name : r.label} query={query} />
              </span>
              {(r.kind === 'person' ? r.person.hint : r.hint) && (
                <span className="block truncate text-[11px] text-[color:var(--text-muted)]">
                  <Highlight text={(r.kind === 'person' ? r.person.hint : r.hint) ?? ''} query={query} />
                </span>
              )}
            </span>
            {selected && <FiCheck className="h-3.5 w-3.5 shrink-0 text-[color:var(--accent)]" aria-hidden />}
          </li>
        );
      })}
    </ul>,
    document.body
  );
}

const fieldBase =
  'relative flex w-full items-center gap-2 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-[color:var(--text-primary)] transition focus-within:border-[color:var(--accent)] focus-within:ring-2 focus-within:ring-[color:var(--accent)]/20';

const sizes = {
  sm: 'min-h-8 px-2 text-[12px]',
  md: 'min-h-9 px-2.5 text-[13px]',
};

export interface PersonSelectProps {
  value: string;
  onChange: (value: string) => void;
  people: PersonOption[];
  /**
   * Non-person choices listed first, e.g. `[{ value: '', label: 'Unassigned' }]`.
   * When `value` equals one of these, its label is shown in the field.
   */
  specialOptions?: SpecialOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  size?: keyof typeof sizes;
  className?: string;
  /** Show a × that resets to this value (usually ''). */
  clearValue?: string;
  'aria-label'?: string;
  id?: string;
}

/** Single person autocomplete. */
export function PersonSelect({
  value,
  onChange,
  people,
  specialOptions = [],
  placeholder = 'Search people…',
  disabled,
  required,
  size = 'md',
  className = '',
  clearValue,
  'aria-label': ariaLabel,
  id,
}: PersonSelectProps) {
  const listId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo<Row[]>(
    () => [
      ...specialOptions.map((o) => ({ kind: 'special' as const, value: o.value, label: o.label, hint: o.hint })),
      ...people.map((p) => ({ kind: 'person' as const, value: p.id, person: p })),
    ],
    [people, specialOptions]
  );

  const selectedPerson = people.find((p) => p.id === value);
  const selectedSpecial = specialOptions.find((o) => o.value === value);
  const displayText = selectedPerson?.name ?? selectedSpecial?.label ?? (value ? value : '');

  const { open, setOpen, query, setQuery, q, active, setActive, filtered, close, onKeyDown } = usePicker(rows);
  const pick = (r: Row) => {
    onChange(r.value);
    close();
    inputRef.current?.blur();
  };
  useOutsideClose(useMemo(() => [anchorRef, listRef], []), open, close);

  // Start on the current choice so Enter keeps it and arrows move from there.
  useEffect(() => {
    if (!open) return;
    const i = filtered.findIndex((r) => r.value === value);
    setActive(q ? 0 : Math.max(0, i));
    // Only when the list opens or the search changes — not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q]);

  const canClear = clearValue !== undefined && value !== clearValue && !disabled;

  return (
    <div
      ref={anchorRef}
      className={`${fieldBase} ${sizes[size]} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-text'} ${className}`}
      onMouseDown={(e) => {
        if (disabled || e.target === inputRef.current) return;
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }}
    >
      {!open && selectedPerson ? (
        <PersonAvatar name={selectedPerson.name} avatarUrl={selectedPerson.avatarUrl} size={20} />
      ) : (
        <FiSearch className={`h-3.5 w-3.5 shrink-0 ${open ? 'text-[color:var(--accent)]' : 'text-[color:var(--text-muted)]'}`} aria-hidden />
      )}
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        value={open ? query : displayText}
        placeholder={open && displayText ? displayText : placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => onKeyDown(e, pick)}
        onBlur={close}
        className={`min-w-0 flex-1 bg-transparent py-1 outline-none placeholder:text-[color:var(--text-muted)] disabled:cursor-not-allowed ${
          !open && selectedSpecial ? 'text-[color:var(--text-muted)]' : ''
        }`}
      />
      {canClear ? (
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onChange(clearValue!);
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[color:var(--text-muted)] hover:bg-[color:var(--bg-elevated)] hover:text-[color:var(--text-primary)]"
          aria-label="Clear selection"
        >
          <FiX className="h-3 w-3" aria-hidden />
        </button>
      ) : (
        <FiChevronDown className={`h-3.5 w-3.5 shrink-0 text-[color:var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      )}
      {required && (
        // Keeps native form validation working for required pickers.
        <input
          tabIndex={-1}
          aria-hidden
          required
          value={value}
          onChange={() => {}}
          onFocus={() => inputRef.current?.focus()}
          className="pointer-events-none absolute bottom-0 left-1/2 h-px w-px opacity-0"
        />
      )}
      <Dropdown
        listId={listId}
        anchorRef={anchorRef}
        listRef={listRef}
        open={open}
        rows={filtered}
        query={q}
        active={active}
        setActive={setActive}
        isSelected={(v) => v === value}
        onPick={pick}
        emptyText={query ? `No one matches “${query}”` : 'No people available'}
      />
    </div>
  );
}

export interface PersonMultiSelectProps {
  values: string[];
  onChange: (values: string[]) => void;
  people: PersonOption[];
  specialOptions?: SpecialOption[];
  placeholder?: string;
  disabled?: boolean;
  size?: keyof typeof sizes;
  className?: string;
  'aria-label'?: string;
  /** Picks stay open so several people can be added in a row. */
  closeOnPick?: boolean;
}

/** Multi person autocomplete with removable chips. */
export function PersonMultiSelect({
  values,
  onChange,
  people,
  specialOptions = [],
  placeholder = 'Add people…',
  disabled,
  size = 'md',
  className = '',
  'aria-label': ariaLabel,
  closeOnPick = false,
}: PersonMultiSelectProps) {
  const listId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useMemo<Row[]>(
    () => [
      ...specialOptions.map((o) => ({ kind: 'special' as const, value: o.value, label: o.label, hint: o.hint })),
      ...people.map((p) => ({ kind: 'person' as const, value: p.id, person: p })),
    ],
    [people, specialOptions]
  );

  const toggle = (v: string) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);

  const { open, setOpen, query, setQuery, q, active, setActive, filtered, close, onKeyDown } = usePicker(rows);
  const pick = (r: Row) => {
    toggle(r.value);
    setQuery('');
    if (closeOnPick) close();
  };
  useOutsideClose(useMemo(() => [anchorRef, listRef], []), open, close);

  useEffect(() => {
    setActive(0);
  }, [q, setActive]);

  const chips: ReactNode[] = values.map((v) => {
    const p = people.find((x) => x.id === v);
    const s = specialOptions.find((x) => x.value === v);
    const label = p?.name ?? s?.label ?? v;
    return (
      <span
        key={v}
        className="inline-flex h-6 max-w-[180px] items-center gap-1.5 rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] pl-0.5 pr-1 text-[12px]"
      >
        {p ? <PersonAvatar name={p.name} avatarUrl={p.avatarUrl} size={20} /> : <span className="w-1" />}
        <span className="truncate">{label}</span>
        {!disabled && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggle(v);
            }}
            className="flex h-4 w-4 items-center justify-center rounded-full text-[color:var(--text-muted)] hover:bg-red-500/15 hover:text-red-500"
            aria-label={`Remove ${label}`}
          >
            <FiX className="h-2.5 w-2.5" aria-hidden />
          </button>
        )}
      </span>
    );
  });

  return (
    <div
      ref={anchorRef}
      className={`${fieldBase} ${sizes[size]} flex-wrap py-1 ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-text'} ${className}`}
      onMouseDown={(e) => {
        if (disabled || e.target === inputRef.current) return;
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }}
    >
      {chips}
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        autoComplete="off"
        disabled={disabled}
        value={query}
        placeholder={values.length ? '' : placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Backspace' && !query && values.length) toggle(values[values.length - 1]);
          else onKeyDown(e, pick);
        }}
        onBlur={close}
        className="min-w-[6rem] flex-1 bg-transparent py-0.5 outline-none placeholder:text-[color:var(--text-muted)]"
      />
      <Dropdown
        listId={listId}
        anchorRef={anchorRef}
        listRef={listRef}
        open={open}
        rows={filtered}
        query={q}
        active={active}
        setActive={setActive}
        isSelected={(v) => values.includes(v)}
        onPick={pick}
        emptyText={query ? `No one matches “${query}”` : 'No people available'}
      />
    </div>
  );
}
