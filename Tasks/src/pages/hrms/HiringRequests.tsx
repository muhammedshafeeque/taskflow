import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { hiringApi, type HiringPlanRow, type HiringRequest } from '../../lib/api';
import { Field, GhostButton, Modal, PrimaryButton, SectionPage, Select, StatusPill, TextArea, TextInput } from '../../components/moduleKit';
import { canAny } from '../../utils/moduleAccess';

const STATUS_TONE: Record<HiringRequest['status'], 'amber' | 'blue' | 'green' | 'red' | 'slate' | 'violet'> = {
  draft: 'slate',
  pending_approval: 'amber',
  approved: 'blue',
  rejected: 'red',
  opened: 'green',
  cancelled: 'slate',
};
const STATUS_LABEL: Record<HiringRequest['status'], string> = {
  draft: 'draft',
  pending_approval: 'waiting for approval',
  approved: 'approved',
  rejected: 'rejected',
  opened: 'job opened',
  cancelled: 'cancelled',
};
const TYPES = [
  ['full_time', 'Full time'],
  ['part_time', 'Part time'],
  ['contract', 'Contract'],
  ['intern', 'Intern'],
] as const;
const refName = (v: unknown) => (v && typeof v === 'object' && 'name' in v ? String((v as { name?: string }).name ?? '') : '');
const refId = (v: unknown) => (v && typeof v === 'object' && '_id' in v ? String((v as { _id: string })._id) : v ? String(v) : '');
const num = (n?: number | null) => (n == null ? '' : n.toLocaleString());
const band = (r: Pick<HiringRequest, 'budgetMin' | 'budgetMax' | 'currency'>) =>
  r.budgetMin == null && r.budgetMax == null ? '—' : `${r.currency} ${r.budgetMin != null && r.budgetMax != null ? `${num(r.budgetMin)}–${num(r.budgetMax)}` : num(r.budgetMax ?? r.budgetMin)}`;

/** Raise or change a hiring request. */
function HiringRequestModal({ request, onClose, onSaved }: { request?: HiringRequest; onClose: () => void; onSaved: (r: HiringRequest, outcome: string, ok: boolean) => void }) {
  const { token } = useAuth();
  const [form, setForm] = useState<Record<string, string>>({
    title: request?.title ?? '',
    department: request?.department ?? '',
    location: request?.location ?? '',
    employmentType: request?.employmentType ?? 'full_time',
    level: request?.level ?? '',
    headcount: String(request?.headcount ?? 1),
    budgetMin: request?.budgetMin != null ? String(request.budgetMin) : '',
    budgetMax: request?.budgetMax != null ? String(request.budgetMax) : '',
    currency: request?.currency ?? 'USD',
    targetStartDate: request?.targetStartDate ? request.targetStartDate.slice(0, 10) : '',
    justification: request?.justification ?? '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (submit: boolean) => {
    if (!token) return;
    setBusy(true);
    setError('');
    const body = { ...form, headcount: Number(form.headcount), budgetMin: form.budgetMin === '' ? null : Number(form.budgetMin), budgetMax: form.budgetMax === '' ? null : Number(form.budgetMax), targetStartDate: form.targetStartDate || null };
    const r = request ? await hiringApi.update(request._id, body, token) : await hiringApi.create(body, token);
    if (!r.success || !r.data) {
      setBusy(false);
      return setError(r.message ?? 'Could not save');
    }
    let saved = r.data;
    if (submit) {
      const s = await hiringApi.submit(saved._id, token);
      if (!s.success || !s.data) {
        setBusy(false);
        return onSaved(saved, `Saved as a draft, but not sent: ${s.message ?? 'could not send for approval'}`, false);
      }
      saved = s.data;
    }
    setBusy(false);
    onSaved(saved, submit ? 'Sent for approval.' : 'Saved as a draft.', true);
  };

  return (
    <Modal
      title={request ? 'Change hiring request' : 'New hiring request'}
      onClose={onClose}
      wide
      footer={
        <>
          <GhostButton type="button" onClick={onClose}>Cancel</GhostButton>
          <GhostButton type="button" disabled={busy} onClick={() => save(false)}>Save draft</GhostButton>
          <PrimaryButton type="button" disabled={busy} onClick={() => save(true)}>Send for approval</PrimaryButton>
        </>
      }
    >
      {request?.status === 'rejected' && request.decisionNote && <p className="rounded-lg bg-rose-500/10 px-3 py-2 text-xs">Rejected: {request.decisionNote}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Role"><TextInput value={form.title} onChange={set('title')} placeholder="e.g. Senior frontend developer" /></Field>
        <Field label="Department"><TextInput value={form.department} onChange={set('department')} /></Field>
        <Field label="Headcount"><TextInput type="number" min={1} value={form.headcount} onChange={set('headcount')} /></Field>
        <Field label="Type">
          <Select value={form.employmentType} onChange={set('employmentType')}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Level"><TextInput value={form.level} onChange={set('level')} /></Field>
        <Field label="Location"><TextInput value={form.location} onChange={set('location')} /></Field>
        <Field label="Annual pay budget per hire, from"><TextInput type="number" min={0} value={form.budgetMin} onChange={set('budgetMin')} /></Field>
        <Field label="to"><TextInput type="number" min={0} value={form.budgetMax} onChange={set('budgetMax')} /></Field>
        <Field label="Currency"><TextInput value={form.currency} maxLength={3} onChange={set('currency')} /></Field>
        <Field label="Wanted from"><TextInput type="date" value={form.targetStartDate} onChange={set('targetStartDate')} /></Field>
      </div>
      <Field label="Why is this hire needed?"><TextArea rows={4} value={form.justification} onChange={set('justification')} /></Field>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </Modal>
  );
}

function PlanTable({ rows, label }: { rows: HiringPlanRow[]; label: (r: HiringPlanRow) => string }) {
  return (
    <table className="w-full text-left text-xs">
      <thead className="text-[color:var(--text-muted)]">
        <tr>
          <th className="py-1.5 pr-3 font-medium">Department</th>
          <th className="py-1.5 pr-3 font-medium text-right">Waiting</th>
          <th className="py-1.5 pr-3 font-medium text-right">Approved</th>
          <th className="py-1.5 pr-3 font-medium text-right">Jobs opened</th>
          <th className="py-1.5 pr-3 font-medium text-right">Hired</th>
          <th className="py-1.5 pr-3 font-medium text-right">Budget waiting</th>
          <th className="py-1.5 font-medium text-right">Budget approved</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[color:var(--border-subtle)]">
        {rows.map((r) => (
          <tr key={`${label(r)}-${r.currency}`}>
            <td className="py-1.5 pr-3">{label(r)}</td>
            <td className="py-1.5 pr-3 text-right">{r.requested}</td>
            <td className="py-1.5 pr-3 text-right">{r.approved}</td>
            <td className="py-1.5 pr-3 text-right">{r.opened}</td>
            <td className="py-1.5 pr-3 text-right">{r.hired}</td>
            <td className="py-1.5 pr-3 text-right">{r.currency} {num(r.requestedBudget)}</td>
            <td className="py-1.5 text-right">{r.currency} {num(r.approvedBudget)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** HRMS → Hiring requests: raise one, approve them, open jobs, and the hiring plan by department. */
export function HiringRequestsPage() {
  const { token, user } = useAuth();
  const canCreate = canAny(user, 'taskflow.hr.hiring_request.create', 'taskflow.hr.recruitment.manage');
  const canApprove = canAny(user, 'taskflow.hr.hiring_request.approve');
  const canRecruit = canAny(user, 'taskflow.hr.recruitment.manage');
  const canPlan = canAny(user, 'taskflow.hr.hiring_request.approve', 'taskflow.hr.recruitment.read', 'taskflow.hr.recruitment.manage');
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<HiringRequest[] | null>(null);
  const [plan, setPlan] = useState<{ departments: HiringPlanRow[]; totals: HiringPlanRow[] } | null>(null);
  const [editing, setEditing] = useState<HiringRequest | 'new' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    if (!token) return;
    void hiringApi.list(token, filter ? { status: filter } : {}).then((r) => setRows(r.success && Array.isArray(r.data) ? r.data : []));
    if (canPlan) void hiringApi.plan(token).then((r) => setPlan(r.success && r.data ? r.data : null));
  }, [token, filter, canPlan]);
  useEffect(load, [load]);

  const act = async (r: HiringRequest, what: 'submit' | 'approve' | 'reject' | 'cancel' | 'open') => {
    if (!token) return;
    let res;
    if (what === 'reject') {
      const note = window.prompt('Why is this request rejected?');
      if (!note?.trim()) return;
      res = await hiringApi.decide(r._id, 'reject', note, token);
    } else if (what === 'approve') res = await hiringApi.decide(r._id, 'approve', '', token);
    else if (what === 'submit') res = await hiringApi.submit(r._id, token);
    else if (what === 'cancel') {
      if (!window.confirm('Cancel this hiring request?')) return;
      res = await hiringApi.cancel(r._id, token);
    } else res = await hiringApi.openJob(r._id, token);
    if (!res.success) return setMessage({ ok: false, text: res.message ?? 'Could not update' });
    setMessage({ ok: true, text: what === 'open' ? 'Job opened in Recruitment.' : what === 'submit' ? 'Sent for approval.' : what === 'cancel' ? 'Request cancelled.' : `Request ${what === 'approve' ? 'approved' : 'rejected'}.` });
    load();
  };

  return (
    <SectionPage
      title="Hiring requests"
      subtitle="Ask for a new position with its headcount and pay budget. Once approved, recruiters open a job for it in Recruitment."
      toolbar={canCreate && <PrimaryButton type="button" onClick={() => setEditing('new')}>New hiring request</PrimaryButton>}
    >
      {plan && plan.departments.length > 0 && (
        <section className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4" data-testid="hiring-plan">
          <h2 className="mb-2 text-sm font-bold">Hiring plan and budget</h2>
          <PlanTable rows={plan.departments} label={(r) => r.department ?? ''} />
          {plan.totals.length > 0 && (
            <div className="mt-3 border-t border-[color:var(--border-subtle)] pt-2">
              <PlanTable rows={plan.totals} label={() => 'Total'} />
            </div>
          )}
          <p className="mt-2 text-[11px] text-[color:var(--text-muted)]">Budget is headcount × the top of each request's pay band, per year. Approved includes requests whose job is open.</p>
        </section>
      )}

      <div className="flex flex-wrap gap-1.5 text-xs" role="tablist">
        {[
          ['', 'All'],
          ['pending_approval', 'Waiting for approval'],
          ['approved', 'Approved'],
          ['opened', 'Job opened'],
          ['draft', 'Drafts'],
          ['rejected', 'Rejected'],
        ].map(([v, l]) => (
          <button key={l} type="button" role="tab" aria-selected={filter === v} onClick={() => setFilter(v)} className={`rounded-full border px-3 py-1 ${filter === v ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/10' : 'border-[color:var(--border-subtle)]'}`}>
            {l}
          </button>
        ))}
      </div>
      {message && <p className={`text-xs ${message.ok ? 'text-emerald-600' : 'text-red-500'}`}>{message.text}</p>}

      {rows === null ? (
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No hiring requests here.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const mine = refId(r.requestedBy) === user?.id;
            return (
              <div key={r._id} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-3 text-sm" data-testid="hiring-request">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.headcount} × {r.title}</span>
                  {r.department && <span className="text-xs text-[color:var(--text-muted)]">{r.department}</span>}
                  <StatusPill label={STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} />
                  <span className="ml-auto text-xs text-[color:var(--text-muted)]">{band(r)} per year{r.targetStartDate ? ` · from ${r.targetStartDate.slice(0, 10)}` : ''}</span>
                </div>
                {r.justification && <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs">{r.justification}</p>}
                {r.decisionNote && <p className="mt-1 text-xs text-[color:var(--text-muted)]">{r.status === 'rejected' ? 'Rejected' : 'Note'}: {r.decisionNote}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-[color:var(--text-muted)]">
                  <span>
                    Raised by {refName(r.requestedBy) || '—'}
                    {r.decidedBy ? ` · ${r.status === 'rejected' ? 'rejected' : 'approved'} by ${refName(r.decidedBy)}` : ''}
                    {typeof r.demandId === 'object' && r.demandId ? ` · for resource demand "${r.demandId.title}"` : ''}
                  </span>
                  <span className="ml-auto flex gap-3">
                    {typeof r.jobId === 'object' && r.jobId && (
                      <Link to="/hrms/recruitment" className="text-[color:var(--accent)] hover:underline">
                        Job: {r.jobId.filled ?? 0}/{r.jobId.openings} filled
                      </Link>
                    )}
                    {mine && (r.status === 'draft' || r.status === 'rejected') && (
                      <>
                        <button type="button" className="hover:underline" onClick={() => setEditing(r)}>Edit</button>
                        <button type="button" className="text-[color:var(--accent)] hover:underline" onClick={() => act(r, 'submit')}>Send for approval</button>
                      </>
                    )}
                    {r.status === 'pending_approval' && canApprove && !mine && (
                      <>
                        <button type="button" className="text-[color:var(--accent)] hover:underline" onClick={() => act(r, 'approve')}>Approve</button>
                        <button type="button" className="text-rose-500 hover:underline" onClick={() => act(r, 'reject')}>Reject</button>
                      </>
                    )}
                    {r.status === 'approved' && canRecruit && (
                      <button type="button" className="text-[color:var(--accent)] hover:underline" onClick={() => act(r, 'open')}>Open job</button>
                    )}
                    {(mine || canRecruit) && ['draft', 'pending_approval', 'approved', 'rejected'].includes(r.status) && (
                      <button type="button" className="hover:underline" onClick={() => act(r, 'cancel')}>Cancel</button>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <HiringRequestModal
          request={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(_r, text, ok) => {
            setEditing(null);
            setMessage({ ok, text });
            load();
          }}
        />
      )}
    </SectionPage>
  );
}
