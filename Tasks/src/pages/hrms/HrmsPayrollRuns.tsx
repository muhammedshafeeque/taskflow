import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { canAny } from '../../utils/moduleAccess';
import { hrmsApi, type PayComponent, type PayrollAdjustment, type PayrollRun, type PayrollSettings, type Payslip } from '../../lib/api';
import { Field, GhostButton, Modal, PrimaryButton, Select, SectionPage, StatusPill, TextInput, money } from '../../components/moduleKit';

const runTone = { draft: 'amber', finalized: 'blue', paid: 'green' } as const;

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function periodLabel(p: string) {
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

/** Monthly payroll: generate a draft, adjust, finalize, mark paid, print payslips. */
export function HrmsPayroll() {
  const { token, user } = useAuth();
  const canManage = canAny(user, 'taskflow.hr.payroll.manage');
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [period, setPeriod] = useState(currentPeriod());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Payslip | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadRuns = useCallback(async () => {
    if (!token) return;
    const r = await hrmsApi.payrollRuns(token);
    if (r.success && r.data) {
      setRuns(r.data);
      if (!run && r.data[0]) {
        const full = await hrmsApi.payrollRun(r.data[0]._id, token);
        if (full.success && full.data) setRun(full.data);
      }
    }
  }, [token, run]);

  useEffect(() => {
    void loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function act(fn: () => Promise<{ success: boolean; data?: PayrollRun; message?: string }>) {
    setBusy(true);
    setError('');
    const r = await fn();
    setBusy(false);
    if (r.success && r.data) {
      setRun(r.data);
      void loadRuns();
    } else setError(r.message ?? 'Action failed');
  }

  async function openRun(id: string) {
    if (!token) return;
    const r = await hrmsApi.payrollRun(id, token);
    if (r.success && r.data) setRun(r.data);
  }

  async function printPayslip(employeeId: string) {
    if (!token || !run) return;
    const r = await hrmsApi.payslipHtml(run._id, employeeId, token);
    if (!r.success || !r.data) return setError(r.message ?? 'Could not load payslip');
    const url = URL.createObjectURL(new Blob([r.data.html], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  if (!token) return null;
  const currency = run?.payslips?.[0]?.currency ?? 'USD';

  return (
    <SectionPage title="Payroll" subtitle="Monthly runs from each employee's CTC, salary components and loss-of-pay days.">
      <div className="flex flex-wrap items-end gap-3">
        {canManage && (
          <>
            <Field label="Month">
              <TextInput type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            </Field>
            <PrimaryButton disabled={busy || !period} onClick={() => act(() => hrmsApi.generatePayrollRun(period, token))}>
              {runs.some((r) => r.period === period) ? 'Recalculate draft' : 'Generate draft'}
            </PrimaryButton>
            <GhostButton onClick={() => setSettingsOpen(true)}>Salary components</GhostButton>
          </>
        )}
        {runs.length > 0 && (
          <Field label="Run">
            <Select value={run?._id ?? ''} onChange={(e) => openRun(e.target.value)}>
              {runs.map((r) => (
                <option key={r._id} value={r._id}>
                  {periodLabel(r.period)} · {r.status}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}

      {!run ? (
        <p className="text-sm text-[color:var(--text-muted)]">No payroll runs yet{canManage ? ' — pick a month and generate a draft.' : '.'}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-6 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-5 py-4">
            <div>
              <p className="text-xs text-[color:var(--text-muted)]">{periodLabel(run.period)}</p>
              <StatusPill label={run.status} tone={runTone[run.status]} />
            </div>
            <div><p className="text-xs text-[color:var(--text-muted)]">Gross</p><p className="text-xl font-bold">{money(run.totals.gross, currency)}</p></div>
            <div><p className="text-xs text-[color:var(--text-muted)]">Deductions</p><p className="text-xl font-bold">{money(run.totals.deductions, currency)}</p></div>
            <div><p className="text-xs text-[color:var(--text-muted)]">Net pay</p><p className="text-xl font-bold">{money(run.totals.net, currency)}</p></div>
            <div><p className="text-xs text-[color:var(--text-muted)]">Employees</p><p className="text-xl font-bold">{run.totals.employees}</p></div>
            {canManage && (
              <div className="ml-auto flex gap-2">
                {run.status === 'draft' && (
                  <PrimaryButton disabled={busy} onClick={() => window.confirm('Finalize this run? Payslips become read-only.') && act(() => hrmsApi.finalizePayrollRun(run._id, token))}>
                    Finalize
                  </PrimaryButton>
                )}
                {run.status === 'finalized' && (
                  <PrimaryButton disabled={busy} onClick={() => act(() => hrmsApi.markPayrollPaid(run._id, token))}>
                    Mark paid
                  </PrimaryButton>
                )}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-[color:var(--text-muted)]">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Employee</th>
                  <th className="text-right px-4 py-2.5 font-medium">LOP days</th>
                  <th className="text-right px-4 py-2.5 font-medium">Gross</th>
                  <th className="text-right px-4 py-2.5 font-medium">Deductions</th>
                  <th className="text-right px-4 py-2.5 font-medium">Net</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {(run.payslips ?? []).map((p) => (
                  <tr key={p.employeeId} className="border-t border-[color:var(--border-subtle)]">
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-[11px] text-[color:var(--text-muted)]">
                        {p.employeeCode} · {p.department || '—'}
                        {p.adjustments.length > 0 && ` · ${p.adjustments.length} adjustment${p.adjustments.length > 1 ? 's' : ''}`}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{p.lopDays || '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(p.gross, p.currency)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[color:var(--text-muted)]">{money(p.totalDeductions, p.currency)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">{money(p.net, p.currency)}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      {canManage && run.status === 'draft' && (
                        <button type="button" className="mr-3 text-xs text-[color:var(--accent)] hover:underline" onClick={() => setEditing(p)}>
                          Adjust
                        </button>
                      )}
                      <button type="button" className="text-xs text-[color:var(--accent)] hover:underline" onClick={() => printPayslip(p.employeeId)}>
                        Payslip
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {editing && run && (
        <AdjustmentsModal
          slip={editing}
          onClose={() => setEditing(null)}
          onSave={(adj) =>
            act(() => hrmsApi.setPayslipAdjustments(run._id, editing.employeeId, adj, token)).then(() => setEditing(null))
          }
        />
      )}
      {settingsOpen && <SettingsModal token={token} onClose={() => setSettingsOpen(false)} />}
    </SectionPage>
  );
}

function AdjustmentsModal({ slip, onClose, onSave }: { slip: Payslip; onClose: () => void; onSave: (a: PayrollAdjustment[]) => void }) {
  const [rows, setRows] = useState<PayrollAdjustment[]>(slip.adjustments.length ? slip.adjustments : [{ name: 'Bonus', amount: 0, kind: 'earning' }]);
  const patch = (i: number, p: Partial<PayrollAdjustment>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <Modal
      title={`Adjustments · ${slip.name}`}
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={() => onSave(rows.filter((r) => r.amount > 0))}>Save & recalculate</PrimaryButton>
        </>
      }
    >
      <p className="text-xs text-[color:var(--text-muted)]">One-off lines for this month only — bonuses, reimbursements, advance recovery.</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_8rem_auto] gap-2">
            <TextInput value={r.name} onChange={(e) => patch(i, { name: e.target.value })} />
            <Select value={r.kind} onChange={(e) => patch(i, { kind: e.target.value as PayrollAdjustment['kind'] })}>
              <option value="earning">Earning</option>
              <option value="deduction">Deduction</option>
            </Select>
            <TextInput type="number" min={0} step="0.01" value={r.amount} onChange={(e) => patch(i, { amount: Number(e.target.value) })} />
            <GhostButton onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>✕</GhostButton>
          </div>
        ))}
      </div>
      <GhostButton onClick={() => setRows((r) => [...r, { name: '', amount: 0, kind: 'earning' }])}>+ Add line</GhostButton>
    </Modal>
  );
}

function SettingsModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [settings, setSettings] = useState<PayrollSettings | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    hrmsApi.payrollSettings(token).then((r) => r.success && r.data && setSettings(r.data));
  }, [token]);
  const patch = (i: number, p: Partial<PayComponent>) =>
    setSettings((s) => (s ? { ...s, components: s.components.map((c, j) => (j === i ? { ...c, ...p } : c)) } : s));

  async function save() {
    if (!settings) return;
    const r = await hrmsApi.updatePayrollSettings(settings, token);
    if (r.success) onClose();
    else setError(r.message ?? 'Save failed');
  }

  return (
    <Modal
      title="Salary components"
      wide
      onClose={onClose}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={!settings}>Save</PrimaryButton>
        </>
      }
    >
      {!settings ? (
        <p className="text-sm text-[color:var(--text-muted)]">Loading…</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-[color:var(--text-muted)]">
            Applied to each employee&apos;s monthly CTC (annual ÷ 12). Anything not covered by earnings is paid as &quot;Other allowance&quot;. Name one earning
            &quot;Basic&quot; to use &quot;% of Basic&quot;. Recalculate draft runs after changing these.
          </p>
          {settings.components.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_8rem_10rem_7rem_auto] gap-2">
              <TextInput value={c.name} onChange={(e) => patch(i, { name: e.target.value })} />
              <Select value={c.kind} onChange={(e) => patch(i, { kind: e.target.value as PayComponent['kind'] })}>
                <option value="earning">Earning</option>
                <option value="deduction">Deduction</option>
              </Select>
              <Select value={c.calc} onChange={(e) => patch(i, { calc: e.target.value as PayComponent['calc'] })}>
                <option value="percent_of_ctc">% of CTC</option>
                <option value="percent_of_basic">% of Basic</option>
                <option value="fixed">Fixed amount</option>
              </Select>
              <TextInput type="number" min={0} step="0.01" value={c.value} onChange={(e) => patch(i, { value: Number(e.target.value) })} />
              <GhostButton onClick={() => setSettings((s) => (s ? { ...s, components: s.components.filter((_, j) => j !== i) } : s))}>✕</GhostButton>
            </div>
          ))}
          <GhostButton
            onClick={() => setSettings((s) => (s ? { ...s, components: [...s.components, { name: '', kind: 'deduction', calc: 'percent_of_basic', value: 12 }] } : s))}
          >
            + Add component
          </GhostButton>
          <Field label="Working days per month (for loss-of-pay)">
            <TextInput
              type="number"
              min={1}
              max={31}
              value={settings.workingDaysPerMonth}
              onChange={(e) => setSettings({ ...settings, workingDaysPerMonth: Number(e.target.value) })}
            />
          </Field>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
