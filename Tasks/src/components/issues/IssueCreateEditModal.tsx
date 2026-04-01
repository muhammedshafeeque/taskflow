import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, useCallback } from 'react';
import { DescriptionEditor } from '../issue';
import DateInputDDMMYYYY from '../DateInputDDMMYYYY';
import type { Issue, Project, User, Milestone, Sprint } from '../../lib/api';
import { formatDateDDMMYYYY } from '../../lib/dateFormat';

export interface IssueForm {
  title: string;
  description: string;
  type: string;
  priority: string;
  status: string;
  project: string;
  assignee: string;
  sprint: string;
  storyPoints: string;
  parent: string;
  milestone: string;
  customFieldValues: Record<string, unknown>;
  fixVersion: string;
  affectsVersions: string[];
  labels: string[];
}

interface IssueCreateEditModalProps {
  modal: 'create' | 'edit' | null;
  setModal: (m: 'create' | 'edit' | null) => void;
  form: IssueForm;
  setForm: (f: IssueForm | ((prev: IssueForm) => IssueForm)) => void;
  submitError: string;
  submitting: boolean;
  handleSubmit: (e: React.FormEvent) => void;
  typeList: string[];
  priorityList: string[];
  statusList: string[];
  users: User[];
  parentCandidates: Issue[];
  project: Project | null;
  getIssueKey: (issue: Issue) => string;
  projects?: Project[];
  showProjectSelector?: boolean;
  milestones?: Milestone[];
  sprints?: Sprint[];
  labelSuggestions?: string[];
  pendingFiles?: File[];
  onPendingFilesChange?: (files: File[]) => void;
}

export function IssueCreateEditModal(props: IssueCreateEditModalProps) {
  const { modal, setModal, form, setForm, submitError, submitting, handleSubmit, typeList, priorityList, statusList, users, parentCandidates, project, getIssueKey, projects = [], showProjectSelector, milestones = [], sprints = [], labelSuggestions = [], pendingFiles = [], onPendingFilesChange } = props;
  if (!modal) return null;
  const [affectsOpen, setAffectsOpen] = useState(false);
  const affectsRef = useRef<HTMLDivElement | null>(null);
  const [labelInput, setLabelInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ACCEPTED_FILE_TYPES = 'image/*,video/*,.pdf,.xlsx,.xls,.docx,.doc';

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!onPendingFilesChange) return;
    const selected = Array.from(e.target.files ?? []);
    if (selected.length === 0) return;
    onPendingFilesChange([...pendingFiles, ...selected]);
    e.target.value = '';
  }, [pendingFiles, onPendingFilesChange]);

  const removeFile = useCallback((index: number) => {
    if (!onPendingFilesChange) return;
    onPendingFilesChange(pendingFiles.filter((_, i) => i !== index));
  }, [pendingFiles, onPendingFilesChange]);

  const inputCls =
    'w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 transition-colors';
  const selectedAffects = (project?.versions || []).filter((v) => form.affectsVersions.includes(v.id));

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (affectsRef.current && !affectsRef.current.contains(target)) {
        setAffectsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    setLabelInput('');
  }, [modal, form.labels]);

  const normalizedSuggestions = Array.from(
    new Set(
      (labelSuggestions || [])
        .map((l) => l.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  const addLabel = (raw: string) => {
    const next = raw.trim();
    if (!next) return;
    setForm((prev) => {
      const exists = prev.labels.some((l) => l.toLowerCase() === next.toLowerCase());
      if (exists) return prev;
      return { ...prev, labels: [...prev.labels, next] };
    });
    setLabelInput('');
  };

  const removeLabel = (label: string) => {
    setForm((prev) => ({ ...prev, labels: prev.labels.filter((l) => l !== label) }));
  };

  return createPortal(
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm animate-fade-in p-4" onClick={() => setModal(null)}>
      <div className="modal-panel w-full max-w-3xl rounded-2xl p-6 shadow-xl animate-scale-in max-h-[90vh] overflow-y-auto overflow-x-hidden" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-3">{modal === 'create' ? 'New issue' : 'Edit issue'}</h2>
        <form onSubmit={handleSubmit} className="space-y-3 min-w-0">
          {submitError && <p className="text-xs text-red-400">{submitError}</p>}
          {showProjectSelector && projects.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Project</label>
              <select
                value={form.project}
                onChange={(e) => setForm((f) => ({ ...f, project: e.target.value }))}
                required
                disabled={modal === 'edit'}
                className={inputCls}
              >
                <option value="">Select project</option>
                {projects.map((p) => (
                  <option key={p._id} value={p._id}>{p.name} ({p.key})</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Title</label>
            <input type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Description</label>
            <DescriptionEditor value={form.description} onChange={(v) => setForm((f) => ({ ...f, description: v }))} placeholder="Add a description…" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
            <div>
              <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Type</label>
              <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className={inputCls}>
                {typeList.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Priority</label>
              <select value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} className={inputCls}>
                {priorityList.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Status</label>
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className={inputCls}>
                {statusList.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Assignee</label>
              <select value={form.assignee} onChange={(e) => setForm((f) => ({ ...f, assignee: e.target.value }))} className={inputCls}>
                <option value="">Unassigned</option>
                {users.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Sprint</label>
              <select value={form.sprint} onChange={(e) => setForm((f) => ({ ...f, sprint: e.target.value }))} className={inputCls}>
                <option value="">Backlog (no sprint)</option>
                {sprints.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Story points</label>
              <input
                type="number"
                min={0}
                step={1}
                value={form.storyPoints}
                onChange={(e) => setForm((f) => ({ ...f, storyPoints: e.target.value }))}
                placeholder="Optional"
                className={inputCls}
              />
            </div>
            <div className="col-span-2 min-w-0">
              <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Labels</label>
              <div className="space-y-2">
                <input
                  type="text"
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addLabel(labelInput);
                    }
                    if (e.key === 'Backspace' && !labelInput && form.labels.length > 0) {
                      e.preventDefault();
                      removeLabel(form.labels[form.labels.length - 1]);
                    }
                  }}
                  onBlur={() => {
                    if (labelInput.trim()) addLabel(labelInput);
                  }}
                  placeholder="Type label and press Enter"
                  list="issue-label-suggestions"
                  className={inputCls}
                />
                <datalist id="issue-label-suggestions">
                  {normalizedSuggestions.map((label) => (
                    <option key={label} value={label} />
                  ))}
                </datalist>
                {form.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.labels.map((label) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => removeLabel(label)}
                        className="inline-flex items-center gap-1 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] px-2 py-0.5 text-[11px] text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)]"
                        title={`Remove ${label}`}
                      >
                        <span>{label}</span>
                        <span aria-hidden>×</span>
                      </button>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-[color:var(--text-muted)]">Suggested from existing issues. You can also add new labels.</p>
              </div>
            </div>
            {(typeList.includes('Epic') || typeList.includes('Story')) && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Parent (Epic/Story)</label>
                <select value={form.parent} onChange={(e) => setForm((f) => ({ ...f, parent: e.target.value }))} className={inputCls}>
                  <option value="">None</option>
                  {parentCandidates.map((p) => <option key={p._id} value={p._id}>{getIssueKey(p)} · {p.title}</option>)}
                </select>
              </div>
            )}
            {milestones.length > 0 && (
              <div className="col-span-2">
                <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Milestone</label>
                <select value={form.milestone} onChange={(e) => setForm((f) => ({ ...f, milestone: e.target.value }))} className={inputCls}>
                  <option value="">None</option>
                  {milestones.map((m) => (
                    <option key={m._id} value={m._id}>
                      {m.name}{m.dueDate ? ` (${formatDateDDMMYYYY(m.dueDate)})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          {project?.versions && project.versions.length > 0 && (
            <div className="grid grid-cols-1 gap-3 pt-2 min-w-0">
              <div>
                <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Fix version</label>
                <select value={form.fixVersion} onChange={(e) => setForm((f) => ({ ...f, fixVersion: e.target.value }))} className={inputCls}>
                  <option value="">None</option>
                  {project.versions.map((v) => <option key={v.id} value={v.id}>{v.name} {v.status !== 'unreleased' ? `(${v.status})` : ''}</option>)}
                </select>
              </div>
              <div className="min-w-0">
                <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">Affects versions</label>
                <div className="relative" ref={affectsRef}>
                  <button
                    type="button"
                    onClick={() => setAffectsOpen((v) => !v)}
                    className={inputCls + ' min-h-[34px] text-left flex items-center justify-between hover:bg-[color:var(--bg-surface)]'}
                  >
                    <span className="truncate pr-3">
                      {selectedAffects.length === 0
                        ? 'None'
                        : selectedAffects.length <= 2
                          ? selectedAffects.map((v) => v.name).join(', ')
                          : `${selectedAffects.length} selected`}
                    </span>
                    <span className="text-[10px] text-[color:var(--text-muted)]">{affectsOpen ? '▲' : '▼'}</span>
                  </button>
                  {affectsOpen && (
                    <div className="absolute z-30 mt-1 w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] shadow-xl p-1 max-h-56 overflow-auto">
                      {project.versions.map((v) => {
                        const checked = form.affectsVersions.includes(v.id);
                        return (
                          <label
                            key={v.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-[color:var(--bg-page)] transition-colors"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setForm((f) => {
                                  const set = new Set(f.affectsVersions);
                                  if (e.target.checked) set.add(v.id);
                                  else set.delete(v.id);
                                  return { ...f, affectsVersions: Array.from(set) };
                                });
                              }}
                              className="accent-[color:var(--accent)]"
                            />
                            <span className="text-xs text-[color:var(--text-primary)]">{v.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
                <p className="text-[color:var(--text-muted)] text-[11px] mt-1">Select one or more versions from the dropdown.</p>
              </div>
            </div>
          )}
          {project?.customFields?.length ? (
            <div className="space-y-3 pt-2 border-t border-[color:var(--border-subtle)]">
              <p className="text-xs text-[color:var(--text-muted)]">Custom fields</p>
              {project.customFields.map((field) => {
                const val = form.customFieldValues[field.key];
                const value = val === undefined || val === null ? '' : String(val);
                return (
                  <div key={field.id}>
                    <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-1">{field.label}{field.required ? ' *' : ''}</label>
                    {field.fieldType === 'text' && <input type="text" value={value} onChange={(e) => setForm((f) => ({ ...f, customFieldValues: { ...f.customFieldValues, [field.key]: e.target.value || undefined } }))} required={field.required} className={inputCls} />}
                    {field.fieldType === 'number' && <input type="number" value={value} onChange={(e) => setForm((f) => ({ ...f, customFieldValues: { ...f.customFieldValues, [field.key]: e.target.value === '' ? undefined : Number(e.target.value) } }))} required={field.required} className={inputCls} />}
                    {field.fieldType === 'date' && (
                      <DateInputDDMMYYYY
                        value={typeof value === 'string' ? value : ''}
                        onChange={(iso) =>
                          setForm((f) => ({
                            ...f,
                            customFieldValues: { ...f.customFieldValues, [field.key]: iso || undefined },
                          }))
                        }
                        allowEmpty={!field.required}
                        className={inputCls}
                      />
                    )}
                    {field.fieldType === 'select' && (
                      <select value={value} onChange={(e) => setForm((f) => ({ ...f, customFieldValues: { ...f.customFieldValues, [field.key]: e.target.value || undefined } }))} required={field.required} className={inputCls}>
                        <option value="">—</option>
                        {(field.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    )}
                    {field.fieldType === 'multiselect' && (
                      <select
                        multiple
                        value={Array.isArray(val) ? val : value ? [value] : []}
                        onChange={(e) => {
                          const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                          setForm((f) => ({ ...f, customFieldValues: { ...f.customFieldValues, [field.key]: selected.length ? selected : undefined } }));
                        }}
                        className={inputCls}
                      >
                        {(field.options ?? []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    )}
                    {field.fieldType === 'user' && (
                      <select value={value} onChange={(e) => setForm((f) => ({ ...f, customFieldValues: { ...f.customFieldValues, [field.key]: e.target.value || undefined } }))} required={field.required} className={inputCls}>
                        <option value="">—</option>
                        {users.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
          {modal === 'create' && onPendingFilesChange && (
            <div className="pt-2 border-t border-[color:var(--border-subtle)]">
              <label className="block text-xs font-medium text-[color:var(--text-primary)] mb-2">Attachments</label>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPTED_FILE_TYPES}
                className="hidden"
                onChange={handleFileSelect}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-xs px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] transition-colors"
              >
                + Add files
              </button>
              <p className="text-[11px] text-[color:var(--text-muted)] mt-1">Images, videos, PDF, Excel, Word</p>
              {pendingFiles.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {pendingFiles.map((file, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 text-xs px-2 py-1 rounded bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)]">
                      <span className="truncate text-[color:var(--text-primary)]">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="shrink-0 text-[color:var(--text-muted)] hover:text-red-400 transition-colors"
                        aria-label="Remove file"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModal(null)}
              className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-transparent text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-3 py-1.5 rounded-md border border-indigo-600 bg-indigo-600 text-xs font-medium text-white hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-100 transition-colors shadow-sm"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
