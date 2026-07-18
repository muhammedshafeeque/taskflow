import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { hrmsApi } from '../../lib/api';
import type { HrmsEmployee, HrmsLeaveRequest, HrmsAttendance } from '../../lib/api';
import {
  ExportButton, Field, GhostButton, Modal, PrimaryButton, Select, SectionPage, StatusPill, TextArea, TextInput, money, nameOf,
} from '../../components/moduleKit';

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
  const { token } = useAuth();
  const [rows, setRows] = useState<HrmsEmployee[]>([]);
  const [editing, setEditing] = useState<Partial<HrmsEmployee> | null>(null);
  const [loading, setLoading] = useState(true);

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
    const payload = { ...editing };
    const res = editing._id ? await hrmsApi.updateEmployee(editing._id, payload, token) : await hrmsApi.createEmployee(payload, token);
    if (res.success) {
      setEditing(null);
      load();
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
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
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
                    <button onClick={() => setEditing(e)} className="text-[color:var(--accent)] hover:underline text-xs mr-3">Edit</button>
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
            <Field label="Email"><TextInput value={editing.email ?? ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></Field>
            <Field label="Department"><TextInput value={editing.department ?? ''} onChange={(e) => setEditing({ ...editing, department: e.target.value })} /></Field>
            <Field label="Designation"><TextInput value={editing.designation ?? ''} onChange={(e) => setEditing({ ...editing, designation: e.target.value })} /></Field>
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
            <Field label="Annual CTC"><TextInput type="number" value={editing.annualCtc ?? 0} onChange={(e) => setEditing({ ...editing, annualCtc: Number(e.target.value) })} /></Field>
            <Field label="Leave balance (days)"><TextInput type="number" value={editing.leaveBalanceDays ?? 20} onChange={(e) => setEditing({ ...editing, leaveBalanceDays: Number(e.target.value) })} /></Field>
            <Field label="Location"><TextInput value={editing.location ?? ''} onChange={(e) => setEditing({ ...editing, location: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </SectionPage>
  );
}

// ── Attendance ─────────────────────────────────────────────────────────────
export function HrmsAttendance() {
  const { token } = useAuth();
  const [rows, setRows] = useState<HrmsAttendance[]>([]);
  const [employees, setEmployees] = useState<HrmsEmployee[]>([]);
  const [form, setForm] = useState<{ employeeId: string; status: string; hoursWorked: number; date: string }>({
    employeeId: '', status: 'present', hoursWorked: 8, date: new Date().toISOString().slice(0, 10),
  });

  const load = useCallback(() => {
    if (!token) return;
    hrmsApi.listAttendance(token).then((r) => r.success && r.data && setRows(r.data));
    hrmsApi.listEmployees(token).then((r) => r.success && r.data && setEmployees(r.data));
  }, [token]);
  useEffect(load, [load]);

  const mark = async () => {
    if (!token || !form.employeeId) return alert('Choose an employee');
    const res = await hrmsApi.markAttendance(form, token);
    if (res.success) load();
    else alert(res.message);
  };

  return (
    <SectionPage title="Attendance" subtitle="Log daily attendance and remote days.">
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 grid gap-3 sm:grid-cols-5 items-end">
        <Field label="Employee">
          <Select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
            <option value="">Select…</option>
            {employees.map((e) => <option key={e._id} value={e._id}>{e.name}</option>)}
          </Select>
        </Field>
        <Field label="Date"><TextInput type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="present">Present</option><option value="remote">Remote</option>
            <option value="half_day">Half day</option><option value="absent">Absent</option><option value="holiday">Holiday</option>
          </Select>
        </Field>
        <Field label="Hours"><TextInput type="number" value={form.hoursWorked} onChange={(e) => setForm({ ...form, hoursWorked: Number(e.target.value) })} /></Field>
        <PrimaryButton onClick={mark}>Mark</PrimaryButton>
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
                  <td className="px-4 py-2.5 text-[color:var(--text-muted)]">{new Date(a.date).toLocaleDateString()}</td>
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
export function HrmsLeave() {
  const { token } = useAuth();
  const [rows, setRows] = useState<HrmsLeaveRequest[]>([]);
  const [employees, setEmployees] = useState<HrmsEmployee[]>([]);
  const [creating, setCreating] = useState<{ employeeId: string; type: string; startDate: string; endDate: string; reason: string } | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    hrmsApi.listLeave(token).then((r) => r.success && r.data && setRows(r.data));
    hrmsApi.listEmployees(token).then((r) => r.success && r.data && setEmployees(r.data));
  }, [token]);
  useEffect(load, [load]);

  const decide = async (id: string, status: string) => {
    if (!token) return;
    await hrmsApi.decideLeave(id, status, token);
    load();
  };
  const create = async () => {
    if (!token || !creating) return;
    if (!creating.employeeId) return alert('Choose an employee');
    const res = await hrmsApi.createLeave(creating, token);
    if (res.success) { setCreating(null); load(); } else alert(res.message);
  };

  return (
    <SectionPage
      title="Leave"
      subtitle="Requests, balances, and approvals. Approving paid leave deducts from the employee's balance."
      toolbar={<PrimaryButton onClick={() => setCreating({ employeeId: '', type: 'annual', startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), reason: '' })}>+ Request leave</PrimaryButton>}
    >
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
                  <td className="px-4 py-2.5 capitalize">{l.type.replace('_', ' ')}</td>
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
          <Field label="Employee">
            <Select value={creating.employeeId} onChange={(e) => setCreating({ ...creating, employeeId: e.target.value })}>
              <option value="">Select…</option>
              {employees.map((e) => <option key={e._id} value={e._id}>{e.name}</option>)}
            </Select>
          </Field>
          <Field label="Type">
            <Select value={creating.type} onChange={(e) => setCreating({ ...creating, type: e.target.value })}>
              <option value="annual">Annual</option><option value="sick">Sick</option><option value="casual">Casual</option>
              <option value="unpaid">Unpaid</option><option value="comp_off">Comp off</option>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><TextInput type="date" value={creating.startDate} onChange={(e) => setCreating({ ...creating, startDate: e.target.value })} /></Field>
            <Field label="To"><TextInput type="date" value={creating.endDate} onChange={(e) => setCreating({ ...creating, endDate: e.target.value })} /></Field>
          </div>
          <Field label="Reason"><TextArea rows={2} value={creating.reason} onChange={(e) => setCreating({ ...creating, reason: e.target.value })} /></Field>
        </Modal>
      )}
    </SectionPage>
  );
}

// ── Payroll ──────────────────────────────────────────────────────────────────
export function HrmsPayroll() {
  const { token } = useAuth();
  const [data, setData] = useState<{ rows: Array<{ _id: string; name: string; employeeCode: string; department?: string; designation?: string; currency: string; monthly: number; annualCtc: number }>; total: number; count: number } | null>(null);

  useEffect(() => {
    if (!token) return;
    hrmsApi.payroll(token).then((r) => r.success && r.data && setData(r.data as never));
  }, [token]);

  return (
    <SectionPage title="Payroll" subtitle="Monthly payroll run derived from active employees' CTC.">
      {!data ? (
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      ) : (
        <>
          <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-5 py-4 flex flex-wrap gap-6">
            <div><p className="text-xs text-[color:var(--text-muted)]">Monthly total</p><p className="text-2xl font-bold">{money(data.total)}</p></div>
            <div><p className="text-xs text-[color:var(--text-muted)]">Employees</p><p className="text-2xl font-bold">{data.count}</p></div>
          </div>
          {data.rows.length === 0 ? (
            <p className="text-sm text-[color:var(--text-muted)]">No active employees.</p>
          ) : (
            tableWrap(
              <>
                <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
                  <tr><th className="text-left px-4 py-2.5 font-medium">Employee</th><th className="text-left px-4 py-2.5 font-medium">Department</th><th className="text-right px-4 py-2.5 font-medium">Monthly</th><th className="text-right px-4 py-2.5 font-medium">Annual CTC</th></tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r._id} className="border-t border-[color:var(--border-subtle)]">
                      <td className="px-4 py-2.5"><p className="font-medium">{r.name}</p><p className="text-[11px] text-[color:var(--text-muted)]">{r.employeeCode}</p></td>
                      <td className="px-4 py-2.5">{r.department || '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(r.monthly, r.currency)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--text-muted)]">{money(r.annualCtc, r.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </>
            )
          )}
        </>
      )}
    </SectionPage>
  );
}
