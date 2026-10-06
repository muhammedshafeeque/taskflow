import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsAttendance } from './models/hrmsAttendance.model';
import { HrmsLeaveRequest } from './models/hrmsLeaveRequest.model';
import { DEFAULT_COMPONENTS, HrmsPayrollRun, HrmsPayrollSettings, type PayComponent } from './models/hrmsPayroll.model';

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isValidPeriod(period: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

function periodRange(period: string): { start: Date; end: Date } {
  const [y, m] = period.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

/** Pure payslip maths so it can be unit-tested. */
export function computePayslip(input: {
  monthlyCtc: number;
  components: PayComponent[];
  workingDays: number;
  lopDays: number;
  adjustments?: Array<{ name: string; amount: number; kind: 'earning' | 'deduction' }>;
}) {
  const { monthlyCtc, components, workingDays } = input;
  const lopDays = Math.min(Math.max(0, input.lopDays), workingDays);
  const payable = workingDays > 0 ? (workingDays - lopDays) / workingDays : 1;

  const basicComp = components.find((c) => c.kind === 'earning' && c.name.trim().toLowerCase() === 'basic');
  const basicFull = basicComp
    ? basicComp.calc === 'fixed'
      ? basicComp.value
      : basicComp.calc === 'percent_of_ctc'
        ? (monthlyCtc * basicComp.value) / 100
        : 0
    : monthlyCtc;

  const amountFor = (c: PayComponent) =>
    c.calc === 'fixed' ? c.value : c.calc === 'percent_of_ctc' ? (monthlyCtc * c.value) / 100 : (basicFull * c.value) / 100;

  const earnings = components
    .filter((c) => c.kind === 'earning')
    .map((c) => ({ name: c.name, amount: round2(amountFor(c) * payable) }));
  const deductions = components
    .filter((c) => c.kind === 'deduction')
    // Percentage deductions follow earned (pro-rated) pay; fixed ones don't.
    .map((c) => ({ name: c.name, amount: round2(c.calc === 'fixed' ? c.value : amountFor(c) * payable) }));

  // Whatever CTC isn't covered by components is paid as a balancing allowance.
  const componentEarnings = earnings.reduce((s, e) => s + e.amount, 0);
  const balance = round2(monthlyCtc * payable - componentEarnings);
  if (balance > 0.009) earnings.push({ name: 'Other allowance', amount: balance });

  for (const a of input.adjustments ?? []) {
    (a.kind === 'deduction' ? deductions : earnings).push({ name: a.name, amount: round2(a.amount) });
  }

  const gross = round2(earnings.reduce((s, e) => s + e.amount, 0));
  const totalDeductions = round2(deductions.reduce((s, d) => s + d.amount, 0));
  return { lopDays, earnings, deductions, gross, totalDeductions, net: round2(gross - totalDeductions) };
}

export async function getPayrollSettings(workspaceId: string | null | undefined) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const doc = await HrmsPayrollSettings.findOne({ taskflowOrganizationId: orgOid }).lean();
  return doc ?? { taskflowOrganizationId: orgOid, components: DEFAULT_COMPONENTS, workingDaysPerMonth: 22 };
}

export async function updatePayrollSettings(
  workspaceId: string | null | undefined,
  input: { components?: PayComponent[]; workingDaysPerMonth?: number }
) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const $set: Record<string, unknown> = {};
  if (input.components !== undefined) {
    if (!Array.isArray(input.components) || input.components.length > 30) throw new ApiError(400, 'Up to 30 components');
    const comps = input.components.map((c) => ({
      name: String(c.name ?? '').trim().slice(0, 60),
      kind: c.kind === 'deduction' ? 'deduction' : 'earning',
      calc: ['fixed', 'percent_of_ctc', 'percent_of_basic'].includes(c.calc) ? c.calc : 'fixed',
      value: Number(c.value),
    }));
    if (comps.some((c) => !c.name || !Number.isFinite(c.value) || c.value < 0)) throw new ApiError(400, 'Each component needs a name and a non-negative value');
    const pctOfCtc = comps.filter((c) => c.kind === 'earning' && c.calc === 'percent_of_ctc').reduce((s, c) => s + c.value, 0);
    if (pctOfCtc > 100) throw new ApiError(400, 'Earnings as % of CTC add up to more than 100%');
    $set.components = comps;
  }
  if (input.workingDaysPerMonth !== undefined) {
    const d = Number(input.workingDaysPerMonth);
    if (!Number.isInteger(d) || d < 1 || d > 31) throw new ApiError(400, 'workingDaysPerMonth must be 1–31');
    $set.workingDaysPerMonth = d;
  }
  return HrmsPayrollSettings.findOneAndUpdate({ taskflowOrganizationId: orgOid }, { $set }, { upsert: true, new: true }).lean();
}

/** Loss-of-pay days per employee: approved unpaid leave + absences (half days count 0.5). */
async function lopDaysByEmployee(orgOid: mongoose.Types.ObjectId, period: string): Promise<Map<string, number>> {
  const { start, end } = periodRange(period);
  const [attendance, leave] = await Promise.all([
    HrmsAttendance.find({ taskflowOrganizationId: orgOid, date: { $gte: start, $lt: end }, status: { $in: ['absent', 'half_day'] } })
      .select('employeeId status')
      .lean(),
    HrmsLeaveRequest.find({
      taskflowOrganizationId: orgOid,
      type: 'unpaid',
      status: 'approved',
      startDate: { $lt: end },
      endDate: { $gte: start },
    })
      .select('employeeId startDate endDate days')
      .lean(),
  ]);
  const out = new Map<string, number>();
  const add = (id: unknown, n: number) => out.set(String(id), (out.get(String(id)) ?? 0) + n);
  for (const a of attendance) add(a.employeeId, a.status === 'half_day' ? 0.5 : 1);
  for (const l of leave) {
    // Pro-rate leave that spans month boundaries by calendar overlap.
    const ls = new Date(l.startDate).getTime();
    const le = new Date(l.endDate).getTime() + 86_400_000;
    const span = Math.max(1, (le - ls) / 86_400_000);
    const overlap = Math.max(0, (Math.min(le, end.getTime()) - Math.max(ls, start.getTime())) / 86_400_000);
    add(l.employeeId, round2((l.days ?? span) * (overlap / span)));
  }
  return out;
}

function summarize(payslips: Array<{ gross?: number | null; totalDeductions?: number | null; net?: number | null }>) {
  return {
    gross: round2(payslips.reduce((s, p) => s + (p.gross ?? 0), 0)),
    deductions: round2(payslips.reduce((s, p) => s + (p.totalDeductions ?? 0), 0)),
    net: round2(payslips.reduce((s, p) => s + (p.net ?? 0), 0)),
    employees: payslips.length,
  };
}

export async function listPayrollRuns(workspaceId: string | null | undefined) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  return HrmsPayrollRun.find({ taskflowOrganizationId: orgOid }).select('-payslips').sort({ period: -1 }).limit(36).lean();
}

export async function getPayrollRunById(workspaceId: string | null | undefined, id: string) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const run = await HrmsPayrollRun.findOne({ _id: id, taskflowOrganizationId: orgOid }).lean();
  if (!run) throw new ApiError(404, 'Payroll run not found');
  return run;
}

/** Create (or recalculate) the draft run for a month. Finalized runs are immutable. */
export async function generatePayrollRun(workspaceId: string | null | undefined, period: string) {
  if (!isValidPeriod(period)) throw new ApiError(400, 'Period must be YYYY-MM');
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const existing = await HrmsPayrollRun.findOne({ taskflowOrganizationId: orgOid, period });
  if (existing && existing.status !== 'draft') throw new ApiError(409, `Payroll for ${period} is already ${existing.status}`);

  const settings = await getPayrollSettings(String(orgOid));
  const { start, end } = periodRange(period);
  const [employees, lop] = await Promise.all([
    HrmsEmployee.find({
      taskflowOrganizationId: orgOid,
      joinedDate: { $lt: end },
      $or: [{ exitDate: null }, { exitDate: { $gte: start } }],
      status: { $ne: 'terminated' },
    })
      .sort({ department: 1, name: 1 })
      .lean(),
    lopDaysByEmployee(orgOid, period),
  ]);

  // Keep manual adjustments when recalculating a draft.
  const previous = new Map((existing?.payslips ?? []).map((p) => [String(p.employeeId), p.adjustments ?? []]));
  const payslips = employees.map((e) => {
    const monthlyCtc = round2((e.annualCtc ?? 0) / 12);
    const adjustments = (previous.get(String(e._id)) ?? []) as Array<{ name: string; amount: number; kind: 'earning' | 'deduction' }>;
    const calc = computePayslip({
      monthlyCtc,
      components: settings.components as PayComponent[],
      workingDays: settings.workingDaysPerMonth,
      lopDays: lop.get(String(e._id)) ?? 0,
      adjustments,
    });
    return {
      employeeId: e._id,
      name: e.name,
      employeeCode: e.employeeCode,
      department: e.department,
      designation: e.designation,
      currency: e.currency,
      monthlyCtc,
      workingDays: settings.workingDaysPerMonth,
      adjustments,
      ...calc,
    };
  });

  return HrmsPayrollRun.findOneAndUpdate(
    { taskflowOrganizationId: orgOid, period },
    { $set: { payslips, totals: summarize(payslips), status: 'draft' } },
    { upsert: true, new: true }
  ).lean();
}

export async function setPayslipAdjustments(
  workspaceId: string | null | undefined,
  runId: string,
  employeeId: string,
  adjustments: Array<{ name: string; amount: number; kind: 'earning' | 'deduction' }>
) {
  const run = await getPayrollRunById(workspaceId, runId);
  if (run.status !== 'draft') throw new ApiError(409, 'Only draft runs can be adjusted');
  if (!Array.isArray(adjustments) || adjustments.length > 20) throw new ApiError(400, 'Up to 20 adjustments');
  const clean = adjustments.map((a) => ({
    name: String(a.name ?? '').trim().slice(0, 60) || 'Adjustment',
    amount: round2(Math.abs(Number(a.amount) || 0)),
    kind: a.kind === 'deduction' ? ('deduction' as const) : ('earning' as const),
  }));
  const slip = run.payslips.find((p) => String(p.employeeId) === employeeId);
  if (!slip) throw new ApiError(404, 'Employee not in this run');
  // Store, then recalculate the whole draft so totals stay consistent.
  await HrmsPayrollRun.updateOne(
    { _id: run._id, 'payslips.employeeId': new mongoose.Types.ObjectId(employeeId) },
    { $set: { 'payslips.$.adjustments': clean } }
  );
  return generatePayrollRun(workspaceId, run.period);
}

export async function setPayrollRunStatus(
  workspaceId: string | null | undefined,
  runId: string,
  status: 'finalized' | 'paid',
  userId: string
) {
  const run = await getPayrollRunById(workspaceId, runId);
  if (status === 'finalized' && run.status !== 'draft') throw new ApiError(409, 'Only a draft can be finalized');
  if (status === 'paid' && run.status !== 'finalized') throw new ApiError(409, 'Finalize the run before marking it paid');
  const $set: Record<string, unknown> =
    status === 'finalized'
      ? { status, finalizedAt: new Date(), finalizedBy: new mongoose.Types.ObjectId(userId) }
      : { status, paidAt: new Date() };
  return HrmsPayrollRun.findByIdAndUpdate(run._id, { $set }, { new: true }).lean();
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Printable payslip (HTML — print to PDF from the browser). */
export async function renderPayslipHtml(workspaceId: string | null | undefined, runId: string, employeeId: string, companyName: string) {
  const run = await getPayrollRunById(workspaceId, runId);
  const p = run.payslips.find((s) => String(s.employeeId) === employeeId);
  if (!p) throw new ApiError(404, 'Payslip not found');
  const fmt = (n?: number | null) =>
    new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency || 'USD' }).format(n ?? 0);
  const rows = (lines: Array<{ name?: string | null; amount?: number | null }>) =>
    lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="r">${fmt(l.amount)}</td></tr>`).join('');
  const [y, m] = run.period.split('-').map(Number);
  const month = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${esc(p.employeeCode)} ${esc(run.period)}</title>
<style>body{font-family:Arial,sans-serif;color:#111;max-width:760px;margin:32px auto;padding:0 16px}h1{font-size:20px;margin:0}
.muted{color:#666;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:8px}td,th{padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;text-align:left}
.r{text-align:right}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:20px}.net{margin-top:20px;padding:12px;background:#f5f5f7;border-radius:8px;font-size:16px;display:flex;justify-content:space-between}
@media print{button{display:none}}</style></head><body>
<button onclick="window.print()" style="float:right">Print / Save PDF</button>
<h1>${esc(companyName)}</h1><p class="muted">Payslip for ${esc(month)}${run.status === 'draft' ? ' — DRAFT' : ''}</p>
<table><tr><td><b>${esc(p.name)}</b><br><span class="muted">${esc(p.employeeCode)} · ${esc(p.designation ?? '')} · ${esc(p.department ?? '')}</span></td>
<td class="r">Working days: ${p.workingDays}<br>Loss of pay days: ${p.lopDays ?? 0}</td></tr></table>
<div class="grid"><div><b>Earnings</b><table>${rows(p.earnings)}<tr><th>Gross</th><th class="r">${fmt(p.gross)}</th></tr></table></div>
<div><b>Deductions</b><table>${rows(p.deductions) || '<tr><td class="muted">None</td><td></td></tr>'}<tr><th>Total</th><th class="r">${fmt(p.totalDeductions)}</th></tr></table></div></div>
<div class="net"><b>Net pay</b><b>${fmt(p.net)}</b></div>
<p class="muted">This is a system-generated payslip.</p></body></html>`;
}
