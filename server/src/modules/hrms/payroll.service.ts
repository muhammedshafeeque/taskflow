import { autoPost, postPayroll } from '../ledger/ledger.service';
import { assertApprovedOrSubmit } from '../approvals/approvals.service';
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsAttendance } from './models/hrmsAttendance.model';
import { CommissionEntry } from '../crm/commissions/commissions';
import { calendarDay, loadWorkCalendar, lossOfPayForMonth, workingDaysBetween } from './lossOfPay';
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

/** Loss-of-pay days per employee: absences and approved unpaid leave, each date counted once (half days ½). */
async function lopDaysByEmployee(orgOid: mongoose.Types.ObjectId, period: string): Promise<Map<string, number>> {
  const { start, end } = periodRange(period);
  return lossOfPayForMonth(orgOid, start, end);
}

type SlipTotals = { currency?: string | null; gross?: number | null; totalDeductions?: number | null; net?: number | null };

/** Totals for each currency, most-paid-in first. Amounts in different currencies are never added together. */
export function totalsByCurrency(payslips: SlipTotals[]) {
  const by = new Map<string, { currency: string; gross: number; deductions: number; net: number; employees: number }>();
  for (const p of payslips) {
    const currency = p.currency || 'USD';
    const t = by.get(currency) ?? { currency, gross: 0, deductions: 0, net: 0, employees: 0 };
    t.gross = round2(t.gross + (p.gross ?? 0));
    t.deductions = round2(t.deductions + (p.totalDeductions ?? 0));
    t.net = round2(t.net + (p.net ?? 0));
    t.employees += 1;
    by.set(currency, t);
  }
  return [...by.values()].sort((a, b) => b.employees - a.employees || a.currency.localeCompare(b.currency));
}

/**
 * `totals` holds the main currency (most people paid in it) plus the overall head count, so single-currency
 * companies see what they always saw; `totalsByCurrency` has every currency.
 */
function summarize(payslips: SlipTotals[]) {
  const byCurrency = totalsByCurrency(payslips);
  const main = byCurrency[0];
  return {
    totals: { currency: main?.currency, gross: main?.gross ?? 0, deductions: main?.deductions ?? 0, net: main?.net ?? 0, employees: payslips.length },
    totalsByCurrency: byCurrency,
  };
}

/**
 * Of a month's working days, how many fall outside someone's employment (before joining, after the last day),
 * scaled to the payroll's working-days basis so the payslip maths stays the same.
 */
export function daysNotEmployed(
  e: { joinedDate: Date; exitDate?: Date | null },
  month: { from: string; last: string },
  calendar: { weekendDays: number[]; holidays: Set<string> },
  workingDaysBasis: number
): number {
  const first = calendarDay(e.joinedDate) > month.from ? calendarDay(e.joinedDate) : month.from;
  const last = e.exitDate && calendarDay(e.exitDate) < month.last ? calendarDay(e.exitDate) : month.last;
  const inMonth = workingDaysBetween(month.from, month.last, calendar.weekendDays, calendar.holidays);
  if (inMonth === 0) return 0;
  const employed = first > last ? 0 : workingDaysBetween(first, last, calendar.weekendDays, calendar.holidays);
  return round2(workingDaysBasis * (1 - employed / inMonth));
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
  const HALF_DAY = 12 * 3_600_000;
  const [found, lop, calendar] = await Promise.all([
    // Leavers are paid up to their last day, so they are in the run of the month they leave.
    HrmsEmployee.find({
      taskflowOrganizationId: orgOid,
      joinedDate: { $lt: new Date(end.getTime() + HALF_DAY) },
      $or: [{ exitDate: null }, { exitDate: { $gte: new Date(start.getTime() - HALF_DAY) } }],
    })
      .sort({ department: 1, name: 1 })
      .lean(),
    lopDaysByEmployee(orgOid, period),
    loadWorkCalendar(orgOid, start, end),
  ]);
  const month = { from: start.toISOString().slice(0, 10), last: new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10) };
  const employees = found.filter(
    (e) =>
      calendarDay(e.joinedDate) <= month.last &&
      (!e.exitDate || calendarDay(e.exitDate) >= month.from) &&
      // Terminated without a last day: nothing to pay.
      (e.status !== 'terminated' || Boolean(e.exitDate))
  );

  // Approved sales commission, paid once: entries already held by this draft, or held by no run.
  const run =
    existing ?? (await HrmsPayrollRun.findOneAndUpdate({ taskflowOrganizationId: orgOid, period }, { $setOnInsert: { status: 'draft' } }, { upsert: true, new: true }));
  if (!run) throw new ApiError(500, 'Could not start the payroll run');
  const commissionsByUser = await claimCommissions(orgOid, run._id as mongoose.Types.ObjectId, employees);

  // Keep manual adjustments when recalculating a draft.
  const previous = new Map((existing?.payslips ?? []).map((p) => [String(p.employeeId), p.adjustments ?? []]));
  const payslips = employees.map((e) => {
    const monthlyCtc = round2((e.annualCtc ?? 0) / 12);
    const adjustments = (previous.get(String(e._id)) ?? []) as Array<{ name: string; amount: number; kind: 'earning' | 'deduction' }>;
    const commissions = commissionsByUser.get(String(e.userId ?? '')) ?? [];
    const notEmployed = daysNotEmployed(e, month, { weekendDays: calendar.weekendDays, holidays: calendar.holidaysAt(e.location) }, settings.workingDaysPerMonth);
    const calc = computePayslip({
      monthlyCtc,
      components: settings.components as PayComponent[],
      workingDays: settings.workingDaysPerMonth,
      lopDays: (lop.get(String(e._id)) ?? 0) + notEmployed,
      adjustments: [...adjustments, ...commissions.filter((c) => c.currency === e.currency).map((c) => ({ name: c.label, amount: c.amount, kind: 'earning' as const }))],
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
      commissions: commissions.map((c) => ({ entryId: c.entryId, name: c.label, amount: c.amount, currency: c.currency, paid: c.currency === e.currency })),
      ...calc,
      // Loss of pay above, split so the payslip can show both.
      daysNotEmployed: Math.min(notEmployed, settings.workingDaysPerMonth),
      lopDays: round2(Math.max(0, calc.lopDays - notEmployed)),
    };
  });

  return HrmsPayrollRun.findOneAndUpdate(
    { _id: run._id },
    { $set: { payslips, ...summarize(payslips), status: 'draft' } },
    { upsert: true, new: true }
  ).lean();
}

type ClaimedCommission = { entryId: mongoose.Types.ObjectId; amount: number; currency: string; label: string };

/**
 * Hold the approved, unpaid commission of the people in this run for this run, and let go of anything it held
 * that no longer applies. Another draft's entries are left alone, so two months can't both pay one entry.
 */
async function claimCommissions(
  orgOid: mongoose.Types.ObjectId,
  runId: mongoose.Types.ObjectId,
  employees: Array<{ userId?: unknown; currency?: string | null }>
): Promise<Map<string, ClaimedCommission[]>> {
  const userIds = employees.map((e) => e.userId).filter(Boolean) as mongoose.Types.ObjectId[];
  await CommissionEntry.updateMany(
    { taskflowOrganizationId: orgOid, payrollRunId: runId, $or: [{ status: { $ne: 'approved' } }, { userId: { $nin: userIds } }] },
    { $set: { payrollRunId: null } }
  );
  await CommissionEntry.updateMany(
    { taskflowOrganizationId: orgOid, status: 'approved', userId: { $in: userIds }, payrollRunId: null },
    { $set: { payrollRunId: runId } }
  );
  const held = await CommissionEntry.find({ taskflowOrganizationId: orgOid, payrollRunId: runId, status: 'approved' })
    .populate<{ dealId: { title?: string } | null }>('dealId', 'title')
    .sort({ createdAt: 1 })
    .lean();
  const by = new Map<string, ClaimedCommission[]>();
  for (const c of held) {
    const list = by.get(String(c.userId)) ?? [];
    list.push({ entryId: c._id as mongoose.Types.ObjectId, amount: round2(c.amount), currency: c.currency || 'USD', label: `Commission: ${c.dealId?.title ?? 'deal'}` });
    by.set(String(c.userId), list);
  }
  return by;
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
  if (status === 'finalized') {
    // With a payroll approval chain on, the run must be approved first (the first try sends it for approval).
    await assertApprovedOrSubmit(String(run.taskflowOrganizationId), 'payroll', String(run._id), userId, 'finalize this payroll run');
  }
  if (status === 'finalized') {
    // What the payslips pay must still be what the commission screen says: approved, same amount, held by this run.
    const lines = run.payslips.flatMap((p) => (p.commissions ?? []).filter((c) => c.paid));
    const current = await CommissionEntry.find({ _id: { $in: lines.map((c) => c.entryId) }, payrollRunId: run._id, status: 'approved' }).select('amount').lean();
    const amountOf = new Map(current.map((c) => [String(c._id), round2(c.amount)]));
    const changed = lines.some((c) => amountOf.get(String(c.entryId)) !== c.amount);
    const listed = run.payslips.flatMap((p) => (p.commissions ?? []).map((c) => c.entryId));
    const added = await CommissionEntry.exists({ payrollRunId: run._id, status: 'approved', _id: { $nin: listed } });
    if (changed || added) throw new ApiError(409, 'Commission changed since this draft was calculated. Recalculate the draft, then finalize.');
  }
  if (status === 'paid' && run.status !== 'finalized') throw new ApiError(409, 'Finalize the run before marking it paid');
  const $set: Record<string, unknown> =
    status === 'finalized'
      ? { status, finalizedAt: new Date(), finalizedBy: new mongoose.Types.ObjectId(userId) }
      : { status, paidAt: new Date() };
  const updated = await HrmsPayrollRun.findByIdAndUpdate(run._id, { $set }, { new: true }).lean();
  if (status === 'paid' && updated) {
    const paidIds = updated.payslips.flatMap((p) => (p.commissions ?? []).filter((c) => c.paid).map((c) => c.entryId));
    await CommissionEntry.updateMany({ _id: { $in: paidIds }, payrollRunId: updated._id }, { $set: { status: 'paid', paidAt: new Date() } });
    // Entries in another currency than the payslip stay approved, for another run or by hand.
    await CommissionEntry.updateMany({ payrollRunId: updated._id, status: 'approved' }, { $set: { payrollRunId: null } });
    // One journal per currency; a single-currency run keeps its run id as the source, as before.
    const byCurrency = totalsByCurrency(updated.payslips);
    for (const t of byCurrency) {
      const sourceId = byCurrency.length === 1 ? String(updated._id) : `${updated._id}:${t.currency}`;
      autoPost(() => postPayroll(String(run.taskflowOrganizationId), { _id: sourceId, period: updated.period, totals: t }, t.currency), `payroll ${run.period} ${t.currency}`);
    }
  }
  return updated;
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
<td class="r">Working days: ${p.workingDays}<br>Loss of pay days: ${p.lopDays ?? 0}${p.daysNotEmployed ? `<br>Days not employed: ${p.daysNotEmployed}` : ''}</td></tr></table>
<div class="grid"><div><b>Earnings</b><table>${rows(p.earnings)}<tr><th>Gross</th><th class="r">${fmt(p.gross)}</th></tr></table></div>
<div><b>Deductions</b><table>${rows(p.deductions) || '<tr><td class="muted">None</td><td></td></tr>'}<tr><th>Total</th><th class="r">${fmt(p.totalDeductions)}</th></tr></table></div></div>
<div class="net"><b>Net pay</b><b>${fmt(p.net)}</b></div>
<p class="muted">This is a system-generated payslip.</p></body></html>`;
}
