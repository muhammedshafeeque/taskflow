import { createPortal } from 'react-dom';
import type { User, Sprint, Milestone, Project, Issue } from '../../lib/api';
import { getIssueKey } from '../../lib/api';
import type { BulkFormState } from './bulkEditForm';

interface BulkEditModalProps {
  bulkModal: 'edit' | null;
  setBulkModal: (m: 'edit' | null) => void;
  bulkForm: BulkFormState;
  setBulkForm: (f: BulkFormState | ((prev: BulkFormState) => BulkFormState)) => void;
  bulkSubmitting: boolean;
  handleBulkUpdate: () => void;
  submitError: string;
  statusList: string[];
  users: User[];
  sprints: Sprint[];
  typeList: string[];
  priorityList: string[];
  milestones?: Milestone[];
  versions?: Project['versions'];
  labelSuggestions?: string[];
  parentCandidates?: Issue[];
  /** When false, sprint/milestone/versions/parent are hidden (multi-project bulk). */
  showProjectScopedFields?: boolean;
}

const inputCls =
  'w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)]';

const STORY_POINT_OPTIONS = [0, 1, 2, 3, 5, 8, 13, 21];
const ESTIMATE_OPTIONS = [15, 30, 60, 120, 240, 480, 960];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[11px] font-medium text-[color:var(--text-muted)] mb-1">{children}</label>;
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function BulkEditModal({
  bulkModal,
  setBulkModal,
  bulkForm,
  setBulkForm,
  bulkSubmitting,
  handleBulkUpdate,
  submitError,
  statusList,
  users,
  sprints,
  typeList,
  priorityList,
  milestones = [],
  versions = [],
  labelSuggestions = [],
  parentCandidates = [],
  showProjectScopedFields = true,
}: BulkEditModalProps) {
  if (bulkModal !== 'edit') return null;

  const versionList = versions ?? [];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={() => setBulkModal(null)}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-4 pt-4 pb-2 border-b border-[color:var(--border-subtle)]">
          <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">Bulk edit</h3>
          <p className="text-[11px] text-[color:var(--text-muted)] mt-0.5">
            Only fields you change below will be applied to all selected issues.
          </p>
          {submitError && <p className="text-xs text-red-400 mt-2">{submitError}</p>}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <FieldLabel>Status</FieldLabel>
              <select
                value={bulkForm.status ?? ''}
                onChange={(e) => setBulkForm((f) => ({ ...f, status: e.target.value || undefined }))}
                className={inputCls}
              >
                <option value="">— No change —</option>
                {statusList.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Assignee</FieldLabel>
              <select
                value={bulkForm.assignee ?? ''}
                onChange={(e) => setBulkForm((f) => ({ ...f, assignee: e.target.value || undefined }))}
                className={inputCls}
              >
                <option value="">— No change —</option>
                <option value="__unassigned__">Unassigned</option>
                {users.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Type</FieldLabel>
              <select
                value={bulkForm.type ?? ''}
                onChange={(e) => setBulkForm((f) => ({ ...f, type: e.target.value || undefined }))}
                className={inputCls}
              >
                <option value="">— No change —</option>
                {typeList.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Priority</FieldLabel>
              <select
                value={bulkForm.priority ?? ''}
                onChange={(e) => setBulkForm((f) => ({ ...f, priority: e.target.value || undefined }))}
                className={inputCls}
              >
                <option value="">— No change —</option>
                {priorityList.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>

            {showProjectScopedFields && (
              <>
                <div>
                  <FieldLabel>Sprint</FieldLabel>
                  <select
                    value={bulkForm.sprint ?? ''}
                    onChange={(e) => setBulkForm((f) => ({ ...f, sprint: e.target.value || undefined }))}
                    className={inputCls}
                  >
                    <option value="">— No change —</option>
                    <option value="__backlog__">Backlog (no sprint)</option>
                    {sprints.map((s) => (
                      <option key={s._id} value={s._id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <FieldLabel>Milestone</FieldLabel>
                  <select
                    value={bulkForm.milestone ?? ''}
                    onChange={(e) => setBulkForm((f) => ({ ...f, milestone: e.target.value || undefined }))}
                    className={inputCls}
                  >
                    <option value="">— No change —</option>
                    <option value="__clear__">Clear milestone</option>
                    {milestones.map((m) => (
                      <option key={m._id} value={m._id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div>
              <FieldLabel>Story points</FieldLabel>
              <select
                value={bulkForm.storyPoints ?? ''}
                onChange={(e) => setBulkForm((f) => ({ ...f, storyPoints: e.target.value || undefined }))}
                className={inputCls}
              >
                <option value="">— No change —</option>
                <option value="__clear__">Clear story points</option>
                {STORY_POINT_OPTIONS.map((p) => (
                  <option key={p} value={String(p)}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Time estimate (minutes)</FieldLabel>
              <select
                value={bulkForm.timeEstimateMinutes ?? ''}
                onChange={(e) =>
                  setBulkForm((f) => ({ ...f, timeEstimateMinutes: e.target.value || undefined }))
                }
                className={inputCls}
              >
                <option value="">— No change —</option>
                <option value="__clear__">Clear estimate</option>
                {ESTIMATE_OPTIONS.map((m) => (
                  <option key={m} value={String(m)}>
                    {m} min
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Due date</FieldLabel>
              <div className="flex gap-1">
                <input
                  type="date"
                  value={bulkForm.dueDate && bulkForm.dueDate !== '__clear__' ? bulkForm.dueDate : ''}
                  onChange={(e) => setBulkForm((f) => ({ ...f, dueDate: e.target.value || undefined }))}
                  className={`${inputCls} flex-1`}
                  disabled={bulkForm.dueDate === '__clear__'}
                />
                <button
                  type="button"
                  title="Clear due date"
                  onClick={() =>
                    setBulkForm((f) => ({
                      ...f,
                      dueDate: f.dueDate === '__clear__' ? undefined : '__clear__',
                    }))
                  }
                  className={`shrink-0 px-2 py-1 rounded text-[10px] border ${
                    bulkForm.dueDate === '__clear__'
                      ? 'border-[color:var(--accent)] text-[color:var(--accent)]'
                      : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)]'
                  }`}
                >
                  Clear
                </button>
              </div>
            </div>
            <div>
              <FieldLabel>Start date</FieldLabel>
              <div className="flex gap-1">
                <input
                  type="date"
                  value={bulkForm.startDate && bulkForm.startDate !== '__clear__' ? bulkForm.startDate : ''}
                  onChange={(e) => setBulkForm((f) => ({ ...f, startDate: e.target.value || undefined }))}
                  className={`${inputCls} flex-1`}
                  disabled={bulkForm.startDate === '__clear__'}
                />
                <button
                  type="button"
                  title="Clear start date"
                  onClick={() =>
                    setBulkForm((f) => ({
                      ...f,
                      startDate: f.startDate === '__clear__' ? undefined : '__clear__',
                    }))
                  }
                  className={`shrink-0 px-2 py-1 rounded text-[10px] border ${
                    bulkForm.startDate === '__clear__'
                      ? 'border-[color:var(--accent)] text-[color:var(--accent)]'
                      : 'border-[color:var(--border-subtle)] text-[color:var(--text-muted)]'
                  }`}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="sm:col-span-2">
              <FieldLabel>Labels</FieldLabel>
              <select
                value={bulkForm.labels === '__clear__' ? '__clear__' : bulkForm.labels ? '__set__' : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') setBulkForm((f) => ({ ...f, labels: undefined }));
                  else if (v === '__clear__') setBulkForm((f) => ({ ...f, labels: '__clear__' }));
                  else setBulkForm((f) => ({ ...f, labels: f.labels === '__clear__' ? '' : f.labels ?? '' }));
                }}
                className={`${inputCls} mb-1`}
              >
                <option value="">— No change —</option>
                <option value="__set__">Set labels</option>
                <option value="__clear__">Clear all labels</option>
              </select>
              {bulkForm.labels !== undefined && bulkForm.labels !== '__clear__' && (
                <>
                  <input
                    type="text"
                    placeholder="Comma-separated labels, e.g. bug, urgent"
                    value={bulkForm.labels}
                    onChange={(e) => setBulkForm((f) => ({ ...f, labels: e.target.value }))}
                    className={inputCls}
                    list="bulk-label-suggestions"
                  />
                  {labelSuggestions.length > 0 && (
                    <datalist id="bulk-label-suggestions">
                      {labelSuggestions.map((l) => (
                        <option key={l} value={l} />
                      ))}
                    </datalist>
                  )}
                </>
              )}
            </div>

            {showProjectScopedFields && parentCandidates.length > 0 && (
              <div className="sm:col-span-2">
                <FieldLabel>Parent issue</FieldLabel>
                <select
                  value={bulkForm.parent ?? ''}
                  onChange={(e) => setBulkForm((f) => ({ ...f, parent: e.target.value || undefined }))}
                  className={inputCls}
                >
                  <option value="">— No change —</option>
                  <option value="__clear__">Remove parent</option>
                  {parentCandidates.map((i) => (
                    <option key={i._id} value={i._id}>
                      {getIssueKey(i)} — {i.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {showProjectScopedFields && versionList.length > 0 && (
              <>
                <div className="sm:col-span-2">
                  <FieldLabel>Fix version</FieldLabel>
                  <label className="flex items-center gap-2 text-xs text-[color:var(--text-muted)] mb-1">
                    <input
                      type="checkbox"
                      checked={Boolean(bulkForm.fixVersionClear)}
                      onChange={(e) =>
                        setBulkForm((f) => ({
                          ...f,
                          fixVersionClear: e.target.checked,
                          fixVersionIds: e.target.checked ? undefined : f.fixVersionIds,
                        }))
                      }
                    />
                    Clear fix versions
                  </label>
                  {!bulkForm.fixVersionClear && (
                    <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto p-2 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]">
                      {versionList.map((v) => {
                        const checked = (bulkForm.fixVersionIds ?? []).includes(v.id);
                        return (
                          <label
                            key={v.id}
                            className="inline-flex items-center gap-1.5 text-xs text-[color:var(--text-primary)] cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setBulkForm((f) => ({
                                  ...f,
                                  fixVersionIds: toggleId(f.fixVersionIds ?? [], v.id),
                                }))
                              }
                            />
                            {v.name}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel>Affects versions</FieldLabel>
                  <label className="flex items-center gap-2 text-xs text-[color:var(--text-muted)] mb-1">
                    <input
                      type="checkbox"
                      checked={Boolean(bulkForm.affectsVersionsClear)}
                      onChange={(e) =>
                        setBulkForm((f) => ({
                          ...f,
                          affectsVersionsClear: e.target.checked,
                          affectsVersionIds: e.target.checked ? undefined : f.affectsVersionIds,
                        }))
                      }
                    />
                    Clear affects versions
                  </label>
                  {!bulkForm.affectsVersionsClear && (
                    <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto p-2 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]">
                      {versionList.map((v) => {
                        const checked = (bulkForm.affectsVersionIds ?? []).includes(v.id);
                        return (
                          <label
                            key={v.id}
                            className="inline-flex items-center gap-1.5 text-xs text-[color:var(--text-primary)] cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setBulkForm((f) => ({
                                  ...f,
                                  affectsVersionIds: toggleId(f.affectsVersionIds ?? [], v.id),
                                }))
                              }
                            />
                            {v.name}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="shrink-0 flex gap-2 justify-end px-4 py-3 border-t border-[color:var(--border-subtle)]">
          <button
            type="button"
            onClick={() => setBulkModal(null)}
            className="px-3 py-1.5 rounded text-xs border border-[color:var(--border-subtle)] text-[color:var(--text-muted)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleBulkUpdate}
            disabled={bulkSubmitting}
            className="px-3 py-1.5 rounded text-xs bg-[color:var(--accent)] text-white font-medium disabled:opacity-50"
          >
            {bulkSubmitting ? 'Updating…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
