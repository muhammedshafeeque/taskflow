import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api, hrmsApi, type HrmsEmployee } from '../../lib/api';
import { canAny } from '../../utils/moduleAccess';
import type { Row } from '../../components/CrudPage';
import { PersonSelect, toPeople } from '../../components/people';
import { Field, GhostButton, Modal, PrimaryButton, Select, TextInput } from '../../components/moduleKit';
import { payAccessOf } from '@shared/constants/payAccess';

type Hired = { employee: { employeeCode: string; name: string }; checklist: { tasks: unknown[] } | null };

/** Turns a candidate into an employee and starts their onboarding. */
export default function HireModal({ candidate, job, onClose, onHired }: { candidate: Row; job: Row; onClose: () => void; onHired: () => void }) {
  const { token, user } = useAuth();
  const canSetPay = payAccessOf((p) => canAny(user, p)).set;
  const canSeeTemplates = canAny(user, 'taskflow.hr.onboarding.read', 'taskflow.hr.onboarding.manage');
  const canPickManager = canAny(user, 'taskflow.hr.employee.list', 'taskflow.hr.employee.read');
  const [templates, setTemplates] = useState<Row[]>([]);
  const [managers, setManagers] = useState<HrmsEmployee[]>([]);
  const [form, setForm] = useState({
    joinedDate: new Date().toISOString().slice(0, 10),
    designation: String(job.title ?? ''),
    employeeCode: '',
    managerId: '',
    annualCtc: candidate.expectedSalary == null ? '' : String(candidate.expectedSalary),
    onboardingTemplateId: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hired, setHired] = useState<Hired | null>(null);

  useEffect(() => {
    if (!token || !canSeeTemplates) return;
    let live = true;
    void api.get<Row[]>('/hrms/checklist-templates?kind=onboarding', token).then((r) => {
      if (live && Array.isArray(r.data)) setTemplates(r.data.filter((t) => t.active !== false));
    });
    return () => {
      live = false;
    };
  }, [token, canSeeTemplates]);

  useEffect(() => {
    if (!token || !canPickManager) return;
    let live = true;
    void hrmsApi.listEmployees(token).then((r) => {
      if (live && r.success && r.data) setManagers(r.data.filter((e) => e.status !== 'terminated'));
    });
    return () => {
      live = false;
    };
  }, [token, canPickManager]);

  const submit = async () => {
    if (!token) return;
    setBusy(true);
    setError('');
    const r = await api.post<Hired>(
      `/hrms/candidates/${candidate._id}/hire`,
      {
        joinedDate: form.joinedDate,
        designation: form.designation || undefined,
        employeeCode: form.employeeCode || undefined,
        managerId: form.managerId || undefined,
        onboardingTemplateId: form.onboardingTemplateId || undefined,
        ...(canSetPay && form.annualCtc !== '' ? { annualCtc: Number(form.annualCtc), currency: job.currency || undefined } : {}),
      },
      token
    );
    setBusy(false);
    if (!r.success || !r.data) return setError(r.message ?? 'Could not hire');
    setHired(r.data);
    onHired();
  };

  if (hired) {
    return (
      <Modal title="Hired" onClose={onClose} footer={<PrimaryButton onClick={onClose}>Done</PrimaryButton>}>
        <p className="text-sm" role="status">
          {hired.employee.name} is now employee {hired.employee.employeeCode}.
          {hired.checklist ? ` Onboarding started with ${hired.checklist.tasks.length} task(s).` : ''}
        </p>
        <p className="text-xs text-[color:var(--text-muted)]">They still need a sign-in account: an administrator adds it in Users with the same email.</p>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Hire ${String(candidate.name)}`}
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={submit} disabled={busy || !form.joinedDate}>
            {busy ? 'Hiring…' : 'Hire'}
          </PrimaryButton>
        </>
      }
    >
      {error && (
        <p role="alert" className="text-xs text-rose-500">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Joining date">
          <TextInput type="date" value={form.joinedDate} onChange={(e) => setForm({ ...form, joinedDate: e.target.value })} />
        </Field>
        <Field label="Employee code">
          <TextInput value={form.employeeCode} placeholder="Automatic" onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} />
        </Field>
      </div>
      <Field label="Designation">
        <TextInput value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
      </Field>
      {canPickManager && (
        <Field label="Reports to">
          <PersonSelect
            value={form.managerId}
            onChange={(v) => setForm({ ...form, managerId: v })}
            people={toPeople(managers)}
            specialOptions={[{ value: '', label: 'No manager' }]}
            clearValue=""
            placeholder="Search employee…"
            aria-label="Reports to"
          />
        </Field>
      )}
      {canSetPay && (
        <Field label={`Annual CTC${job.currency ? ` (${String(job.currency)})` : ''}`}>
          <TextInput type="number" min={0} value={form.annualCtc} onChange={(e) => setForm({ ...form, annualCtc: e.target.value })} />
        </Field>
      )}
      {canSeeTemplates && (
        <Field label="Onboarding checklist">
          <Select value={form.onboardingTemplateId} onChange={(e) => setForm({ ...form, onboardingTemplateId: e.target.value })}>
            <option value="">None</option>
            {templates.map((t) => (
              <option key={String(t._id)} value={String(t._id)}>
                {String(t.name)}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Modal>
  );
}
