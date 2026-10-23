import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiDownload, FiEdit2, FiSettings, FiUsers } from 'react-icons/fi';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { downloadCsv } from '../../lib/exportCsv';
import { resourcesApi, type ResourceProfileRow, type ResourceSettingsRow } from '../../lib/api';
import {
  Chip,
  DEFAULT_SETTINGS,
  EmptyState,
  ErrorBanner,
  Field,
  LoadBar,
  LoadingBlock,
  Modal,
  PageShell,
  Stat,
  Toast,
  btnPrimary,
  btnSecondary,
  errorOf,
  fmtShort,
  inputCls,
  refName,
  todayKey,
  toInputDate,
} from './resourceKit';

function splitSkills(v: string): string[] {
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function ResourcesTeam() {
  const { token, user } = useAuth();
  const canEdit = canAny(user, 'taskflow.resources.profile.manage', 'taskflow.resources.allocation.manage');
  const canSettings = canAny(user, 'taskflow.resources.settings.manage', 'taskflow.resources.allocation.manage');
  const workspaceKey = user?.activeOrganizationId ?? '';
  const [rows, setRows] = useState<ResourceProfileRow[]>([]);
  const [settings, setSettings] = useState<ResourceSettingsRow>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [skill, setSkill] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ResourceProfileRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([resourcesApi.listProfiles(token), resourcesApi.settings(token)]).then(([p, s]) => {
      setLoading(false);
      if (p.success && p.data) {
        setRows(Array.isArray(p.data) ? p.data : []);
        setError('');
      } else setError(errorOf(p, 'Failed to load team'));
      if (s.success && s.data) setSettings({ ...DEFAULT_SETTINGS, ...s.data });
    });
  }, [token]);

  useEffect(() => {
    load();
    setSelected(new Set());
  }, [load, workspaceKey]);

  const departments = useMemo(() => [...new Set(rows.map((r) => r.department).filter(Boolean) as string[])].sort(), [rows]);
  const allSkills = useMemo(() => [...new Set(rows.flatMap((r) => r.skills))].sort((a, b) => a.localeCompare(b)), [rows]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sk = skill.toLowerCase();
    return rows.filter((r) => {
      if (department && r.department !== department) return false;
      if (sk && !r.skills.some((s) => s.toLowerCase() === sk)) return false;
      if (!q) return true;
      return `${r.name} ${r.email} ${r.department ?? ''} ${r.seniority ?? ''} ${r.location ?? ''} ${r.skills.join(' ')}`.toLowerCase().includes(q);
    });
  }, [rows, search, department, skill]);

  const summary = useMemo(() => {
    const capacity = rows.reduce((s, r) => s + r.capacityHoursPerWeek, 0);
    return {
      capacity,
      fte: Math.round((capacity / Math.max(1, settings.defaultCapacityHoursPerWeek)) * 10) / 10,
      noSkills: rows.filter((r) => r.skills.length === 0).length,
      unavailable: rows.filter((r) => r.availableFrom && toInputDate(r.availableFrom) > todayKey()).length,
    };
  }, [rows, settings.defaultCapacityHoursPerWeek]);

  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.userId));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((s) => {
      const next = new Set(s);
      if (allShownSelected) shown.forEach((r) => next.delete(r.userId));
      else shown.forEach((r) => next.add(r.userId));
      return next;
    });
  }

  function exportCsv() {
    downloadCsv('team-capacity', shown, [
      { header: 'Person', value: (r) => r.name },
      { header: 'Email', value: (r) => r.email },
      { header: 'Department', value: (r) => r.department },
      { header: 'Seniority', value: (r) => r.seniority },
      { header: 'Location', value: (r) => r.location },
      { header: 'Hours / week', value: (r) => r.capacityHoursPerWeek },
      { header: 'Committed %', value: (r) => r.committedPercent },
      { header: 'Skills', value: (r) => r.skills.join('; ') },
      { header: 'Available from', value: (r) => toInputDate(r.availableFrom) },
    ]);
  }

  return (
    <PageShell
      title="Team capacity"
      description="Weekly capacity, skills and availability that every planning screen uses."
      actions={
        <>
          <button type="button" className={btnSecondary} onClick={exportCsv} disabled={shown.length === 0}>
            <FiDownload /> Export
          </button>
          {canSettings && (
            <button type="button" className={btnSecondary} onClick={() => setSettingsOpen(true)}>
              <FiSettings /> Planning settings
            </button>
          )}
        </>
      }
    >
      {error && <ErrorBanner message={error} onRetry={load} />}
      {loading && rows.length === 0 ? (
        <LoadingBlock label="Loading team…" />
      ) : (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Stat label="People" value={rows.length} hint={`${departments.length} department${departments.length === 1 ? '' : 's'}`} />
            <Stat label="Weekly capacity" value={`${summary.capacity.toLocaleString()}h`} hint={`≈ ${summary.fte} FTE at ${settings.defaultCapacityHoursPerWeek}h`} />
            <Stat label="Without skills" value={summary.noSkills} tone={summary.noSkills ? 'warn' : 'good'} hint="can't be skill-matched" />
            <Stat label="Not yet available" value={summary.unavailable} hint="start date in the future" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEdit && selected.size > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-[color:var(--accent)]/40 bg-[color:var(--accent-subtle)] px-3 py-1.5 text-xs">
                <span>{selected.size} selected</span>
                <button type="button" className="inline-flex items-center gap-1 font-medium text-[color:var(--accent)] hover:underline" onClick={() => setBulkOpen(true)}>
                  <FiUsers /> Bulk edit
                </button>
                <button type="button" className="text-[color:var(--text-muted)] hover:underline" onClick={() => setSelected(new Set())}>
                  Clear
                </button>
              </div>
            )}
            <div className="flex flex-1 flex-wrap justify-end gap-2">
              {departments.length > 0 && (
                <select value={department} onChange={(e) => setDepartment(e.target.value)} className={`${inputCls} w-auto py-1.5`} aria-label="Department">
                  <option value="">All departments</option>
                  {departments.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              )}
              {allSkills.length > 0 && (
                <select value={skill} onChange={(e) => setSkill(e.target.value)} className={`${inputCls} w-auto py-1.5`} aria-label="Skill">
                  <option value="">Any skill</option>
                  {allSkills.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              )}
              <input type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputCls} w-44 py-1.5`} />
            </div>
          </div>

          {shown.length === 0 ? (
            <EmptyState title={rows.length === 0 ? 'No active members in this workspace' : 'No people match'} />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[color:var(--border-subtle)] text-left text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
                    {canEdit && (
                      <th className="pl-4 py-2.5 w-8">
                        <input type="checkbox" checked={allShownSelected} onChange={toggleAll} aria-label="Select all shown" />
                      </th>
                    )}
                    <th className="px-4 py-2.5 font-medium">Person</th>
                    <th className="px-3 py-2.5 font-medium">Committed now</th>
                    <th className="px-3 py-2.5 font-medium text-right">Hours / wk</th>
                    <th className="px-3 py-2.5 font-medium">Projects</th>
                    <th className="px-3 py-2.5 font-medium">Skills</th>
                    {canEdit && <th className="px-4 py-2.5" />}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const notYet = r.availableFrom && toInputDate(r.availableFrom) > todayKey();
                    return (
                      <tr key={r.userId} className={`border-b border-[color:var(--border-subtle)]/60 align-top ${selected.has(r.userId) ? 'bg-[color:var(--accent-subtle)]/40' : ''}`}>
                        {canEdit && (
                          <td className="pl-4 py-3">
                            <input type="checkbox" checked={selected.has(r.userId)} onChange={() => toggle(r.userId)} aria-label={`Select ${r.name}`} />
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <div className="font-medium">{r.name}</div>
                          <div className="text-[11px] text-[color:var(--text-muted)]">
                            {[r.seniority, r.department, r.location].filter(Boolean).join(' · ') || r.email}
                          </div>
                          {notYet && <div className="text-[11px] text-amber-400">Available from {fmtShort(r.availableFrom)}</div>}
                        </td>
                        <td className="px-3 py-3 w-44">
                          <LoadBar hard={r.committedPercent ?? 0} soft={r.softPercent ?? 0} settings={settings} />
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {r.capacityHoursPerWeek}h
                          {r.capacityHoursPerWeek !== settings.defaultCapacityHoursPerWeek && <span className="block text-[10px] text-[color:var(--text-muted)]">custom</span>}
                        </td>
                        <td className="px-3 py-3 text-xs">
                          {(r.activeProjects ?? []).length === 0 ? (
                            <span className="text-[color:var(--text-muted)]">—</span>
                          ) : (
                            <ul className="space-y-0.5">
                              {r.activeProjects!.map((p) => (
                                <li key={`${p.id}-${p.percent}`}>
                                  {refName({ name: p.name, key: p.key })} <span className="tabular-nums text-[color:var(--text-muted)]">{p.percent}%</span>
                                  {p.softBooked && <span className="text-amber-400"> soft</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                          {(r.upcomingCount ?? 0) > 0 && (
                            <Link to={`/resources/allocations?userId=${r.userId}&status=upcoming`} className="text-[11px] text-[color:var(--accent)] hover:underline">
                              +{r.upcomingCount} upcoming
                            </Link>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {r.skills.length === 0 ? <span className="text-[color:var(--text-muted)]">—</span> : r.skills.map((s) => <Chip key={s}>{s}</Chip>)}
                          </div>
                        </td>
                        {canEdit && (
                          <td className="px-4 py-3 text-right">
                            <button type="button" className="p-1.5 rounded-md hover:bg-[color:var(--bg-elevated)]" title="Edit profile" aria-label="Edit profile" onClick={() => setEditing(r)}>
                              <FiEdit2 />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {token && (
        <>
          <ProfileModal
            row={editing}
            token={token}
            skills={allSkills}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              setToast('Profile saved.');
              load();
            }}
          />
          <BulkModal
            open={bulkOpen}
            count={selected.size}
            userIds={[...selected]}
            departments={departments}
            token={token}
            onClose={() => setBulkOpen(false)}
            onSaved={(m) => {
              setBulkOpen(false);
              setSelected(new Set());
              setToast(m);
              load();
            }}
          />
          <SettingsModal
            open={settingsOpen}
            settings={settings}
            token={token}
            onClose={() => setSettingsOpen(false)}
            onSaved={(s) => {
              setSettingsOpen(false);
              setSettings({ ...DEFAULT_SETTINGS, ...s });
              setToast('Planning settings saved for this workspace.');
              load();
            }}
          />
        </>
      )}
      <Toast message={toast} onDone={() => setToast('')} />
    </PageShell>
  );
}

function ProfileModal({
  row,
  token,
  skills,
  onClose,
  onSaved,
}: {
  row: ResourceProfileRow | null;
  token: string;
  skills: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({ capacityHoursPerWeek: 40, skills: '', seniority: '', department: '', location: '', availableFrom: '', notes: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!row) return;
    setForm({
      capacityHoursPerWeek: row.capacityHoursPerWeek,
      skills: row.skills.join(', '),
      seniority: row.seniority ?? '',
      department: row.department ?? '',
      location: row.location ?? '',
      availableFrom: toInputDate(row.availableFrom),
      notes: row.notes ?? '',
    });
    setError('');
  }, [row]);

  const set = (k: keyof typeof form, v: string | number) => setForm((f) => ({ ...f, [k]: v }));
  const current = splitSkills(form.skills).map((s) => s.toLowerCase());
  const suggestions = skills.filter((s) => !current.includes(s.toLowerCase())).slice(0, 12);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!row) return;
    setSaving(true);
    setError('');
    const res = await resourcesApi.upsertProfile(
      {
        userId: row.userId,
        capacityHoursPerWeek: Number(form.capacityHoursPerWeek),
        skills: splitSkills(form.skills),
        seniority: form.seniority,
        department: form.department,
        location: form.location,
        availableFrom: form.availableFrom || null,
        notes: form.notes,
      },
      token
    );
    setSaving(false);
    if (!res.success) {
      setError(errorOf(res, 'Failed to save profile'));
      return;
    }
    onSaved();
  }

  return (
    <Modal open={!!row} onClose={onClose} title="Edit profile" subtitle={row ? `${row.name} · ${row.email}` : undefined}>
      <form onSubmit={save} className="space-y-3">
        {error && <ErrorBanner message={error} />}
        <div className="grid gap-3 grid-cols-2">
          <Field label="Hours / week">
            <input type="number" min={1} max={168} step="0.5" required value={form.capacityHoursPerWeek} onChange={(e) => set('capacityHoursPerWeek', Number(e.target.value))} className={inputCls} />
          </Field>
          <Field label="Available from" hint="Leave empty if available now.">
            <input type="date" value={form.availableFrom} onChange={(e) => set('availableFrom', e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="Skills" hint="Comma-separated.">
          <input value={form.skills} onChange={(e) => set('skills', e.target.value)} className={inputCls} />
        </Field>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1 -mt-1">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className="rounded px-1.5 py-0.5 text-[10px] border border-dashed border-[color:var(--border-subtle)] text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"
                onClick={() => set('skills', [...splitSkills(form.skills), s].join(', '))}
              >
                + {s}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-3 grid-cols-3">
          <Field label="Department">
            <input value={form.department} onChange={(e) => set('department', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Seniority">
            <input value={form.seniority} onChange={(e) => set('seniority', e.target.value)} className={inputCls} />
          </Field>
          <Field label="Location">
            <input value={form.location} onChange={(e) => set('location', e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={inputCls} />
        </Field>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving} className={`${btnPrimary} px-4 py-2`}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className={`${btnSecondary} px-4 py-2`} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function BulkModal({
  open,
  count,
  userIds,
  departments,
  token,
  onClose,
  onSaved,
}: {
  open: boolean;
  count: number;
  userIds: string[];
  departments: string[];
  token: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const blank = { capacity: '', department: '', seniority: '', location: '', addSkills: '', removeSkills: '' };
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(blank);
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, unknown> = { userIds };
    if (form.capacity !== '') body.capacityHoursPerWeek = Number(form.capacity);
    if (form.department.trim()) body.department = form.department;
    if (form.seniority.trim()) body.seniority = form.seniority;
    if (form.location.trim()) body.location = form.location;
    if (form.addSkills.trim()) body.addSkills = splitSkills(form.addSkills);
    if (form.removeSkills.trim()) body.removeSkills = splitSkills(form.removeSkills);
    if (Object.keys(body).length === 1) {
      setError('Fill in at least one field to change.');
      return;
    }
    setSaving(true);
    setError('');
    const res = await resourcesApi.bulkUpdateProfiles(body, token);
    setSaving(false);
    if (!res.success || !res.data) {
      setError(errorOf(res, 'Bulk update failed'));
      return;
    }
    onSaved(`Updated ${res.data.updated} profile${res.data.updated === 1 ? '' : 's'}${res.data.skipped ? ` (${res.data.skipped} skipped — no longer members)` : ''}.`);
  }

  return (
    <Modal open={open} onClose={onClose} title={`Bulk edit ${count} ${count === 1 ? 'person' : 'people'}`} subtitle="Only the fields you fill in are changed.">
      <form onSubmit={save} className="space-y-3">
        {error && <ErrorBanner message={error} />}
        <div className="grid gap-3 grid-cols-2">
          <Field label="Hours / week">
            <input type="number" min={1} max={168} step="0.5" value={form.capacity} onChange={(e) => set('capacity', e.target.value)} className={inputCls} placeholder="unchanged" />
          </Field>
          <Field label="Department">
            <input list="bulk-departments" value={form.department} onChange={(e) => set('department', e.target.value)} className={inputCls} placeholder="unchanged" />
            <datalist id="bulk-departments">
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>
          <Field label="Seniority">
            <input value={form.seniority} onChange={(e) => set('seniority', e.target.value)} className={inputCls} placeholder="unchanged" />
          </Field>
          <Field label="Location">
            <input value={form.location} onChange={(e) => set('location', e.target.value)} className={inputCls} placeholder="unchanged" />
          </Field>
        </div>
        <Field label="Add skills" hint="Comma-separated; kept alongside existing skills.">
          <input value={form.addSkills} onChange={(e) => set('addSkills', e.target.value)} className={inputCls} />
        </Field>
        <Field label="Remove skills">
          <input value={form.removeSkills} onChange={(e) => set('removeSkills', e.target.value)} className={inputCls} />
        </Field>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving} className={`${btnPrimary} px-4 py-2`}>
            {saving ? 'Saving…' : 'Apply'}
          </button>
          <button type="button" className={`${btnSecondary} px-4 py-2`} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

type NumKey = Exclude<keyof ResourceSettingsRow, 'includePendingStageEstimates'>;

const SETTING_FIELDS: Array<{ key: NumKey; label: string; hint: string; min: number; max: number; step?: number; nullable?: boolean }> = [
  { key: 'defaultCapacityHoursPerWeek', label: 'Default hours / week', hint: 'Used for anyone without a custom capacity.', min: 1, max: 168, step: 0.5 },
  { key: 'benchThresholdPct', label: 'Bench below (%)', hint: 'Committed under this counts as bench.', min: 0, max: 100 },
  { key: 'busyThresholdPct', label: 'Fully booked from (%)', hint: 'Shown as busy at or above this.', min: 1, max: 200 },
  { key: 'overAllocationPct', label: 'Over-allocated above (%)', hint: 'Conflicts are raised past this limit.', min: 1, max: 300 },
  { key: 'forecastHorizonWeeks', label: 'Forecast horizon (weeks)', hint: 'How far ahead the forecast looks.', min: 1, max: 52 },
  { key: 'conflictLookaheadDays', label: 'Conflict look-ahead (days)', hint: 'How far ahead conflicts are checked.', min: 1, max: 366 },
  { key: 'freeingSoonDays', label: '“Rolling off” window (days)', hint: 'Allocations ending within this are flagged.', min: 1, max: 366 },
  { key: 'hoursPerStoryPoint', label: 'Hours per story point', hint: 'Empty = off. Used for engagement.', min: 0, max: 200, step: 0.5, nullable: true },
  { key: 'defaultTaskHours', label: 'Hours for unestimated tasks', hint: 'Empty = off. Used for engagement.', min: 0, max: 200, step: 0.5, nullable: true },
];

function SettingsModal({
  open,
  settings,
  token,
  onClose,
  onSaved,
}: {
  open: boolean;
  settings: ResourceSettingsRow;
  token: string;
  onClose: () => void;
  onSaved: (s: ResourceSettingsRow) => void;
}) {
  const [form, setForm] = useState<Record<NumKey, string>>({} as Record<NumKey, string>);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next = {} as Record<NumKey, string>;
    SETTING_FIELDS.forEach((f) => (next[f.key] = settings[f.key] == null ? '' : String(settings[f.key])));
    setForm(next);
    setPending(settings.includePendingStageEstimates);
    setError('');
  }, [open, settings]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body: Partial<ResourceSettingsRow> = { includePendingStageEstimates: pending };
    for (const f of SETTING_FIELDS) {
      const raw = form[f.key] ?? '';
      if (raw === '') {
        if (!f.nullable) {
          setError(`${f.label} is required.`);
          return;
        }
        (body as Record<string, unknown>)[f.key] = null;
      } else (body as Record<string, unknown>)[f.key] = Number(raw);
    }
    if ((body.benchThresholdPct ?? 0) >= (body.busyThresholdPct ?? 0)) {
      setError('The bench threshold must be lower than the fully-booked threshold.');
      return;
    }
    setSaving(true);
    setError('');
    const res = await resourcesApi.updateSettings(body, token);
    setSaving(false);
    if (!res.success || !res.data) {
      setError(errorOf(res, 'Failed to save settings'));
      return;
    }
    onSaved(res.data);
  }

  return (
    <Modal open={open} onClose={onClose} title="Planning settings" subtitle="Applies to every resource screen in this workspace." width="max-w-2xl">
      <form onSubmit={save} className="space-y-4">
        {error && <ErrorBanner message={error} />}
        <div className="grid gap-3 sm:grid-cols-2">
          {SETTING_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <input
                type="number"
                min={f.min}
                max={f.max}
                step={f.step ?? 1}
                required={!f.nullable}
                placeholder={f.nullable ? 'off' : undefined}
                value={form[f.key] ?? ''}
                onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
                className={inputCls}
              />
            </Field>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} />
          Count stage estimates still awaiting approval in engagement
        </label>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving} className={`${btnPrimary} px-4 py-2`}>
            {saving ? 'Saving…' : 'Save for workspace'}
          </button>
          <button type="button" className={`${btnSecondary} px-4 py-2`} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
