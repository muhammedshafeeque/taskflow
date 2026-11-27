import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api, hrmsApi, type HrmsEmployee } from '../../lib/api';
import { canAny } from '../../utils/moduleAccess';
import type { Row } from '../../components/CrudPage';
import { PersonSelect, toPeople } from '../../components/people';
import { Field, GhostButton, Modal, PrimaryButton, Select, TextInput } from '../../components/moduleKit';
import { payAccessOf } from '@shared/constants/payAccess';

type Hired = {
  employee: { employeeCode: string; name: string };
  checklist: { tasks: unknown[] } | null;
  account?: { status: 'created' | 'linked' | 'requested' | 'none' | 'failed'; message?: string; role?: { applied: boolean; message?: string } };
};

/** Turns a candidate into an employee and starts their onboarding. */
export default function HireModal({ candidate, job, onClose, onHired }: { candidate: Row; job: Row; onClose: () => void; onHired: () => void }) {
  const { token, user } = useAuth();
  const canSetPay = payAccessOf((p) => canAny(user, p)).set;
  const canSeeTemplates = canAny(user, 'taskflow.hr.onboarding.read', 'taskflow.hr.onboarding.manage');
  const canPickManager = canAny(user, 'taskflow.hr.employee.list', 'taskflow.hr.employee.read');
  const canCreateAccounts = user?.role === 'admin' || canAny(user, 'auth.user.create');
  const [roles, setRoles] = useState<Array<{ _id: string; name: string }>>([]);
  const [account, setAccount] = useState<{ action: 'none' | 'request' | 'create'; roleId: string }>({ action: candidate.email ? (canCreateAccounts ? 'create' : 'request') : 'none', roleId: '' });
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
    if (!token) return;
    let live = true;
    void api.get<Array<{ _id: string; name: string }>>('/hrms/hire/account-roles', token).then((r) => {
      if (live && Array.isArray(r.data)) setRoles(r.data);
    });
    return () => {
      live = false;
    };
  }, [token]);

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
    if (account.action === 'create' && !account.roleId) return setError('Choose the role for the new account.');
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
        account: account.action === 'none' ? undefined : { action: account.action, roleId: account.roleId || undefined },
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
        <AccountOutcome account={hired.account} />
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
      <Field label="Sign-in account">
        {candidate.email ? (
          <div className="space-y-2">
            <Select value={account.action} onChange={(e) => setAccount({ ...account, action: e.target.value as typeof account.action })}>
              {canCreateAccounts && <option value="create">Create the account now</option>}
              <option value="request">Ask someone who adds users to create it</option>
              <option value="none">No account</option>
            </Select>
            {account.action !== 'none' && (
              <Select value={account.roleId} onChange={(e) => setAccount({ ...account, roleId: e.target.value })} aria-label="Role for the account">
                <option value="">{account.action === 'create' ? 'Choose a role…' : 'Suggested role (optional)'}</option>
                {roles.map((r) => (
                  <option key={r._id} value={r._id}>{r.name}</option>
                ))}
              </Select>
            )}
            <p className="text-[11px] text-[color:var(--text-muted)]">Uses {String(candidate.email)}. An account that already exists with this email is linked instead.</p>
          </div>
        ) : (
          <p className="text-xs text-[color:var(--text-muted)]">Add the candidate's email to set up their account.</p>
        )}
      </Field>
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

/** What happened with the new hire's account (AUT-35). */
function AccountOutcome({ account }: { account?: Hired['account'] }) {
  if (!account || account.status === 'none') {
    return <p className="text-xs text-[color:var(--text-muted)]">No sign-in account was set up. Someone who adds users can create it in Users.</p>;
  }
  const text: Record<string, string> = {
    created: 'Their sign-in account was created and linked; they get an email to set a password.',
    linked: 'Their existing sign-in account is now linked to the employee record.',
    requested: 'People who add users were asked to create their account; it links to this employee when created.',
    failed: 'The account could not be set up.',
  };
  return (
    <div className={`text-xs space-y-1 ${account.status === 'failed' ? 'text-amber-500' : 'text-[color:var(--text-muted)]'}`} role="status">
      <p>{text[account.status]}</p>
      {account.message && account.status !== 'created' && <p>{account.message}</p>}
      {account.role?.applied === false && account.role.message && <p>{account.role.message}</p>}
    </div>
  );
}
