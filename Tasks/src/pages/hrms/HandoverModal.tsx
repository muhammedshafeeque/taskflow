import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { hrmsApi, type HrmsEmployee, type HrmsOpenWork } from '../../lib/api';
import { Field, GhostButton, Modal, PrimaryButton } from '../../components/moduleKit';
import { PersonSelect, toPeople } from '../../components/people';

const KINDS: Array<{ key: Exclude<keyof HrmsOpenWork, 'projectsLed'>; label: string }> = [
  { key: 'leads', label: 'Open leads' },
  { key: 'deals', label: 'Open deals' },
  { key: 'followUps', label: 'CRM follow-ups' },
  { key: 'tasks', label: 'Open tasks' },
  { key: 'tickets', label: 'Support tickets' },
  { key: 'timesheets', label: 'Timesheets to approve' },
  { key: 'reviews', label: 'Performance reviews to give' },
  { key: 'checklists', label: 'On/offboarding checklists' },
  { key: 'reports', label: 'Direct reports' },
  { key: 'leaveApprover', label: 'Leave approver role' },
];

/** Hand a person's open work to someone else; repeat with another person for the rest. */
export default function HandoverModal({ employee, employees, onClose }: { employee: HrmsEmployee; employees: HrmsEmployee[]; onClose: () => void }) {
  const { token } = useAuth();
  const [work, setWork] = useState<HrmsOpenWork | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    let live = true;
    void hrmsApi.openWork(employee._id, token).then((r) => {
      if (!live) return;
      if (r.success && r.data) setWork(r.data);
      else setMessage({ ok: false, text: r.message ?? 'Could not load open work' });
    });
    return () => {
      live = false;
    };
  }, [employee._id, token]);

  const open = KINDS.filter((k) => (work?.[k.key] ?? 0) > 0);
  const chosen = open.filter((k) => !off.has(k.key)).map((k) => k.key);
  const people = toPeople(
    employees
      .filter((e) => e.userId && e._id !== employee._id && e.status !== 'terminated')
      .map((e) => ({ _id: e.userId, name: e.name, email: e.email, department: e.department }))
  );

  const submit = async () => {
    if (!token || !to || chosen.length === 0) return;
    setBusy(true);
    const r = await hrmsApi.reassignWork(employee._id, { toUserId: to, kinds: chosen }, token);
    setBusy(false);
    if (!r.success || !r.data) return setMessage({ ok: false, text: r.message ?? 'Could not reassign' });
    setWork(r.data.remaining);
    const moved = Object.values(r.data.moved).reduce<number>((s, n) => s + (n ?? 0), 0);
    const left = r.data.remaining.tasks > 0 && chosen.includes('tasks') ? ' Tasks left are in projects that person is not a member of.' : '';
    setMessage({ ok: true, text: `${moved} item(s) handed over.${left}` });
  };

  return (
    <Modal
      title={`Hand over work · ${employee.name}`}
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose}>Close</GhostButton>
          <PrimaryButton onClick={submit} disabled={busy || !to || chosen.length === 0}>
            {busy ? 'Handing over…' : 'Hand over'}
          </PrimaryButton>
        </>
      }
    >
      {employee.accessClosedAt && <p className="text-xs text-[color:var(--text-muted)]">Exit processed on {new Date(employee.accessClosedAt).toLocaleDateString()}.</p>}
      {message && (
        <p role="status" className={`text-xs ${message.ok ? 'text-emerald-600' : 'text-rose-500'}`}>
          {message.text}
        </p>
      )}
      {work && open.length === 0 && <p className="text-sm text-[color:var(--text-muted)]">No open work to hand over.</p>}
      {open.length > 0 && (
        <>
          <div className="space-y-1.5">
            {open.map((k) => (
              <label key={k.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!off.has(k.key)}
                    onChange={(e) =>
                      setOff((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.delete(k.key);
                        else next.add(k.key);
                        return next;
                      })
                    }
                  />
                  {k.label}
                </span>
                <span className="tabular-nums text-[color:var(--text-muted)]">{work?.[k.key]}</span>
              </label>
            ))}
          </div>
          <Field label="Hand over to">
            <PersonSelect value={to} onChange={setTo} people={people} placeholder="Search employee…" aria-label="Hand over to" />
          </Field>
        </>
      )}
      {(work?.projectsLed ?? 0) > 0 && (
        <p className="text-xs text-[color:var(--text-muted)]">
          Leads {work?.projectsLed} project(s). Change the project lead in each project’s settings.
        </p>
      )}
    </Modal>
  );
}
