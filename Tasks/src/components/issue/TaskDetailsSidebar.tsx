import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { Issue, Project, User, WorkLog, Sprint } from '../../lib/api';
import { MetaIconGlyph, type MetaIconKey } from '../../pages/ProjectSettings';
import { formatMinutes, parseDuration } from './WorkLogInput';
import WatchButton from './WatchButton';
import DateInputDDMMYYYY from '../DateInputDDMMYYYY';
import { formatDateDDMMYYYY, toIsoDatePart } from '../../lib/dateFormat';

function formatDate(s: string | undefined) {
  if (!s) return '—';
  return formatDateDDMMYYYY(s);
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

interface TaskDetailsSidebarProps {
  issue: Issue;
  project: Project | null;
  projectId?: string;
  users: User[];
  watchers: { user: { _id: string; name: string; email: string } }[];
  watching: boolean;
  watchingLoading?: boolean;
  watchersError?: string;
  currentUserId?: string;
  onWatch: () => void;
  onUnwatch: () => void;
  statusList: string[];
  typeList: string[];
  priorityList: string[];
  getTypeMeta: (name: string) => { color?: string; icon?: string } | undefined;
  getPriorityMeta: (name: string) => { color?: string; icon?: string } | undefined;
  getStatusMeta: (name: string) => { color?: string; icon?: string } | undefined;
  updatingField: string | null;
  newLabel: string;
  workLogs: WorkLog[];
  onUpdateField: (
    field: 'status' | 'type' | 'priority' | 'assignee' | 'dueDate' | 'startDate' | 'storyPoints' | 'fixVersion' | 'timeEstimateMinutes' | 'sprint',
    value: string | number | null
  ) => void;
  onUpdateAffectsVersions: (versions: string[]) => void;
  onAddLabel: () => void;
  onRemoveLabel: (label: string) => void;
  onNewLabelChange: (value: string) => void;
  onOpenTimeLog: () => void;
  onDelete: () => void;
  sprints?: Sprint[];
}

const inputBase =
  'w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 transition-colors';

function InlineSelect<T extends string>({
  value,
  options,
  displayValue,
  onChange,
  disabled,
  className = '',
  renderOption,
}: {
  value: T;
  options: { value: T; label: string }[];
  displayValue?: string;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  renderOption?: (opt: { value: T; label: string }) => React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setEditing(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editing]);

  const label = options.find((o) => o.value === value)?.label ?? displayValue ?? value;

  if (editing) {
    return (
      <div ref={ref} className={className}>
        <select
          value={value}
          onChange={(e) => {
            onChange(e.target.value as T);
            setEditing(false);
          }}
          onBlur={() => setEditing(false)}
          disabled={disabled}
          autoFocus
          className={`${inputBase} cursor-pointer`}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => !disabled && setEditing(true)}
      disabled={disabled}
      className={`w-full text-left px-3 py-1.5 rounded-md min-h-[34px] text-xs transition-colors hover:bg-[color:var(--bg-surface)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 focus:ring-inset ${className}`}
    >
      {renderOption ? renderOption({ value, label }) : <span className="text-[color:var(--text-primary)]">{label}</span>}
    </button>
  );
}

function InlineDate({
  value,
  onChange,
  disabled,
  placeholder = '—',
}: {
  value: string;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setEditing(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editing]);

  const display = value ? formatDate(value) : placeholder;
  const isHot = value
    ? (() => {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return false;
        const today = new Date();
        const normalize = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
        return normalize(d) <= normalize(today);
      })()
    : false;

  if (editing) {
    return (
      <div ref={ref}>
        <DateInputDDMMYYYY
          value={toIsoDatePart(value)}
          onChange={(iso) => onChange(iso || null)}
          allowEmpty
          disabled={disabled}
          className={`${inputBase} cursor-text`}
          onCommit={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => !disabled && setEditing(true)}
      disabled={disabled}
      className={`w-full text-left px-3 py-2 rounded-md min-h-[36px] text-xs hover:bg-[color:var(--bg-surface)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 focus:ring-inset transition-colors ${
        isHot ? 'text-red-400 font-medium' : 'text-[color:var(--text-primary)]'
      }`}
    >
      {display}
    </button>
  );
}

function InlineEstimate({
  valueMinutes,
  onChange,
  disabled,
}: {
  valueMinutes: number | undefined;
  onChange: (minutes: number | null) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const display = valueMinutes != null && valueMinutes > 0 ? formatMinutes(valueMinutes) : '—';

  function handleDone() {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      onChange(null);
      setEditing(false);
      setError(null);
      return;
    }
    const minutes = parseDuration(trimmed);
    if (minutes == null || minutes <= 0) {
      setError('e.g. 1h 2m 10s');
      return;
    }
    setError(null);
    onChange(minutes);
    setEditing(false);
  }

  if (editing) {
    return (
      <div>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleDone()}
          onBlur={handleDone}
          disabled={disabled}
          autoFocus
          placeholder="e.g. 1h 2m 10s"
          className={`${inputBase} ${error ? 'border-red-400' : ''}`}
        />
        {error && <p className="text-[10px] text-red-400 mt-0.5">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) {
          setInputValue(valueMinutes != null && valueMinutes > 0 ? formatMinutes(valueMinutes) : '');
          setError(null);
          setEditing(true);
        }
      }}
      disabled={disabled}
      className="w-full text-left px-3 py-2 rounded-md min-h-[36px] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 focus:ring-inset transition-colors"
    >
      {display}
    </button>
  );
}

function InlineStoryPoints({
  value,
  onChange,
  disabled,
}: {
  value: number | undefined;
  onChange: (points: number | null) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (editing) {
    return (
      <div>
        <input
          type="number"
          min={0}
          step={1}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const trimmed = inputValue.trim();
              if (trimmed === '') {
                onChange(null);
                setEditing(false);
                setError(null);
                return;
              }
              const parsed = Number(trimmed);
              if (!Number.isFinite(parsed) || parsed < 0) {
                setError('Enter a valid non-negative number');
                return;
              }
              onChange(Math.round(parsed));
              setEditing(false);
              setError(null);
            }
          }}
          onBlur={() => {
            const trimmed = inputValue.trim();
            if (trimmed === '') {
              onChange(null);
              setEditing(false);
              setError(null);
              return;
            }
            const parsed = Number(trimmed);
            if (!Number.isFinite(parsed) || parsed < 0) {
              setError('Enter a valid non-negative number');
              return;
            }
            onChange(Math.round(parsed));
            setEditing(false);
            setError(null);
          }}
          disabled={disabled}
          autoFocus
          className={`${inputBase} ${error ? 'border-red-400' : ''}`}
        />
        {error && <p className="text-[10px] text-red-400 mt-0.5">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        if (!disabled) {
          setInputValue(value != null ? String(value) : '');
          setError(null);
          setEditing(true);
        }
      }}
      disabled={disabled}
      className="w-full text-left px-3 py-2 rounded-md min-h-[36px] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 focus:ring-inset transition-colors"
    >
      {value != null ? value : '—'}
    </button>
  );
}

export default function TaskDetailsSidebar({
  issue,
  project,
  projectId,
  users,
  watchers,
  watching,
  watchingLoading = false,
  watchersError = '',
  currentUserId,
  onWatch,
  onUnwatch,
  statusList,
  typeList,
  priorityList,
  getTypeMeta,
  getPriorityMeta,
  getStatusMeta,
  updatingField,
  newLabel,
  workLogs,
  onUpdateField,
  onUpdateAffectsVersions,
  onAddLabel,
  onRemoveLabel,
  onNewLabelChange,
  onOpenTimeLog,
  onDelete,
  sprints = [],
}: TaskDetailsSidebarProps) {
  const assigneeId = typeof issue.assignee === 'object' && issue.assignee ? issue.assignee._id : '';
  const assignee = users.find((u) => u._id === assigneeId);
  const reporterName =
    typeof issue.reporter === 'object' && issue.reporter ? issue.reporter.name : '—';

  const totalMinutes = workLogs.reduce((sum, log) => sum + (log.minutesSpent ?? 0), 0);
  const recentLogs = workLogs.slice(0, 3);

  return (
    <aside className="lg:order-none order-first w-full lg:max-w-[340px]">
      <div className="sticky top-6 max-h-[calc(100vh-5rem)] overflow-y-auto space-y-4 pr-1 [scrollbar-width:thin] [scrollbar-color:var(--border-subtle)_transparent]">
        <div className="rounded-xl border border-[color:var(--border-subtle)]/90 bg-[color:var(--bg-surface)] overflow-hidden shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
            <span className="text-xs font-semibold tracking-tight text-[color:var(--text-primary)]">Details</span>
            <button
              type="button"
              onClick={onDelete}
              className="text-[10px] text-[color:var(--text-muted)] hover:text-red-400 transition-colors py-1 px-2 rounded hover:bg-red-500/10"
              title="Delete issue"
            >
              Delete
            </button>
          </div>

          <div className="divide-y divide-[color:var(--border-subtle)]/70">
            {/* Status */}
            <div className="px-4 py-3">
              <label className="flex items-center gap-1.5 text-[10px] font-medium text-[color:var(--text-muted)] uppercase tracking-[0.08em] mb-1.5">
                {(() => {
                  const meta = getStatusMeta(issue.status);
                  return (
                    <>
                      {meta?.icon && (
                        <span style={meta.color ? { color: meta.color } : undefined}>
                          <MetaIconGlyph icon={meta.icon as MetaIconKey} className="w-3.5 h-3.5" />
                        </span>
                      )}
                      {meta?.color && (
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} aria-hidden />
                      )}
                    </>
                  );
                })()}
                Status
              </label>
              <InlineSelect
                value={issue.status}
                options={statusList.map((s) => ({ value: s, label: s }))}
                onChange={(v) => onUpdateField('status', v)}
                disabled={!!updatingField}
                renderOption={({ label }) => {
                  const meta = getStatusMeta(label);
                  return (
                    <span className="inline-flex items-center gap-1.5 text-[color:var(--text-primary)]">
                      {meta?.icon && (
                        <span style={meta.color ? { color: meta.color } : undefined}>
                          <MetaIconGlyph icon={meta.icon as MetaIconKey} className="w-3.5 h-3.5" />
                        </span>
                      )}
                      <span>{label}</span>
                    </span>
                  );
                }}
              />
            </div>

            {/* Type & Priority */}
            <div className="px-4 py-3 grid grid-cols-2 gap-2.5">
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-medium text-[color:var(--text-muted)] uppercase tracking-wider mb-1.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: getTypeMeta(issue.type)?.color ?? 'rgb(100 116 139)' }} aria-hidden />
                  Type
                </label>
                <InlineSelect
                  value={issue.type}
                  options={typeList.map((t) => ({ value: t, label: t }))}
                  onChange={(v) => onUpdateField('type', v)}
                  disabled={!!updatingField}
                  renderOption={({ label }) => {
                    const meta = getTypeMeta(label);
                    return (
                      <span className="inline-flex items-center gap-1.5 text-[color:var(--text-primary)]">
                        {meta?.icon && (
                          <span style={meta.color ? { color: meta.color } : undefined}>
                            <MetaIconGlyph icon={meta.icon as MetaIconKey} className="w-3.5 h-3.5" />
                          </span>
                        )}
                        <span>{label}</span>
                      </span>
                    );
                  }}
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-medium text-[color:var(--text-muted)] uppercase tracking-wider mb-1.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: getPriorityMeta(issue.priority)?.color ?? 'rgb(251 191 36)' }} aria-hidden />
                  Priority
                </label>
                <InlineSelect
                  value={issue.priority}
                  options={priorityList.map((p) => ({ value: p, label: p }))}
                  onChange={(v) => onUpdateField('priority', v)}
                  disabled={!!updatingField}
                  renderOption={({ label }) => {
                    const meta = getPriorityMeta(label);
                    return (
                      <span className="inline-flex items-center gap-1.5 text-[color:var(--text-primary)]">
                        {meta?.icon && (
                          <span style={meta.color ? { color: meta.color } : undefined}>
                            <MetaIconGlyph icon={meta.icon as MetaIconKey} className="w-3.5 h-3.5" />
                          </span>
                        )}
                        <span>{label}</span>
                      </span>
                    );
                  }}
                />
              </div>
            </div>

            {/* People */}
            <div className="px-4 py-3 space-y-2">
              <label className="block text-[10px] font-medium text-[color:var(--text-muted)] uppercase tracking-wider">
                People
              </label>
              <div className="space-y-1.5">
                <div>
                  <span className="block text-[10px] text-[color:var(--text-muted)] mb-1">Assignee</span>
                  <InlineSelect
                    value={assigneeId || '__unassigned__'}
                    options={[
                      { value: '__unassigned__', label: 'Unassigned' },
                      ...users.map((u) => ({ value: u._id, label: u.name })),
                    ]}
                    onChange={(v) => onUpdateField('assignee', v === '__unassigned__' ? '' : v)}
                    disabled={!!updatingField}
                    renderOption={({ label }) => (
                      <span className="flex items-center gap-2">
                        {assignee && label !== 'Unassigned' ? (
                          <>
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[9px] font-semibold text-[color:var(--text-primary)] shrink-0">
                              {getInitials(label)}
                            </span>
                            <span className="text-[color:var(--text-primary)] truncate">{label}</span>
                          </>
                        ) : (
                          <span className="text-[color:var(--text-muted)]">{label}</span>
                        )}
                      </span>
                    )}
                  />
                </div>
                <div>
                  <span className="block text-[10px] text-[color:var(--text-muted)] mb-1">Reporter</span>
                  <p className="px-3 py-2 text-xs text-[color:var(--text-primary)] bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] rounded-md">
                    {reporterName}
                  </p>
                </div>
              </div>
            </div>

            {/* Watchers */}
            <div className="px-4 py-3 space-y-2">
              <label className="block text-[10px] font-medium text-[color:var(--text-muted)] uppercase tracking-wider">
                Watchers
              </label>
              <div className="flex items-center gap-2 flex-wrap">
                <WatchButton
                  watching={watching}
                  loading={watchingLoading}
                  onWatch={onWatch}
                  onUnwatch={onUnwatch}
                  size="md"
                  label
                />
              </div>
              {watchersError && (
                <p className="text-xs text-red-400">{watchersError}</p>
              )}
              {watchers.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {watchers.map((w) => {
                    const isYou = currentUserId && w.user._id === currentUserId;
                    const tooltip = `${w.user.name}${w.user.email ? ` (${w.user.email})` : ''}${isYou ? ' — You' : ''}`;
                    return (
                      <span
                        key={w.user._id}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[9px] font-semibold text-[color:var(--text-primary)]"
                        title={tooltip}
                      >
                        {getInitials(w.user.name)}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Dates */}
            <div className="px-4 py-3 space-y-2">
              <label className="block text-[10px] font-medium text-[color:var(--text-muted)] uppercase tracking-wider">
                Dates
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="block text-[10px] text-[color:var(--text-muted)] mb-1">Due</span>
                  <InlineDate
                    value={issue.dueDate ?? ''}
                    onChange={(v) => onUpdateField('dueDate', v)}
                    disabled={!!updatingField}
                  />
                </div>
                <div>
                  <span className="block text-[10px] text-[color:var(--text-muted)] mb-1">Start</span>
                  <InlineDate
                    value={issue.startDate ?? ''}
                    onChange={(v) => onUpdateField('startDate', v)}
                    disabled={!!updatingField}
                  />
                </div>
              </div>
            </div>

            {/* Versions */}
            <div className="px-4 py-3 space-y-2">
              <label className="block text-[10px] font-medium text-[color:var(--text-muted)] uppercase tracking-wider">
                Versions
              </label>
              {project?.versions && project.versions.length > 0 ? (
                <div className="space-y-2">
                  <div>
                    <span className="block text-[10px] text-[color:var(--text-muted)] mb-1">Fix version</span>
                    <InlineSelect
                      value={issue.fixVersion ?? ''}
                      options={[
                        { value: '', label: 'None' },
                        ...project.versions.map((v) => ({ value: v.id, label: v.name })),
                      ]}
                      onChange={(v) => onUpdateField('fixVersion', v || null)}
                      disabled={!!updatingField}
                      renderOption={({ label }) => (
                        <span className={label === 'None' ? 'text-[color:var(--text-muted)]' : 'text-[color:var(--text-primary)]'}>
                          {label}
                        </span>
                      )}
                    />
                  </div>
                  <VersionMultiSelect
                    value={issue.affectsVersions ?? []}
                    options={project.versions}
                    onChange={onUpdateAffectsVersions}
                    disabled={!!updatingField}
                  />
                </div>
              ) : (
                <div className="rounded-md bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] px-3 py-3">
                  <p className="text-xs text-[color:var(--text-muted)]">No versions added</p>
                  {projectId && (
                    <Link
                      to={`/projects/${projectId}/versions`}
                      className="mt-2 inline-block text-xs text-[color:var(--text-primary)] hover:underline transition-colors"
                    >
                      Add versions →
                    </Link>
                  )}
                </div>
              )}
            </div>

            {/* Estimate */}
            <div className="px-4 py-3 space-y-2">
              <label className="block text-[10px] font-medium text-[color:var(--text-muted)] uppercase tracking-wider">
                Estimate
              </label>
              <InlineEstimate
                valueMinutes={issue.timeEstimateMinutes}
                onChange={(v) => onUpdateField('timeEstimateMinutes', v)}
                disabled={!!updatingField}
              />
              <p className="text-[11px] text-[color:var(--text-muted)]">
                e.g. 1h 2m 10s
              </p>
            </div>

            {/* Story points */}
            <div className="px-4 py-3 space-y-2">
              <label className="block text-[10px] font-medium text-[color:var(--text-muted)] uppercase tracking-wider">
                Story points
              </label>
              <InlineStoryPoints
                value={issue.storyPoints}
                onChange={(v) => onUpdateField('storyPoints', v)}
                disabled={!!updatingField}
              />
            </div>

            {/* Time logged */}
            <div className="px-4 py-3 space-y-2">
              <label className="block text-[10px] font-medium text-[color:var(--text-muted)] uppercase tracking-wider">
                Time logged
              </label>
              <button
                type="button"
                onClick={onOpenTimeLog}
                className="flex items-center justify-between w-full px-3 py-2 rounded-md bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 focus:ring-inset transition-colors"
              >
                <span className="text-[color:var(--text-muted)]">Logged</span>
                <span className="font-medium text-[color:var(--text-primary)]">
                  {formatMinutes(totalMinutes)}
                </span>
              </button>
              <p className="text-[11px] text-[color:var(--text-muted)]">
                Click to open the full log time dialog (Jira style).
              </p>
              {recentLogs.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-[color:var(--border-subtle)]/70">
                  {recentLogs.map((log) => (
                    <div
                      key={log._id}
                      className="flex items-center justify-between text-[11px] text-[color:var(--text-muted)]"
                    >
                      <span className="truncate">
                        {log.author?.name ?? 'Someone'} ·{' '}
                        {formatDateDDMMYYYY(log.date)}
                      </span>
                      <span className="ml-2 text-[color:var(--text-primary)] font-medium">
                        {formatMinutes(log.minutesSpent)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {workLogs.length === 0 && (
                <p className="text-[11px] text-[color:var(--text-muted)]">
                  No work logged yet. Use this quick form or the Time tab in Activity.
                </p>
              )}
            </div>

            {/* Sprint */}
            <div className="px-4 py-3 space-y-2">
              <label className="block text-[10px] font-medium text-[color:var(--text-muted)] uppercase tracking-wider">
                Sprint
              </label>
              <InlineSelect
                value={
                  issue.sprint && typeof issue.sprint === 'object'
                    ? issue.sprint._id
                    : (issue.sprint as unknown as string) || ''
                }
                options={[
                  { value: '' as string, label: 'Backlog (no sprint)' },
                  ...sprints.map((s) => ({ value: s._id as string, label: s.name })),
                ]}
                onChange={(v) => onUpdateField('sprint', v || null)}
                disabled={!!updatingField}
              />
            </div>

            {/* Timestamps */}
            <div className="px-4 py-3 bg-[color:var(--bg-surface)]">
              <div className="flex justify-between text-[10px] text-[color:var(--text-muted)]">
                <span>Created</span>
                <span className="text-[color:var(--text-primary)]">{formatDate(issue.createdAt)}</span>
              </div>
              <div className="flex justify-between text-[10px] text-[color:var(--text-muted)] mt-1">
                <span>Updated</span>
                <span className="text-[color:var(--text-primary)]">{formatDate(issue.updatedAt)}</span>
              </div>
            </div>

            {/* Labels */}
            <div className="px-4 py-3">
              <label className="block text-[10px] font-medium text-[color:var(--text-muted)] uppercase tracking-wider mb-1.5">
                Labels
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(issue.labels ?? []).length > 0 ? (
                  (issue.labels ?? []).map((l) => (
                    <span
                      key={l}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[11px] text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] transition-colors group"
                    >
                      {l}
                      <button
                        type="button"
                        onClick={() => onRemoveLabel(l)}
                        className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all"
                        aria-label={`Remove ${l}`}
                      >
                        ×
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-[color:var(--text-muted)]">No labels</span>
                )}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => onNewLabelChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onAddLabel())}
                  placeholder="Add label"
                  className={`flex-1 ${inputBase} py-1.5 text-xs`}
                />
                <button
                  type="button"
                  onClick={onAddLabel}
                  className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs font-medium text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

function VersionMultiSelect({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string[];
  options: { id: string; name: string }[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setEditing(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editing]);

  const labels = value.map((id) => options.find((o) => o.id === id)?.name).filter(Boolean);
  const display = labels.length > 0 ? labels.join(', ') : 'None';

  if (editing) {
    return (
      <div ref={ref}>
        <span className="block text-[10px] text-[color:var(--text-muted)] mb-1">Affects versions</span>
        <select
          multiple
          value={value}
          onChange={(e) => {
            const selected = Array.from(e.target.selectedOptions, (o) => o.value);
            onChange(selected);
          }}
          onBlur={() => setEditing(false)}
          disabled={disabled}
          autoFocus
          className={`${inputBase} min-h-[80px] cursor-pointer`}
        >
          {options.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <p className="text-[10px] text-[color:var(--text-muted)] mt-1">Ctrl+click for multiple</p>
      </div>
    );
  }

  return (
    <div>
      <span className="block text-[10px] text-[color:var(--text-muted)] mb-1">Affects versions</span>
      <button
        type="button"
        onClick={() => !disabled && setEditing(true)}
        disabled={disabled}
        className="w-full text-left px-3 py-2 rounded-md min-h-[36px] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 focus:ring-inset transition-colors"
      >
        {display === 'None' ? (
          <span className="text-[color:var(--text-muted)]">{display}</span>
        ) : (
          <span className="text-[color:var(--text-primary)]">{display}</span>
        )}
      </button>
    </div>
  );
}
