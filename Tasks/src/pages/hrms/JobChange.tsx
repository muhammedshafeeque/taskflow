import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { jobChangesApi, type HrmsEmployee, type JobChange, type JobState } from '../../lib/api';
import { Field, GhostButton, Modal, PrimaryButton, SectionPage, Select, StatusPill, TextArea, TextInput } from '../../components/moduleKit';
import { PersonSelect, toPeople } from '../../components/people';
import { canAny } from '../../utils/moduleAccess';
import { payAccessOf } from '@shared/constants/payAccess';

const KIND_LABEL: Record<JobChange['kind'], string> = {
  promotion: 'Promotion',
  transfer: 'Transfer',
  conversion: 'Intern conversion',
  salary: 'Pay change',
  change: 'Job change',
};
const STATUS_TONE: Record<JobChange['status'], 'amber' | 'blue' | 'green' | 'red' | 'slate'> = {
  pending: 'amber',
  scheduled: 'blue',
  applied: 'green',
  rejected: 'red',
  cancelled: 'slate',
  failed: 'red',
};
const TYPES = [
  ['full_time', 'Full time'],
  ['part_time', 'Part time'],
  ['contract', 'Contract'],
  ['intern', 'Intern'],
] as const;
const FIELD_LABEL: Record<string, string> = {
  designation: 'Job title',
  department: 'Department',
  level: 'Level',
  employmentType: 'Type',
  managerId: 'Reports to',
  annualCtc: 'Annual CTC',
  currency: 'Currency',
  roleId: 'Role',
  seniority: 'Resource seniority',
};
const today = () => new Date().toLocaleDateString('en-CA');
const nameOfRef = (v: unknown) => (v && typeof v === 'object' && 'name' in v ? String((v as { name: string }).name) : '');

/** "Level: Intern → Junior · Type: intern → full time" */
function describeChange(c: Pick<JobChange, 'to' | 'from'>, names: { roles?: Record<string, string>; people?: Record<string, string> } = {}) {
  const show = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '') return '—';
    if (k === 'roleId') return names.roles?.[String(v)] ?? 'another role';
    if (k === 'managerId') return names.people?.[String(v)] ?? 'someone else';
    if (k === 'annualCtc') return Number(v).toLocaleString();
    return String(v).replace(/_/g, ' ');
  };
  return Object.keys(c.to)
    .map((k) => `${FIELD_LABEL[k] ?? k}: ${c.from && k in c.from ? `${show(k, c.from[k as keyof JobState])} → ` : ''}${show(k, c.to[k as keyof JobState])}`)
    .join(' · ');
}

/** Propose a promotion, transfer, intern conversion or pay change for one person. */
export function JobChangeModal({
  employee,
  employees,
  levels,
  onClose,
  onDone,
}: {
  employee: HrmsEmployee;
  employees: HrmsEmployee[];
  levels: string[];
  onClose: () => void;
  onDone: (c: JobChange) => void;
}) {
  const { token, user } = useAuth();
  const pay = payAccessOf((p) => canAny(user, p));
  const [form, setForm] = useState<Record<string, string>>({
    designation: employee.designation ?? '',
    department: employee.department ?? '',
    level: employee.level ?? '',
    employmentType: employee.employmentType,
    managerId: employee.managerId ?? '',
    annualCtc: employee.annualCtc != null ? String(employee.annualCtc) : '',
    currency: employee.currency ?? '',
    roleId: '',
    effectiveDate: today(),
    reason: '',
  });
  const [projects, setProjects] = useState(true);
  const [roles, setRoles] = useState<Array<{ _id: string; name: string }> | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!token || !employee.userId) return;
    void jobChangesApi.roles(token).then((r) => r.success && Array.isArray(r.data) && setRoles(r.data));
  }, [token, employee.userId]);
  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  const submit = async () => {
    if (!token) return;
    const body: Record<string, unknown> = { employeeId: employee._id, effectiveDate: form.effectiveDate, reason: form.reason, updateProjectDesignations: projects };
    for (const k of ['designation', 'department', 'level', 'employmentType', 'managerId', 'roleId'] as const) if (form[k] !== '') body[k] = form[k];
    if (pay.set) {
      if (form.annualCtc !== '') body.annualCtc = Number(form.annualCtc);
      if (form.currency !== '') body.currency = form.currency;
    }
    setBusy(true);
    const r = await jobChangesApi.request(body, token);
    setBusy(false);
    if (!r.success || !r.data) return setError(r.message ?? 'Could not save');
    onDone(r.data);
  };

  return (
    <Modal
      title={`Change job — ${employee.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : 'Propose change'}
          </PrimaryButton>
        </>
      }
    >
      <p className="mb-3 text-xs text-[color:var(--text-muted)]">
        Change only what moves. On the effective date the employee record, their role, resource seniority and project designations are updated together, once approved.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job title"><TextInput value={form.designation} onChange={set('designation')} /></Field>
        <Field label="Department"><TextInput value={form.department} onChange={set('department')} /></Field>
        <Field label="Level">
          <Select value={form.level} onChange={set('level')} aria-label="Level">
            <option value="">—</option>
            {levels.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Employment type">
          <Select value={form.employmentType} onChange={set('employmentType')} aria-label="Employment type">
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Reports to">
          <PersonSelect
            value={form.managerId}
            onChange={(v) => setForm({ ...form, managerId: v })}
            people={toPeople(employees.filter((e) => e._id !== employee._id && e.status !== 'terminated'))}
            specialOptions={[{ value: '', label: 'Keep as is' }]}
            clearValue=""
            placeholder="Search employee…"
            aria-label="Reports to"
          />
        </Field>
        {roles && (
          <Field label="Role (sign-in access)">
            <Select value={form.roleId} onChange={set('roleId')} aria-label="Role">
              <option value="">Keep current role</option>
              {roles.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
            </Select>
          </Field>
        )}
        {pay.set && (
          <>
            <Field label="Annual CTC"><TextInput type="number" min={0} value={form.annualCtc} onChange={set('annualCtc')} /></Field>
            <Field label="Currency"><TextInput value={form.currency} onChange={set('currency')} maxLength={3} /></Field>
          </>
        )}
        <Field label="Effective date"><TextInput type="date" value={form.effectiveDate} onChange={set('effectiveDate')} aria-label="Effective date" /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={projects} onChange={(e) => setProjects(e.target.checked)} />
          Update project designations to match
        </label>
      </div>
      <div className="mt-3">
        <Field label="Reason"><TextArea rows={2} value={form.reason} onChange={set('reason')} placeholder="e.g. Annual review, finished internship" /></Field>
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">{error}</p>}
    </Modal>
  );
}

/** Job and salary history of one person, oldest first. */
export function JobHistoryModal({ employee, employees, onClose }: { employee: HrmsEmployee; employees: HrmsEmployee[]; onClose: () => void }) {
  const { token } = useAuth();
  const [data, setData] = useState<{ changes: JobChange[] } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!token) return;
    void jobChangesApi.history(employee._id, token).then((r) => (r.success && r.data ? setData(r.data) : setError(r.message ?? 'Could not load history')));
  }, [token, employee._id]);
  const people = Object.fromEntries(employees.map((e) => [e._id, e.name]));
  return (
    <Modal title={`History — ${employee.name}`} onClose={onClose} wide>
      <ol className="space-y-3 text-sm">
        <li className="text-xs text-[color:var(--text-muted)]">Joined {new Date(employee.joinedDate).toLocaleDateString()}</li>
        {error && <li className="text-red-500 text-xs">{error}</li>}
        {data?.changes.length === 0 && <li className="text-xs text-[color:var(--text-muted)]">No promotions, transfers or pay changes yet.</li>}
        {data?.changes.map((c) => (
          <li key={c._id} className="rounded-xl border border-[color:var(--border-subtle)] p-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">{KIND_LABEL[c.kind]}</span>
              <StatusPill label={c.status === 'applied' ? 'done' : c.status} tone={STATUS_TONE[c.status]} />
              <span className="ml-auto text-xs text-[color:var(--text-muted)]">{new Date(c.effectiveDate).toISOString().slice(0, 10)}</span>
            </div>
            <p className="mt-1 text-xs">{describeChange(c, { people })}</p>
            {c.projectChanges.length > 0 && (
              <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">Projects: {c.projectChanges.map((p) => `${p.projectName}: ${p.from ?? '—'} → ${p.to}`).join(', ')}</p>
            )}
            <p className="mt-1 text-[11px] text-[color:var(--text-muted)]">
              Proposed by {nameOfRef(c.requestedBy) || '—'}
              {c.decidedBy ? `, approved by ${nameOfRef(c.decidedBy)}` : ''}
              {c.reason ? ` — ${c.reason}` : ''}
            </p>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

/** HRMS → Job changes: what waits for approval, what is scheduled, and what was done. */
export function HrmsJobChanges() {
  const { token, user } = useAuth();
  const canApprove = canAny(user, 'taskflow.hr.job_change.approve');
  const [filter, setFilter] = useState('pending');
  const [rows, setRows] = useState<JobChange[] | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => {
    if (!token) return;
    void jobChangesApi.list(token, filter ? { status: filter } : {}).then((r) => setRows(r.success && Array.isArray(r.data) ? r.data : []));
  }, [token, filter]);
  useEffect(load, [load]);

  const act = async (c: JobChange, what: 'approve' | 'reject' | 'cancel') => {
    if (!token) return;
    const note = what === 'reject' ? window.prompt('Reason for rejecting (optional)') ?? '' : '';
    const r = what === 'cancel' ? await jobChangesApi.cancel(c._id, token) : await jobChangesApi.decide(c._id, what, note, token);
    if (!r.success || !r.data) return setMessage({ ok: false, text: r.message ?? 'Could not update' });
    setMessage({ ok: true, text: r.data.status === 'applied' ? 'Approved and applied.' : r.data.status === 'scheduled' ? `Approved; applies on ${r.data.effectiveDate.slice(0, 10)}.` : `Marked ${r.data.status}.` });
    load();
  };

  return (
    <SectionPage title="Job changes" subtitle="Promotions, transfers, intern conversions and pay changes. Propose one from Employees → Change job.">
      <div className="mb-3 flex flex-wrap gap-1.5 text-xs" role="tablist">
        {[
          ['pending', 'Waiting for approval'],
          ['scheduled', 'Scheduled'],
          ['applied', 'Done'],
          ['rejected,cancelled,failed', 'Rejected / cancelled / failed'],
          ['', 'All'],
        ].map(([v, l]) => (
          <button key={l} type="button" role="tab" aria-selected={filter === v} onClick={() => setFilter(v)} className={`rounded-full border px-3 py-1 ${filter === v ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/10' : 'border-[color:var(--border-subtle)]'}`}>
            {l}
          </button>
        ))}
      </div>
      {message && <p className={`mb-3 text-xs ${message.ok ? 'text-emerald-600' : 'text-red-500'}`}>{message.text}</p>}
      {rows === null ? (
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">Nothing here.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((c) => (
            <div key={c._id} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-3 text-sm" data-testid="job-change">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{nameOfRef(c.employeeId)}</span>
                <span className="text-xs text-[color:var(--text-muted)]">{KIND_LABEL[c.kind]}</span>
                <StatusPill label={c.status === 'applied' ? 'done' : c.status} tone={STATUS_TONE[c.status]} />
                <span className="ml-auto text-xs text-[color:var(--text-muted)]">from {c.effectiveDate.slice(0, 10)}</span>
              </div>
              <p className="mt-1 text-xs">{describeChange(c)}</p>
              {c.error && <p className="mt-1 text-xs text-red-500">{c.error}</p>}
              <div className="mt-1 flex items-center gap-3 text-[11px] text-[color:var(--text-muted)]">
                <span>Proposed by {nameOfRef(c.requestedBy) || '—'}{c.reason ? ` — ${c.reason}` : ''}</span>
                <span className="ml-auto flex gap-3">
                  {c.status === 'pending' && canApprove && (
                    <>
                      <button type="button" className="text-[color:var(--accent)] hover:underline" onClick={() => act(c, 'approve')}>Approve</button>
                      <button type="button" className="text-rose-500 hover:underline" onClick={() => act(c, 'reject')}>Reject</button>
                    </>
                  )}
                  {(c.status === 'pending' || c.status === 'scheduled') && (
                    <button type="button" className="hover:underline" onClick={() => act(c, 'cancel')}>Cancel</button>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionPage>
  );
}
