import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { PersonMultiSelect } from '../people';
import { Field, GhostButton, Modal, PrimaryButton, StatusPill, TextInput } from '../moduleKit';

type Row = { employeeId: string; name: string; email?: string; department?: string; status: 'accepted' | 'pending' | 'outdated' | 'no_account'; acceptedVersion: number | null; acceptedAt: string | null };
type Report = {
  policy: { _id: string; title: string; version: number; status: string; live: boolean };
  assignment: { everyone: boolean; teamIds: string[]; employeeIds: string[]; remindEveryDays: number; active: boolean } | null;
  counts: { total: number; accepted: number; pending: number; noAccount: number };
  rows: Row[];
};
type Options = { employees: Array<{ _id: string; name: string; email?: string; department?: string }>; teams: Array<{ _id: string; name: string }> };

const LABEL: Record<Row['status'], string> = { accepted: 'Accepted', pending: 'Pending', outdated: 'Accepted an older version', no_account: 'No account' };
const TONE: Record<Row['status'], 'green' | 'amber' | 'slate' | 'red'> = { accepted: 'green', pending: 'amber', outdated: 'amber', no_account: 'slate' };

/**
 * Policy read-and-accept (AUT-36): who the policy is assigned to, who has accepted the current version,
 * who is pending, and a reminder. Employees accept from Me.
 */
export default function PolicyAcceptanceModal({ docId, onClose }: { docId: string; onClose: () => void }) {
  const { token } = useAuth();
  const [report, setReport] = useState<Report | null>(null);
  const [options, setOptions] = useState<Options>({ employees: [], teams: [] });
  const [form, setForm] = useState({ everyone: false, teamIds: [] as string[], employeeIds: [] as string[], remindEveryDays: '3' });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!token) return;
    void api.get<Report>(`/documents/documents/${docId}/acceptance`, token).then((r) => {
      if (!r.success || !r.data) return setMessage(r.message ?? 'Could not load');
      setReport(r.data);
      const a = r.data.assignment;
      if (a) setForm({ everyone: a.everyone, teamIds: a.teamIds, employeeIds: a.employeeIds, remindEveryDays: String(a.remindEveryDays) });
    });
  }, [token, docId]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!token) return;
    void api.get<Options>('/documents/policy-audience', token).then((r) => r.success && r.data && setOptions(r.data));
  }, [token]);

  const save = async () => {
    if (!token) return;
    setBusy(true);
    setMessage('');
    const r = await api.put(`/documents/documents/${docId}/acceptance/assignment`, { ...form, remindEveryDays: Number(form.remindEveryDays) || 0, active: true }, token);
    setBusy(false);
    setMessage(r.success ? 'Saved. People newly assigned have been asked to accept.' : r.message ?? 'Could not save');
    load();
  };
  const remind = async () => {
    if (!token) return;
    setBusy(true);
    const r = await api.post<{ reminded: number }>(`/documents/documents/${docId}/acceptance/remind`, {}, token);
    setBusy(false);
    setMessage(r.success ? `Reminded ${r.data?.reminded ?? 0} people.` : r.message ?? 'Could not remind');
  };

  const people = options.employees.map((e) => ({ id: e._id, name: e.name, hint: e.department || e.email }));
  return (
    <Modal title={`Acceptance: ${report?.policy.title ?? ''}`} onClose={onClose} wide footer={<><GhostButton onClick={onClose}>Close</GhostButton><PrimaryButton onClick={save} disabled={busy}>Save assignment</PrimaryButton></>}>
      {report && !report.policy.live && (
        <p className="text-sm text-amber-500">This policy is {report.policy.status}. Employees see it once it is published (not draft or archived).</p>
      )}
      <Field label="Who must accept it">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.everyone} onChange={(e) => setForm({ ...form, everyone: e.target.checked })} />
          Everyone in the company
        </label>
      </Field>
      {!form.everyone && (
        <>
          <Field label="Teams">
            <div className="flex flex-wrap gap-2">
              {options.teams.length === 0 && <span className="text-xs text-[color:var(--text-muted)]">No teams yet.</span>}
              {options.teams.map((t) => (
                <label key={t._id} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={form.teamIds.includes(t._id)}
                    onChange={(e) => setForm({ ...form, teamIds: e.target.checked ? [...form.teamIds, t._id] : form.teamIds.filter((x) => x !== t._id) })}
                  />
                  {t.name}
                </label>
              ))}
            </div>
          </Field>
          <Field label="People">
            <PersonMultiSelect values={form.employeeIds} onChange={(v) => setForm({ ...form, employeeIds: v })} people={people} aria-label="People who must accept" />
          </Field>
        </>
      )}
      <Field label="Remind pending people every (days, 0 = never)">
        <TextInput type="number" min={0} max={90} value={form.remindEveryDays} onChange={(e) => setForm({ ...form, remindEveryDays: e.target.value })} />
      </Field>
      {message && <p className="text-sm text-[color:var(--text-muted)]" role="status">{message}</p>}

      {report && report.rows.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              <strong>{report.counts.accepted}</strong> of {report.counts.total} accepted version {report.policy.version} ·{' '}
              <strong>{report.counts.pending}</strong> pending
              {report.counts.noAccount ? ` · ${report.counts.noAccount} without an account` : ''}
            </p>
            {report.counts.pending > 0 && report.policy.live && (
              <GhostButton onClick={remind} disabled={busy}>Remind pending now</GhostButton>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-[color:var(--border-subtle)]">
            <table className="w-full text-sm">
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.employeeId} className="border-t border-[color:var(--border-subtle)] first:border-t-0">
                    <td className="px-3 py-2"><p className="font-medium">{r.name}</p><p className="text-[11px] text-[color:var(--text-muted)]">{r.department || r.email}</p></td>
                    <td className="px-3 py-2"><StatusPill label={LABEL[r.status]} tone={TONE[r.status]} /></td>
                    <td className="px-3 py-2 text-right text-[12px] text-[color:var(--text-muted)]">{r.acceptedAt ? new Date(r.acceptedAt).toLocaleDateString() : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
