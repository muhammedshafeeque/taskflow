import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api, hrmsApi } from '../../lib/api';
import type { HrmsEmployee, HrmsLeaveRequest, HrmsAttendance } from '../../lib/api';
import {
  ExportButton, Field, GhostButton, Modal, PrimaryButton, Select, SectionPage, StatusPill, TextArea, TextInput, nameOf,
} from '../../components/moduleKit';
import { ModuleLoader } from '../../components/loaders/ModuleLoader';
import { PersonMultiSelect, PersonSelect, toPeople } from '../../components/people';
import HandoverModal from './HandoverModal';
import RecordLinksDrawer from '../../components/RecordLinksDrawer';
import { useRecordLinksParam } from '../../hooks/useRecordLinksParam';
import { Link } from 'react-router-dom';
import { canAny } from '../../utils/moduleAccess';
import { payAccessOf } from '@shared/constants/payAccess';

const statusTone: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'slate'> = {
  active: 'green', probation: 'blue', on_leave: 'amber', terminated: 'red',
  pending: 'amber', approved: 'green', rejected: 'red', cancelled: 'slate',
  present: 'green', remote: 'blue', half_day: 'amber', absent: 'red', holiday: 'slate',
};

function tableWrap(children: React.ReactNode) {
  return (
    <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

// ── Employees ────────────────────────────────────────────────────────────────
export function HrmsEmployees() {
  const [linksId, setLinksId] = useRecordLinksParam('employee');
  const { token, user } = useAuth();
  const pay = payAccessOf((p) => canAny(user, p));
  const [rows, setRows] = useState<HrmsEmployee[]>([]);
  const [editing, setEditing] = useState<Partial<HrmsEmployee> | null>(null);
  const [loading, setLoading] = useState(true);
  const [handover, setHandover] = useState<HrmsEmployee | null>(null);
  const [levels, setLevels] = useState<string[]>(['Intern', 'Junior', 'Senior', 'Lead', 'Manager']);
  useEffect(() => {
    if (!token) return;
    void api.get<{ levels?: string[] }>('/hrms/settings', token).then((r) => r.success && r.data?.levels?.length && setLevels(r.data.levels));
  }, [token]);

  const load = useCallback(() => {
    if (!token) return;
    hrmsApi.listEmployees(token).then((r) => {
      setLoading(false);
      if (r.success && r.data) setRows(r.data);
    });
  }, [token]);
  useEffect(load, [load]);

  const save = async () => {
    if (!token || !editing) return;
    const payload: Record<string, unknown> = { ...editing };
    // The server refuses these from people who may not set them, changed or not.
    if (!pay.set) {
      delete payload.annualCtc;
      delete payload.notes;
    }
    if (!pay.setRate) delete payload.hourlyCostRate;
    const res = editing._id ? await hrmsApi.updateEmployee(editing._id, payload, token) : await hrmsApi.createEmployee(payload, token);
    if (res.success) {
      const leaving = editing.status === 'terminated' && rows.find((r) => r._id === editing._id)?.status !== 'terminated';
      setEditing(null);
      load();
      if (leaving && res.data?._id) setHandover(res.data);
    } else alert(res.message);
  };
  const remove = async (id: string) => {
    if (!token || !confirm('Delete this employee?')) return;
    await hrmsApi.deleteEmployee(id, token);
    load();
  };

  return (
    <SectionPage
      title="Employees"
      subtitle="Directory, roles, and employment status. Employees can be linked to platform users for resource planning."
      toolbar={<div className="flex gap-2"><ExportButton rows={rows} filename="employees" columns={[
        { header: 'Code', value: (r) => r.employeeCode },
        { header: 'Name', value: (r) => r.name },
        { header: 'Email', value: (r) => r.email ?? '' },
        { header: 'Department', value: (r) => r.department ?? '' },
        { header: 'Designation', value: (r) => r.designation ?? '' },
        { header: 'Type', value: (r) => r.employmentType },
        { header: 'Status', value: (r) => r.status },
        { header: 'Leave balance', value: (r) => r.leaveBalanceDays ?? 0 },
      ]} /><PrimaryButton onClick={() => setEditing({ employmentType: 'full_time', status: 'active', currency: 'USD', leaveBalanceDays: 20 })}>+ Add employee</PrimaryButton></div>}
    >
      {loading ? (
        <ModuleLoader size="block" label="Loading employees…" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No employees yet. Add your first team member.</p>
      ) : (
        tableWrap(
          <>
            <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Employee</th>
                <th className="text-left px-4 py-2.5 font-medium">Department</th>
                <th className="text-left px-4 py-2.5 font-medium">Type</th>
                <th className="text-left px-4 py-2.5 font-medium">Status</th>
                <th className="text-right px-4 py-2.5 font-medium">Leave bal.</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e._id} className="border-t border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-page)]">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{e.name}</p>
                    <p className="text-[11px] text-[color:var(--text-muted)]">{e.employeeCode} · {e.designation || '—'}</p>
                  </td>
                  <td className="px-4 py-2.5">{e.department || '—'}</td>
                  <td className="px-4 py-2.5 capitalize">{e.employmentType.replace('_', ' ')}</td>
                  <td className="px-4 py-2.5"><StatusPill label={e.status} tone={statusTone[e.status]} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{e.leaveBalanceDays}d</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <Link to={`/employees/${e._id}`} className="text-[color:var(--accent)] hover:underline text-xs mr-3">360</Link>
                    <button onClick={() => setLinksId(e._id)} className="text-[color:var(--accent)] hover:underline text-xs mr-3">Links</button>
                    <button onClick={() => setEditing(e)} className="text-[color:var(--accent)] hover:underline text-xs mr-3">Edit</button>
                    <button onClick={() => setHandover(e)} className="text-[color:var(--accent)] hover:underline text-xs mr-3">Hand over</button>
                    <button onClick={() => remove(e._id)} className="text-rose-500 hover:underline text-xs">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </>
        )
      )}

      {editing && (
        <Modal
          title={editing._id ? 'Edit employee' : 'Add employee'}
          onClose={() => setEditing(null)}
          wide
          footer={<><GhostButton onClick={() => setEditing(null)}>Cancel</GhostButton><PrimaryButton onClick={save}>Save</PrimaryButton></>}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name"><TextInput value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Employee code"><TextInput value={editing.employeeCode ?? ''} placeholder={editing._id ? undefined : 'Automatic'} onChange={(e) => setEditing({ ...editing, employeeCode: e.target.value })} /></Field>
            <Field label="Email"><TextInput value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
            <Field label="Phone"><TextInput type="tel" value={editing.phone ?? ''} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></Field>
            <Field label="Department"><TextInput value={editing.department ?? ''} onChange={(e) => setEditing({ ...editing, department: e.target.value })} /></Field>
            <Field label="Designation"><TextInput value={editing.designation ?? ''} onChange={(e) => setEditing({ ...editing, designation: e.target.value })} /></Field>
            <Field label="Reports to">
              <PersonSelect
                value={editing.managerId ?? ''}
                onChange={(v) => setEditing({ ...editing, managerId: v })}
                people={toPeople(rows.filter((r) => r._id !== editing._id && (r.status !== 'terminated' || r._id === editing.managerId)))}
                specialOptions={[{ value: '', label: 'No manager' }]}
                clearValue=""
                placeholder="Search employee…"
                aria-label="Reports to"
              />
            </Field>
            <Field label="Level">
              <Select value={editing.level ?? ''} onChange={(e) => setEditing({ ...editing, level: e.target.value })}>
                <option value="">—</option>
                {levels.map((l) => <option key={l} value={l}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Mentor">
              <PersonSelect
                value={editing.mentorId ?? ''}
                onChange={(v) => setEditing({ ...editing, mentorId: v })}
                people={toPeople(rows.filter((r) => r._id !== editing._id && (r.status !== 'terminated' || r._id === editing.mentorId)))}
                specialOptions={[{ value: '', label: 'No mentor' }]}
                clearValue=""
                placeholder="Search employee…"
                aria-label="Mentor"
              />
            </Field>
            <Field label="Employment type">
              <Select value={editing.employmentType ?? 'full_time'} onChange={(e) => setEditing({ ...editing, employmentType: e.target.value })}>
                <option value="full_time">Full time</option><option value="part_time">Part time</option>
                <option value="contract">Contract</option><option value="intern">Intern</option>
              </Select>
            </Field>
            <Field label="Status">
              <Select value={editing.status ?? 'active'} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>
                <option value="active">Active</option><option value="probation">Probation</option>
                <option value="on_leave">On leave</option><option value="terminated">Terminated</option>
              </Select>
            </Field>
            <Field label="Joined date"><TextInput type="date" value={(editing.joinedDate ?? '').slice(0, 10)} onChange={(e) => setEditing({ ...editing, joinedDate: e.target.value })} /></Field>
            <Field label="Exit date (last working day)"><TextInput type="date" value={(editing.exitDate ?? '').slice(0, 10)} onChange={(e) => setEditing({ ...editing, exitDate: e.target.value })} /></Field>
            <Field label="Currency"><TextInput value={editing.currency ?? ''} maxLength={3} onChange={(e) => setEditing({ ...editing, currency: e.target.value.toUpperCase() })} /></Field>
            {pay.see && <Field label="Annual CTC"><TextInput disabled={!pay.set} type="number" value={editing.annualCtc ?? 0} onChange={(e) => setEditing({ ...editing, annualCtc: Number(e.target.value) })} /></Field>}
            {pay.seeRate && <Field label="Hourly cost (blank = from CTC)"><TextInput disabled={!pay.setRate} type="number" step="any" value={editing.hourlyCostRate ?? ''} onChange={(e) => setEditing({ ...editing, hourlyCostRate: e.target.value === '' ? null : Number(e.target.value) })} /></Field>}
            <Field label="Leave balance (days)"><TextInput type="number" value={editing.leaveBalanceDays ?? 20} onChange={(e) => setEditing({ ...editing, leaveBalanceDays: Number(e.target.value) })} /></Field>
            <Field label="Location"><TextInput value={editing.location ?? ''} onChange={(e) => setEditing({ ...editing, location: e.target.value })} /></Field>
          </div>
          {editing.status === 'terminated' && (
            <p className="mt-3 text-xs text-[color:var(--text-muted)]">
              Their sign-in closes when you save, or on the exit date if it is later. Run final pay first: terminated people are left out of payroll.
            </p>
          )}
        </Modal>
      )}
      {handover && <HandoverModal employee={handover} employees={rows} onClose={() => setHandover(null)} />}
      {linksId && (
        <RecordLinksDrawer type="employee" id={linksId} title={rows.find((r) => r._id === linksId)?.name} onClose={() => setLinksId(null)} />
      )}
    </SectionPage>
  );
}

// ── Attendance ─────────────────────────────────────────────────────────────
/** Attendance days are stored as that calendar day at UTC midnight. */
const dayLabel = (d: string) => new Date(d).toLocaleDateString(undefined, { timeZone: 'UTC' });

export function HrmsAttendance() {
  const { token } = useAuth();
  const [rows, setRows] = useState<HrmsAttendance[]>([]);
  const [employees, setEmployees] = useState<HrmsEmployee[]>([]);
  const [form, setForm] = useState<{ employeeIds: string[]; status: string; date: string }>({
    employeeIds: [], status: 'present', date: new Date().toLocaleDateString('en-CA'),
  });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const current = employees.filter((e) => e.status !== 'terminated');
  const load = useCallback(() => {
    if (!token) return;
    hrmsApi.listAttendance(token).then((r) => r.success && r.data && setRows(r.data));
    hrmsApi.listEmployees(token).then((r) => r.success && r.data && setEmployees(r.data));
  }, [token]);
  useEffect(load, [load]);
  const mark = async () => {
    if (!token) return;
    if (form.employeeIds.length === 0) return setMessage({ ok: false, text: 'Choose at least one employee' });
    setBusy(true);
    const res = await hrmsApi.markAttendanceBulk(form, token);
    setBusy(false);
    if (!res.success || !res.data) return setMessage({ ok: false, text: res.message ?? 'Could not mark attendance' });
    setMessage({ ok: true, text: `Marked ${res.data.marked} ${res.data.marked === 1 ? 'person' : 'people'} ${form.status.replace('_', ' ')} on ${dayLabel(`${form.date}T00:00:00Z`)}.` });
    setForm({ ...form, employeeIds: [] });
    load();
  };
  return (
    <SectionPage title="Attendance" subtitle="Mark one person or many for a day. Marking again for the same day replaces the earlier entry.">
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] items-end">
          <Field label="Employees">
            <PersonMultiSelect
              values={form.employeeIds}
              onChange={(v) => setForm({ ...form, employeeIds: v })}
              people={toPeople(current)}
              placeholder="Search employees…"
              aria-label="Employees"
            />
          </Field>
          <Field label="Date"><TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Status">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="present">Present</option><option value="remote">Remote</option>
              <option value="half_day">Half day</option><option value="absent">Absent</option><option value="holiday">Holiday</option>
            </Select>
          </Field>
          <PrimaryButton onClick={mark} disabled={busy}>{busy ? 'Marking…' : 'Mark'}</PrimaryButton>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button type="button" className="text-[color:var(--accent)] hover:underline" onClick={() => setForm({ ...form, employeeIds: current.map((e) => e._id) })}>
            Select everyone ({current.length})
          </button>
          {form.employeeIds.length > 0 && <span className="text-[color:var(--text-muted)]">{form.employeeIds.length} selected</span>}
          {message && <span role="status" className={message.ok ? 'text-emerald-600' : 'text-rose-500'}>{message.text}</span>}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No attendance recorded yet.</p>
      ) : (
        tableWrap(
          <>
            <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
              <tr><th className="text-left px-4 py-2.5 font-medium">Employee</th><th className="text-left px-4 py-2.5 font-medium">Date</th><th className="text-left px-4 py-2.5 font-medium">Status</th><th className="text-right px-4 py-2.5 font-medium">Hours</th></tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a._id} className="border-t border-[color:var(--border-subtle)]">
                  <td className="px-4 py-2.5">{nameOf(a.employeeId, 'Employee')}</td>
                  <td className="px-4 py-2.5 text-[color:var(--text-muted)]">{dayLabel(a.date)}</td>
                  <td className="px-4 py-2.5"><StatusPill label={a.status} tone={statusTone[a.status]} /></td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{a.hoursWorked}h</td>
                </tr>
              ))}
            </tbody>
          </>
        )
      )}
    </SectionPage>
  );
}

// ── Leave ────────────────────────────────────────────────────────────────────
type LeaveTypeOption = { _id: string; name: string; paid: boolean };
type Balance = { leaveTypeId: string; available: number | null };
const LEGACY_TYPES = ['annual', 'sick', 'casual', 'unpaid', 'comp_off'];
const today = () => new Date().toISOString().slice(0, 10);

/** Configured leave type of a request, else the old fixed type. */
const leaveTypeName = (l: HrmsLeaveRequest) =>
  l.leaveTypeId && typeof l.leaveTypeId === 'object' ? l.leaveTypeId.name : l.type.replace('_', ' ');

export function HrmsLeave() {
  const { token } = useAuth();
  const [rows, setRows] = useState<HrmsLeaveRequest[]>([]);
  const [employees, setEmployees] = useState<HrmsEmployee[]>([]);
  const [types, setTypes] = useState<LeaveTypeOption[] | null>(null);
  const [balances, setBalances] = useState<Balance[] | null>(null);
  const [creating, setCreating] = useState<{ employeeId: string; leaveType: string; startDate: string; endDate: string; halfDay: boolean; reason: string } | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!token) return;
    hrmsApi.listLeave(token).then((r) => r.success && r.data && setRows(r.data));
    hrmsApi.listEmployees(token).then((r) => r.success && r.data && setEmployees(r.data));
    api.get<LeaveTypeOption[]>('/hrms/leave-types?active=1', token).then((r) => setTypes(r.success && Array.isArray(r.data) ? r.data : []));
  }, [token]);
  useEffect(load, [load]);

  const employeeId = creating?.employeeId;
  useEffect(() => {
    if (!token || !employeeId) return;
    let live = true;
    void api.get<Balance[]>(`/hrms/employees/${employeeId}/balances`, token).then((r) => {
      if (live) setBalances(r.success && Array.isArray(r.data) ? r.data : null);
    });
    return () => {
      live = false;
    };
  }, [token, employeeId]);

  const configured = (types?.length ?? 0) > 0;
  const balance = configured && creating && employeeId ? balances?.find((b) => b.leaveTypeId === creating.leaveType) : undefined;

  const decide = async (id: string, status: string) => {
    if (!token) return;
    const r = await hrmsApi.decideLeave(id, status, token);
    setError(r.success ? '' : (r.message ?? 'Could not save the decision'));
    load();
  };
  const create = async () => {
    if (!token || !creating) return;
    if (!creating.employeeId) return setError('Choose an employee');
    const { leaveType, ...rest } = creating;
    const res = await hrmsApi.createLeave(configured ? { ...rest, leaveTypeId: leaveType } : { ...rest, type: leaveType }, token);
    if (res.success) {
      setCreating(null);
      setError('');
      load();
    } else setError(res.message ?? 'Could not save the request');
  };
  const open = () => {
    setBalances(null);
    setError('');
    setCreating({ employeeId: '', leaveType: configured ? types![0]._id : 'annual', startDate: today(), endDate: today(), halfDay: false, reason: '' });
  };

  return (
    <SectionPage
      title="Leave"
      subtitle="Requests, balances, and approvals. Approving paid leave deducts from the employee's balance for that leave type."
      toolbar={<PrimaryButton onClick={open} disabled={types === null}>+ Request leave</PrimaryButton>}
    >
      {error && !creating && <p role="alert" className="text-xs text-rose-500">{error}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No leave requests.</p>
      ) : (
        tableWrap(
          <>
            <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
              <tr><th className="text-left px-4 py-2.5 font-medium">Employee</th><th className="text-left px-4 py-2.5 font-medium">Type</th><th className="text-left px-4 py-2.5 font-medium">Dates</th><th className="text-right px-4 py-2.5 font-medium">Days</th><th className="text-left px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5" /></tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l._id} className="border-t border-[color:var(--border-subtle)]">
                  <td className="px-4 py-2.5">{nameOf(l.employeeId, 'Employee')}</td>
                  <td className="px-4 py-2.5 capitalize">{leaveTypeName(l)}</td>
                  <td className="px-4 py-2.5 text-[color:var(--text-muted)]">{new Date(l.startDate).toLocaleDateString()} – {new Date(l.endDate).toLocaleDateString()}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{l.days}</td>
                  <td className="px-4 py-2.5"><StatusPill label={l.status} tone={statusTone[l.status]} /></td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    {l.status === 'pending' && (
                      <>
                        <button onClick={() => decide(l._id, 'approved')} className="text-emerald-500 hover:underline text-xs mr-3">Approve</button>
                        <button onClick={() => decide(l._id, 'rejected')} className="text-rose-500 hover:underline text-xs">Reject</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </>
        )
      )}

      {creating && (
        <Modal title="Request leave" onClose={() => setCreating(null)} footer={<><GhostButton onClick={() => setCreating(null)}>Cancel</GhostButton><PrimaryButton onClick={create}>Submit</PrimaryButton></>}>
          {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
          <Field label="Employee">
            <PersonSelect
              value={creating.employeeId}
              onChange={(v) => {
                setBalances(null);
                setCreating({ ...creating, employeeId: v });
              }}
              people={toPeople(employees.filter((e) => e.status !== 'terminated'))}
              placeholder="Search employee…"
              aria-label="Employee"
            />
          </Field>
          <Field label="Type">
            <Select aria-label="Leave type" value={creating.leaveType} onChange={(e) => setCreating({ ...creating, leaveType: e.target.value })}>
              {configured
                ? types!.map((t) => <option key={t._id} value={t._id}>{t.name}{t.paid ? '' : ' (unpaid)'}</option>)
                : LEGACY_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </Select>
            {balance && (
              <p className="mt-1 text-xs text-[color:var(--text-muted)]" data-testid="leave-balance">
                {balance.available === null ? 'Unpaid: no balance' : `${balance.available} day(s) available`}
              </p>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><TextInput type="date" value={creating.startDate} onChange={(e) => setCreating({ ...creating, startDate: e.target.value })} /></Field>
            <Field label="To"><TextInput type="date" value={creating.endDate} onChange={(e) => setCreating({ ...creating, endDate: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={creating.halfDay} onChange={(e) => setCreating({ ...creating, halfDay: e.target.checked })} />
            Half day (one-day requests)
          </label>
          <Field label="Reason"><TextArea rows={2} value={creating.reason} onChange={(e) => setCreating({ ...creating, reason: e.target.value })} /></Field>
        </Modal>
      )}
    </SectionPage>
  );
}

// ── Payroll ──────────────────────────────────────────────────────────────────
// Payroll lives in its own file (runs, payslips, components).
export { HrmsPayroll } from './HrmsPayrollRuns';
