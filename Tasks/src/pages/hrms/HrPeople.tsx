import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { canAny } from '../../utils/moduleAccess';
import { CrudPage, SettingsForm, fmtDate, type Row } from '../../components/CrudPage';
import { Field, GhostButton, Modal, PrimaryButton, SectionPage, Select, StatusPill, TextArea, TextInput } from '../../components/moduleKit';
import { PersonSelect, toPeople } from '../../components/people';

const H = {
  policy: 'taskflow.hr.policy.manage',
  onboardingRead: 'taskflow.hr.onboarding.read',
  onboardingManage: 'taskflow.hr.onboarding.manage',
  recRead: 'taskflow.hr.recruitment.read',
  recManage: 'taskflow.hr.recruitment.manage',
  apprRead: 'taskflow.hr.appraisal.read',
  apprManage: 'taskflow.hr.appraisal.manage',
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((l, i) => ({ value: String(i), label: l }));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((l, i) => ({ value: String(i + 1), label: l }));

function useList<T = Row>(path: string | null) {
  const { token } = useAuth();
  const [rows, setRows] = useState<T[]>([]);
  const reload = useCallback(() => {
    if (!token || !path) return;
    api.get<T[]>(path, token).then((r) => setRows(Array.isArray(r.data) ? r.data : []));
  }, [token, path]);
  useEffect(reload, [reload]);
  return { rows, reload };
}

// ── Settings ────────────────────────────────────────────────────────────────
export function HrSettingsPage() {
  return (
    <SettingsForm
      title="HR settings"
      subtitle="Work week, leave year, cost basis and approvals — all company specific."
      endpoint="/hrms/settings"
      managePermissions={[H.policy]}
      transformIn={(v) => ({ ...v, weekendDays: ((v.weekendDays as number[]) ?? []).map(String), leaveYearStartMonth: String(v.leaveYearStartMonth ?? 1), timesheetReminderWeekday: v.timesheetReminderWeekday ?? '' })}
      transformOut={(v) => ({
        ...v,
        weekendDays: ((v.weekendDays as string[]) ?? []).map(Number),
        leaveYearStartMonth: Number(v.leaveYearStartMonth) || 1,
        timesheetReminderWeekday: v.timesheetReminderWeekday === '' || v.timesheetReminderWeekday == null ? null : Number(v.timesheetReminderWeekday),
      })}
      fields={[
        { key: 'weekendDays', label: 'Weekend days', type: 'multiselect', options: WEEKDAYS },
        { key: 'leaveYearStartMonth', label: 'Leave year starts', type: 'select', options: MONTHS },
        { key: 'standardHoursPerDay', label: 'Standard hours per day', type: 'number' },
        { key: 'expectedWeeklyHours', label: 'Expected weekly hours (timesheets)', type: 'number' },
        { key: 'workingDaysPerYear', label: 'Working days per year (cost rate basis)', type: 'number' },
        { key: 'timesheetReminderWeekday', label: 'Timesheet reminder day', type: 'select', options: WEEKDAYS, help: 'Leave blank to disable reminders.' },
        { key: 'recruitmentStages', label: 'Default recruitment stages', type: 'list', help: 'Comma separated, in order. The last one is treated as hired.' },
        { key: 'leaveApproverUserIds', label: 'Fallback leave approvers', type: 'multiselect', optionsFrom: { endpoint: '/core/people' }, help: "Used when an employee has no manager linked to a user account." },
      ]}
    />
  );
}

// ── Leave types & holidays ──────────────────────────────────────────────────
export function HrLeaveTypesPage() {
  const { token } = useAuth();
  return (
    <CrudPage
      title="Leave types"
      subtitle="Define your own leave policy: allowance, accrual and carry-forward per type."
      endpoint="/hrms/leave-types"
      managePermissions={[H.policy]}
      allowDelete={false}
      createLabel="New leave type"
      toolbar={
        canAny(useAuth().user, H.policy) ? (
          <GhostButton
            onClick={async () => {
              const year = Number(prompt('Carry forward balances from year:', String(new Date().getFullYear() - 1)));
              if (!year || !token) return;
              const r = await api.post('/hrms/leave/carry-forward', { fromYear: year }, token);
              alert(r.success ? 'Balances carried forward.' : r.message);
            }}
          >
            Year-end carry forward
          </GhostButton>
        ) : null
      }
      columns={[
        { header: 'Name', render: (r) => <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: String(r.color || 'var(--accent)') }} />{String(r.name)}</span> },
        { header: 'Code', render: (r) => String(r.code) },
        { header: 'Paid', render: (r) => (r.paid ? 'Yes' : 'No') },
        { header: 'Allowance', render: (r) => `${r.annualAllowance}/yr · ${r.accrual}` },
        { header: 'Carry fwd max', render: (r) => String(r.carryForwardMax ?? 0) },
        { header: 'Status', render: (r) => <StatusPill label={r.active ? 'active' : 'inactive'} tone={r.active ? 'green' : 'slate'} /> },
      ]}
      fields={[
        { key: 'name', label: 'Name', required: true },
        { key: 'code', label: 'Code', required: true, placeholder: 'e.g. annual' },
        { key: 'paid', label: 'Paid leave', type: 'checkbox', defaultValue: true, placeholder: 'Paid (unpaid leave reduces payroll)' },
        { key: 'annualAllowance', label: 'Days per year', type: 'number', defaultValue: 12 },
        { key: 'accrual', label: 'Accrual', type: 'select', options: [{ value: 'yearly', label: 'Full allowance at start of year' }, { value: 'monthly', label: 'Monthly accrual' }], defaultValue: 'yearly' },
        { key: 'carryForwardMax', label: 'Max days carried forward', type: 'number', defaultValue: 0 },
        { key: 'allowNegative', label: 'Allow negative balance', type: 'checkbox' },
        { key: 'color', label: 'Colour', type: 'color', defaultValue: '#6366f1' },
        { key: 'active', label: 'Active', type: 'checkbox', defaultValue: true },
      ]}
    />
  );
}

export function HrHolidaysPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  return (
    <CrudPage
      title="Holidays"
      subtitle="Public / company holidays are excluded from leave day counts."
      endpoint="/hrms/holidays"
      listEndpoint={`/hrms/holidays?year=${year}`}
      managePermissions={[H.policy]}
      createLabel="Add holiday"
      toolbar={
        <Select value={String(year)} onChange={(e) => setYear(Number(e.target.value))} className="w-28">
          {[-1, 0, 1].map((d) => (
            <option key={d}>{new Date().getFullYear() + d}</option>
          ))}
        </Select>
      }
      columns={[
        { header: 'Date', render: (r) => fmtDate(r.date) },
        { header: 'Name', render: (r) => String(r.name) },
        { header: 'Optional', render: (r) => (r.optional ? 'Yes' : 'No') },
        { header: 'Location', render: (r) => String(r.location ?? '—') },
      ]}
      fields={[
        { key: 'date', label: 'Date', type: 'date', required: true },
        { key: 'name', label: 'Name', required: true },
        { key: 'optional', label: 'Optional holiday', type: 'checkbox' },
        { key: 'location', label: 'Location (blank = all)' },
      ]}
    />
  );
}

// ── Onboarding / offboarding ─────────────────────────────────────────────────
export function HrOnboardingPage() {
  const { token, user } = useAuth();
  const manage = canAny(user, H.onboardingManage);
  const templates = useList(manage || canAny(user, H.onboardingRead) ? '/hrms/checklist-templates' : null);
  const [status, setStatus] = useState('open');
  const checklists = useList(`/hrms/checklists?status=${status}`);
  const employees = useList(manage ? '/hrms/employees' : null);
  const [tpl, setTpl] = useState<Row | null>(null);
  const [start, setStart] = useState<Row | null>(null);

  const saveTpl = async () => {
    if (!token || !tpl) return;
    const body = { ...tpl, tasks: ((tpl.tasks as Row[]) ?? []).filter((t) => String(t.title ?? '').trim()) };
    const r = tpl._id ? await api.patch(`/hrms/checklist-templates/${tpl._id}`, body, token) : await api.post('/hrms/checklist-templates', body, token);
    if (!r.success) return alert(r.message);
    setTpl(null);
    templates.reload();
  };
  const startChecklist = async () => {
    if (!token || !start) return;
    const r = await api.post('/hrms/checklists', start, token);
    if (!r.success) return alert(r.message);
    setStart(null);
    checklists.reload();
  };
  const toggle = async (c: Row, t: Row) => {
    if (!token) return;
    const r = await api.patch(`/hrms/checklists/${c._id}/tasks/${t._id}`, { done: !t.done }, token);
    if (!r.success) alert(r.message);
    checklists.reload();
  };
  const tasks = (tpl?.tasks as Row[]) ?? [];
  return (
    <SectionPage
      title="Onboarding & offboarding"
      subtitle="Reusable checklists. Tasks are assigned to HR, the manager, the employee or a specific person."
      toolbar={
        manage && (
          <>
            <GhostButton onClick={() => setTpl({ name: '', kind: 'onboarding', tasks: [{ title: '', assignTo: 'hr', dueOffsetDays: 0 }] })}>New template</GhostButton>
            <PrimaryButton onClick={() => setStart({ employeeId: '', templateId: templates.rows[0]?._id, startDate: new Date().toISOString().slice(0, 10) })}>Start checklist</PrimaryButton>
          </>
        )
      }
    >
      {manage && templates.rows.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {templates.rows.map((t) => (
            <button key={String(t._id)} onClick={() => setTpl(t)} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-left text-sm hover:border-[color:var(--accent)]/40">
              <div className="font-medium">{String(t.name)}</div>
              <div className="text-[11px] text-[color:var(--text-muted)]">
                {String(t.kind)} · {((t.tasks as Row[]) ?? []).length} tasks
              </div>
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        {['open', 'completed'].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`text-sm px-3 py-1 rounded-full border ${status === s ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/10' : 'border-[color:var(--border-subtle)]'}`}>
            {s}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {checklists.rows.map((c) => {
          const list = (c.tasks as Row[]) ?? [];
          const done = list.filter((t) => t.done).length;
          return (
            <div key={String(c._id)} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm">{String((c.employeeId as Row)?.name ?? '—')}</div>
                  <div className="text-[11px] text-[color:var(--text-muted)]">
                    {String(c.name)} · starts {fmtDate(c.startDate)}
                  </div>
                </div>
                <StatusPill label={`${done}/${list.length}`} tone={done === list.length ? 'green' : 'amber'} />
              </div>
              <ul className="space-y-1">
                {list.map((t) => (
                  <li key={String(t._id)} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={Boolean(t.done)} onChange={() => toggle(c, t)} className="mt-1" />
                    <div className={t.done ? 'line-through text-[color:var(--text-muted)]' : ''}>
                      {String(t.title)}
                      <span className="ml-2 text-[11px] text-[color:var(--text-muted)]">
                        {(t.assigneeId as Row)?.name ? String((t.assigneeId as Row).name) : ''} {t.dueDate ? `· due ${fmtDate(t.dueDate)}` : ''}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {checklists.rows.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No {status} checklists.</p>}
      </div>

      {tpl && (
        <Modal
          wide
          title={tpl._id ? 'Edit template' : 'New template'}
          onClose={() => setTpl(null)}
          footer={
            <>
              <GhostButton onClick={() => setTpl(null)}>Cancel</GhostButton>
              <PrimaryButton onClick={saveTpl}>Save</PrimaryButton>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name">
              <TextInput value={String(tpl.name ?? '')} onChange={(e) => setTpl({ ...tpl, name: e.target.value })} />
            </Field>
            <Field label="Kind">
              <Select value={String(tpl.kind)} onChange={(e) => setTpl({ ...tpl, kind: e.target.value })}>
                <option value="onboarding">Onboarding</option>
                <option value="offboarding">Offboarding</option>
              </Select>
            </Field>
          </div>
          <Field label="Tasks">
            <div className="space-y-2">
              {tasks.map((t, i) => {
                const upd = (patch: Row) => setTpl({ ...tpl, tasks: tasks.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <div key={i} className="grid grid-cols-[1fr_9rem_5rem_auto] gap-2">
                    <TextInput placeholder="Task" value={String(t.title ?? '')} onChange={(e) => upd({ title: e.target.value })} />
                    <Select value={String(t.assignTo ?? 'hr')} onChange={(e) => upd({ assignTo: e.target.value })}>
                      <option value="hr">HR</option>
                      <option value="manager">Manager</option>
                      <option value="employee">Employee</option>
                    </Select>
                    <TextInput type="number" title="Due (days from start, negative = before)" value={String(t.dueOffsetDays ?? 0)} onChange={(e) => upd({ dueOffsetDays: Number(e.target.value) })} />
                    <button className="text-rose-500 text-sm" onClick={() => setTpl({ ...tpl, tasks: tasks.filter((_, j) => j !== i) })}>
                      ✕
                    </button>
                  </div>
                );
              })}
              <GhostButton onClick={() => setTpl({ ...tpl, tasks: [...tasks, { title: '', assignTo: 'hr', dueOffsetDays: 0 }] })}>+ Task</GhostButton>
            </div>
          </Field>
        </Modal>
      )}
      {start && (
        <Modal
          title="Start checklist"
          onClose={() => setStart(null)}
          footer={
            <>
              <GhostButton onClick={() => setStart(null)}>Cancel</GhostButton>
              <PrimaryButton onClick={startChecklist}>Start</PrimaryButton>
            </>
          }
        >
          <Field label="Employee">
            <PersonSelect
              value={String(start.employeeId ?? '')}
              onChange={(v) => setStart({ ...start, employeeId: v })}
              people={toPeople(employees.rows)}
              placeholder="Search employee…"
              aria-label="Employee"
            />
          </Field>
          <Field label="Template">
            <Select value={String(start.templateId ?? '')} onChange={(e) => setStart({ ...start, templateId: e.target.value })}>
              {templates.rows.map((t) => (
                <option key={String(t._id)} value={String(t._id)}>
                  {String(t.name)} ({String(t.kind)})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start / last day">
            <TextInput type="date" value={String(start.startDate)} onChange={(e) => setStart({ ...start, startDate: e.target.value })} />
          </Field>
        </Modal>
      )}
    </SectionPage>
  );
}

// ── Recruitment ──────────────────────────────────────────────────────────────
export function HrRecruitmentPage() {
  const { token, user } = useAuth();
  const manage = canAny(user, H.recManage);
  const jobs = useList('/hrms/jobs');
  const [jobId, setJobId] = useState<string>('');
  const job = jobs.rows.find((j) => j._id === jobId) ?? jobs.rows[0];
  const candidates = useList(job ? `/hrms/jobs/${job._id}/candidates` : null);
  const [editJob, setEditJob] = useState<Row | null>(null);
  const [cand, setCand] = useState<Row | null>(null);
  const [interview, setInterview] = useState<Row | null>(null);
  const stages = ((job?.stages as string[]) ?? []).length ? (job!.stages as string[]) : ['Applied', 'Screening', 'Interview', 'Offer', 'Hired'];

  const save = async (path: string, body: Row, id?: unknown) => {
    if (!token) return false;
    // Send ids, not populated objects; interviews have their own endpoint.
    const clean = Object.fromEntries(
      Object.entries(body)
        .filter(([k]) => !['interviews', '_id', 'createdAt', 'updatedAt', '__v'].includes(k))
        .map(([k, v]) => [k, v && typeof v === 'object' && !Array.isArray(v) && '_id' in (v as Row) ? (v as Row)._id : v])
    );
    const r = id ? await api.patch(`${path}/${id}`, clean, token) : await api.post(path, clean, token);
    if (!r.success) alert(r.message);
    return r.success;
  };
  const move = async (c: Row, stage: string) => {
    if (await save('/hrms/candidates', { stage }, c._id)) candidates.reload();
  };
  const hire = async (c: Row) => {
    if (!token) return;
    const joinedDate = prompt('Joining date (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
    if (!joinedDate) return;
    const r = await api.post(`/hrms/candidates/${c._id}/hire`, { joinedDate }, token);
    alert(r.success ? 'Employee record created.' : r.message);
    candidates.reload();
  };

  return (
    <SectionPage
      title="Recruitment"
      subtitle="Job openings and a candidate pipeline with your own stages."
      toolbar={
        manage && (
          <>
            <GhostButton onClick={() => setEditJob({ title: '', status: 'open', openings: 1, stages: [] })}>New opening</GhostButton>
            {job && <PrimaryButton onClick={() => setCand({ jobId: job._id, name: '', email: '', stage: stages[0] })}>Add candidate</PrimaryButton>}
          </>
        )
      }
    >
      <div className="flex flex-wrap gap-2">
        {jobs.rows.map((j) => (
          <button
            key={String(j._id)}
            onClick={() => setJobId(String(j._id))}
            onDoubleClick={() => manage && setEditJob(j)}
            title={manage ? 'Double-click to edit' : undefined}
            className={`rounded-xl border px-3 py-2 text-left text-sm ${job?._id === j._id ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/10' : 'border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]'}`}
          >
            <div className="font-medium">{String(j.title)}</div>
            <div className="text-[11px] text-[color:var(--text-muted)]">
              {String(j.department ?? '')} · {String(j.status)}
            </div>
          </button>
        ))}
        {jobs.rows.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No openings yet.</p>}
      </div>
      {job && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {stages.map((s) => (
            <div key={s} className="min-w-[14rem] flex-1 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-3 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-[color:var(--text-muted)]">
                {s} · {candidates.rows.filter((c) => c.stage === s && c.status === 'active').length}
              </div>
              {candidates.rows
                .filter((c) => c.stage === s && c.status === 'active')
                .map((c) => (
                  <div key={String(c._id)} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-2.5 text-sm space-y-1">
                    <div className="font-medium cursor-pointer" onClick={() => setCand(c)}>
                      {String(c.name)}
                    </div>
                    <div className="text-[11px] text-[color:var(--text-muted)]">{String(c.email ?? '')}</div>
                    {((c.interviews as Row[]) ?? []).length > 0 && (
                      <div className="text-[11px]">
                        {((c.interviews as Row[]) ?? []).length} interview(s) · avg{' '}
                        {(((c.interviews as Row[]) ?? []).reduce((a, i) => a + Number(i.rating ?? 0), 0) / Math.max(1, ((c.interviews as Row[]) ?? []).filter((i) => i.rating).length)).toFixed(1)}
                      </div>
                    )}
                    {manage && (
                      <div className="flex flex-wrap gap-2 pt-1 text-[11px]">
                        <Select value={s} onChange={(e) => move(c, e.target.value)} className="!py-0.5 !text-[11px] w-auto">
                          {stages.map((x) => (
                            <option key={x}>{x}</option>
                          ))}
                        </Select>
                        <button className="text-[color:var(--accent)]" onClick={() => setInterview({ candidateId: c._id, at: '', rating: '', feedback: '', recommendation: '' })}>
                          + Interview
                        </button>
                        <button className="text-emerald-600" onClick={() => hire(c)}>
                          Hire
                        </button>
                        <button className="text-rose-500" onClick={async () => (await save('/hrms/candidates', { status: 'rejected', rejectionReason: prompt('Reason?') ?? '' }, c._id)) && candidates.reload()}>
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          ))}
        </div>
      )}
      {editJob && (
        <Modal
          title={editJob._id ? 'Edit opening' : 'New opening'}
          onClose={() => setEditJob(null)}
          footer={
            <>
              <GhostButton onClick={() => setEditJob(null)}>Cancel</GhostButton>
              <PrimaryButton onClick={async () => (await save('/hrms/jobs', editJob, editJob._id)) && (setEditJob(null), jobs.reload())}>Save</PrimaryButton>
            </>
          }
        >
          <Field label="Title">
            <TextInput value={String(editJob.title ?? '')} onChange={(e) => setEditJob({ ...editJob, title: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Department">
              <TextInput value={String(editJob.department ?? '')} onChange={(e) => setEditJob({ ...editJob, department: e.target.value })} />
            </Field>
            <Field label="Location">
              <TextInput value={String(editJob.location ?? '')} onChange={(e) => setEditJob({ ...editJob, location: e.target.value })} />
            </Field>
            <Field label="Openings">
              <TextInput type="number" value={String(editJob.openings ?? 1)} onChange={(e) => setEditJob({ ...editJob, openings: Number(e.target.value) })} />
            </Field>
            <Field label="Status">
              <Select value={String(editJob.status)} onChange={(e) => setEditJob({ ...editJob, status: e.target.value })}>
                {['draft', 'open', 'on_hold', 'closed'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Pipeline stages (blank = HR default)">
            <TextInput value={((editJob.stages as string[]) ?? []).join(', ')} onChange={(e) => setEditJob({ ...editJob, stages: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
          </Field>
          <Field label="Description">
            <TextArea rows={4} value={String(editJob.description ?? '')} onChange={(e) => setEditJob({ ...editJob, description: e.target.value })} />
          </Field>
        </Modal>
      )}
      {cand && (
        <Modal
          title={cand._id ? String(cand.name) : 'Add candidate'}
          onClose={() => setCand(null)}
          footer={
            manage ? (
              <>
                <GhostButton onClick={() => setCand(null)}>Cancel</GhostButton>
                <PrimaryButton onClick={async () => (await save('/hrms/candidates', cand, cand._id)) && (setCand(null), candidates.reload())}>Save</PrimaryButton>
              </>
            ) : undefined
          }
        >
          {(['name', 'email', 'phone', 'source', 'resumeUrl'] as const).map((k) => (
            <Field key={k} label={k === 'resumeUrl' ? 'Resume link' : k[0].toUpperCase() + k.slice(1)}>
              <TextInput value={String(cand[k] ?? '')} onChange={(e) => setCand({ ...cand, [k]: e.target.value })} />
            </Field>
          ))}
          <Field label="Notes">
            <TextArea rows={3} value={String(cand.notes ?? '')} onChange={(e) => setCand({ ...cand, notes: e.target.value })} />
          </Field>
          {((cand.interviews as Row[]) ?? []).map((i, idx) => (
            <div key={idx} className="rounded-lg border border-[color:var(--border-subtle)] p-2 text-xs">
              {fmtDate(i.at, true)} · {String(i.mode ?? '')} · rating {String(i.rating ?? '—')} · {String(i.recommendation ?? '')}
              <div className="text-[color:var(--text-muted)]">{String(i.feedback ?? '')}</div>
            </div>
          ))}
        </Modal>
      )}
      {interview && (
        <Modal
          title="Log interview"
          onClose={() => setInterview(null)}
          footer={
            <>
              <GhostButton onClick={() => setInterview(null)}>Cancel</GhostButton>
              <PrimaryButton
                onClick={async () => {
                  if (!token) return;
                  const { candidateId, ...body } = interview;
                  const r = await api.post(`/hrms/candidates/${candidateId}/interviews`, { ...body, rating: body.rating ? Number(body.rating) : undefined, recommendation: body.recommendation || undefined }, token);
                  if (!r.success) return alert(r.message);
                  setInterview(null);
                  candidates.reload();
                }}
              >
                Save
              </PrimaryButton>
            </>
          }
        >
          <Field label="When">
            <TextInput type="datetime-local" value={String(interview.at)} onChange={(e) => setInterview({ ...interview, at: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rating (1-5)">
              <TextInput type="number" min={1} max={5} value={String(interview.rating)} onChange={(e) => setInterview({ ...interview, rating: e.target.value })} />
            </Field>
            <Field label="Recommendation">
              <Select value={String(interview.recommendation)} onChange={(e) => setInterview({ ...interview, recommendation: e.target.value })}>
                <option value="">—</option>
                <option value="strong_yes">Strong yes</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
                <option value="strong_no">Strong no</option>
              </Select>
            </Field>
          </div>
          <Field label="Feedback">
            <TextArea rows={4} value={String(interview.feedback)} onChange={(e) => setInterview({ ...interview, feedback: e.target.value })} />
          </Field>
        </Modal>
      )}
    </SectionPage>
  );
}

// ── Appraisals ───────────────────────────────────────────────────────────────
export function HrAppraisalsPage() {
  const { token, user } = useAuth();
  const manage = canAny(user, H.apprManage);
  const cycles = useList(canAny(user, H.apprRead, H.apprManage) ? '/hrms/review-cycles' : null);
  const reviews = useList('/hrms/reviews');
  const [cycle, setCycle] = useState<Row | null>(null);
  const [review, setReview] = useState<Row | null>(null);

  const saveCycle = async () => {
    if (!token || !cycle) return;
    const r = cycle._id ? await api.patch(`/hrms/review-cycles/${cycle._id}`, cycle, token) : await api.post('/hrms/review-cycles', cycle, token);
    if (!r.success) return alert(r.message);
    setCycle(null);
    cycles.reload();
  };
  const launch = async (c: Row) => {
    if (!token || !confirm(`Launch "${c.name}" for all active employees?`)) return;
    const r = await api.post(`/hrms/review-cycles/${c._id}/launch`, {}, token);
    alert(r.success ? 'Launched — employees and reviewers were notified.' : r.message);
    cycles.reload();
    reviews.reload();
  };
  const submitReview = async (submit: boolean) => {
    if (!token || !review) return;
    const r = await api.patch(`/hrms/reviews/${review._id}`, { goals: review.goals, selfAnswers: review.selfAnswers, managerAnswers: review.managerAnswers, finalRating: review.finalRating, submit }, token);
    if (!r.success) return alert(r.message);
    setReview(null);
    reviews.reload();
  };
  const questions = ((review?.cycleId as Row)?.questions as string[]) ?? [];
  const isSelf = review && String((review.employeeUserId as Row)?._id ?? review.employeeUserId) === user?.id;
  const answersKey = isSelf && review?.status === 'pending_self' ? 'selfAnswers' : 'managerAnswers';
  return (
    <SectionPage title="Appraisals" subtitle="Review cycles with goals, self review and manager review." toolbar={manage && <PrimaryButton onClick={() => setCycle({ name: '', periodStart: '', periodEnd: '', ratingScale: 5, questions: [], selfReview: true })}>New cycle</PrimaryButton>}>
      {cycles.rows.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3">
          {cycles.rows.map((c) => (
            <div key={String(c._id)} className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">{String(c.name)}</span>
                <StatusPill label={String(c.status)} tone={c.status === 'active' ? 'green' : c.status === 'draft' ? 'amber' : 'slate'} />
              </div>
              <div className="text-[11px] text-[color:var(--text-muted)]">
                {fmtDate(c.periodStart)} – {fmtDate(c.periodEnd)}
              </div>
              {manage && (
                <div className="flex gap-3 pt-1 text-xs">
                  <button className="text-[color:var(--accent)]" onClick={() => setCycle(c)}>
                    Edit
                  </button>
                  {c.status === 'draft' && (
                    <button className="text-emerald-600" onClick={() => launch(c)}>
                      Launch
                    </button>
                  )}
                  {c.status === 'active' && (
                    <button className="text-[color:var(--text-muted)]" onClick={async () => token && (await api.patch(`/hrms/review-cycles/${c._id}`, { status: 'closed' }, token), cycles.reload())}>
                      Close
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[color:var(--text-muted)] border-b border-[color:var(--border-subtle)]">
              <th className="px-4 py-2.5">Employee</th>
              <th className="px-4 py-2.5">Cycle</th>
              <th className="px-4 py-2.5">Reviewer</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Rating</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {reviews.rows.map((r) => (
              <tr key={String(r._id)} className="border-b border-[color:var(--border-subtle)] last:border-0">
                <td className="px-4 py-2.5">{String((r.employeeId as Row)?.name ?? '—')}</td>
                <td className="px-4 py-2.5">{String((r.cycleId as Row)?.name ?? '—')}</td>
                <td className="px-4 py-2.5">{String((r.reviewerId as Row)?.name ?? '—')}</td>
                <td className="px-4 py-2.5">
                  <StatusPill label={String(r.status)} tone={r.status === 'completed' ? 'green' : 'amber'} />
                </td>
                <td className="px-4 py-2.5">{String(r.finalRating ?? '—')}</td>
                <td className="px-4 py-2.5 text-right">
                  <button className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => setReview(r)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
            {reviews.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[color:var(--text-muted)]">
                  No reviews assigned to you.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {cycle && (
        <Modal
          wide
          title={cycle._id ? 'Edit cycle' : 'New review cycle'}
          onClose={() => setCycle(null)}
          footer={
            <>
              <GhostButton onClick={() => setCycle(null)}>Cancel</GhostButton>
              <PrimaryButton onClick={saveCycle}>Save</PrimaryButton>
            </>
          }
        >
          <Field label="Name">
            <TextInput value={String(cycle.name ?? '')} onChange={(e) => setCycle({ ...cycle, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Period start">
              <TextInput type="date" value={String(cycle.periodStart ?? '').slice(0, 10)} onChange={(e) => setCycle({ ...cycle, periodStart: e.target.value })} />
            </Field>
            <Field label="Period end">
              <TextInput type="date" value={String(cycle.periodEnd ?? '').slice(0, 10)} onChange={(e) => setCycle({ ...cycle, periodEnd: e.target.value })} />
            </Field>
            <Field label="Rating scale">
              <TextInput type="number" min={3} max={10} value={String(cycle.ratingScale ?? 5)} onChange={(e) => setCycle({ ...cycle, ratingScale: Number(e.target.value) })} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={Boolean(cycle.selfReview)} onChange={(e) => setCycle({ ...cycle, selfReview: e.target.checked })} /> Employees write a self review first
          </label>
          <Field label="Questions (one per line)">
            <TextArea rows={5} value={((cycle.questions as string[]) ?? []).join('\n')} onChange={(e) => setCycle({ ...cycle, questions: e.target.value.split('\n') })} />
          </Field>
        </Modal>
      )}
      {review && (
        <Modal
          wide
          title={`Review · ${String((review.employeeId as Row)?.name ?? '')}`}
          onClose={() => setReview(null)}
          footer={
            review.status !== 'completed' ? (
              <>
                <GhostButton onClick={() => submitReview(false)}>Save draft</GhostButton>
                <PrimaryButton onClick={() => submitReview(true)}>Submit</PrimaryButton>
              </>
            ) : undefined
          }
        >
          <Field label="Goals">
            <div className="space-y-2">
              {((review.goals as Row[]) ?? []).map((g, i) => {
                const goals = (review.goals as Row[]) ?? [];
                const upd = (p: Row) => setReview({ ...review, goals: goals.map((x, j) => (j === i ? { ...x, ...p } : x)) });
                return (
                  <div key={i} className="grid grid-cols-[1fr_4rem_4rem_4rem] gap-2 items-center">
                    <TextInput value={String(g.title ?? '')} onChange={(e) => upd({ title: e.target.value })} />
                    <TextInput type="number" title="Weight" value={String(g.weight ?? 1)} onChange={(e) => upd({ weight: Number(e.target.value) })} />
                    <TextInput type="number" title="Self score" value={String(g.selfScore ?? '')} onChange={(e) => upd({ selfScore: Number(e.target.value) })} />
                    <TextInput type="number" title="Manager score" value={String(g.managerScore ?? '')} onChange={(e) => upd({ managerScore: Number(e.target.value) })} />
                  </div>
                );
              })}
              <GhostButton onClick={() => setReview({ ...review, goals: [...((review.goals as Row[]) ?? []), { title: '', weight: 1 }] })}>+ Goal</GhostButton>
              <p className="text-[11px] text-[color:var(--text-muted)]">Columns: goal · weight · self score · manager score</p>
            </div>
          </Field>
          {questions.map((q, i) => (
            <Field key={i} label={q}>
              {review.status === 'completed' ? (
                <div className="text-sm space-y-1">
                  <p>
                    <b>Self:</b> {String(((review.selfAnswers as string[]) ?? [])[i] ?? '—')}
                  </p>
                  <p>
                    <b>Manager:</b> {String(((review.managerAnswers as string[]) ?? [])[i] ?? '—')}
                  </p>
                </div>
              ) : (
                <TextArea
                  rows={3}
                  value={String(((review[answersKey] as string[]) ?? [])[i] ?? '')}
                  onChange={(e) => {
                    const arr = [...((review[answersKey] as string[]) ?? [])];
                    arr[i] = e.target.value;
                    setReview({ ...review, [answersKey]: arr });
                  }}
                />
              )}
            </Field>
          ))}
          {!isSelf && review.status === 'pending_manager' && (
            <Field label="Final rating">
              <TextInput type="number" value={String(review.finalRating ?? '')} onChange={(e) => setReview({ ...review, finalRating: Number(e.target.value) })} />
            </Field>
          )}
        </Modal>
      )}
    </SectionPage>
  );
}
