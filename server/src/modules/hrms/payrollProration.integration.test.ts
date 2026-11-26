import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { daysNotEmployed, generatePayrollRun, setPayrollRunStatus, totalsByCurrency } from './payroll.service';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsHoliday, HrmsSettings } from './models/hrmsPolicy.model';
import { HrmsPayrollSettings } from './models/hrmsPayroll.model';
import { AccountsSettings, JournalEntry, LedgerAccount } from '../ledger/ledger.models';

jest.setTimeout(120_000);
const org = new mongoose.Types.ObjectId();
let mongo: MongoMemoryServer;
// December 2026: 23 weekdays (Tue 1st … Thu 31st).
const DEC = { from: '2026-12-01', last: '2026-12-31' };
const cal = { weekendDays: [0, 6], holidays: new Set<string>() };
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const person = (name: string, extra: Record<string, unknown>) =>
  HrmsEmployee.create({ taskflowOrganizationId: org, employeeCode: name, name, joinedDate: d('2025-01-01'), annualCtc: 264_000, currency: 'INR', ...extra });
const slipOf = (run: { payslips: Array<{ name?: string | null }> } | null, name: string) => run!.payslips.find((p) => p.name === name) as Record<string, number>;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await HrmsPayrollSettings.create({ taskflowOrganizationId: org, workingDaysPerMonth: 23, components: [{ name: 'Basic', kind: 'earning', calc: 'percent_of_ctc', value: 100 }] });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('days not employed', () => {
  it('counts working days before joining and after leaving, on the payroll basis', () => {
    expect(daysNotEmployed({ joinedDate: d('2025-01-01') }, DEC, cal, 23)).toBe(0);
    expect(daysNotEmployed({ joinedDate: d('2026-12-16') }, DEC, cal, 23)).toBe(11); // paid 16th–31st: 12 weekdays
    expect(daysNotEmployed({ joinedDate: d('2025-01-01'), exitDate: d('2026-12-04') }, DEC, cal, 23)).toBe(19); // paid 1st–4th
    expect(daysNotEmployed({ joinedDate: d('2026-12-07'), exitDate: d('2026-12-11') }, DEC, cal, 23)).toBe(18);
    expect(daysNotEmployed({ joinedDate: d('2026-12-16') }, DEC, cal, 22)).toBe(10.52); // other basis: same share
    expect(daysNotEmployed({ joinedDate: d('2026-12-16') }, DEC, { ...cal, holidays: new Set(['2026-12-25']) }, 23)).toBe(11.5); // 11 of 22 working days
  });
});

describe('payroll run (AUT-18)', () => {
  it('pro-rates joiners and leavers and pays a leaver in their exit month', async () => {
    await person('Whole', {});
    await person('Joiner', { joinedDate: d('2026-12-16') });
    await person('Leaver', { status: 'terminated', exitDate: d('2026-12-04') });
    await person('LeftEarlier', { status: 'terminated', exitDate: d('2026-11-30') });
    await person('LeftNoDate', { status: 'terminated' });
    await person('Future', { joinedDate: d('2027-01-04') });
    const run = await generatePayrollRun(String(org), '2026-12');
    expect(run!.payslips.map((p) => p.name).sort()).toEqual(['Joiner', 'Leaver', 'Whole']);
    expect(slipOf(run, 'Whole')).toMatchObject({ gross: 22_000, daysNotEmployed: 0, lopDays: 0 });
    expect(slipOf(run, 'Joiner')).toMatchObject({ gross: 11_478.26, daysNotEmployed: 11, lopDays: 0 }); // 12 of 23
    expect(slipOf(run, 'Leaver')).toMatchObject({ gross: 3_826.09, daysNotEmployed: 19 }); // 4 of 23
  });

  it('uses the employee location for holidays', async () => {
    await HrmsSettings.create({ taskflowOrganizationId: org, weekendDays: [0, 6] });
    await HrmsHoliday.create({ taskflowOrganizationId: org, date: d('2026-12-25'), name: 'Christmas', location: 'Kochi' });
    await person('Kochi', { joinedDate: d('2026-12-16'), location: 'Kochi' });
    await person('Goa', { joinedDate: d('2026-12-16'), location: 'Goa' });
    const run = await generatePayrollRun(String(org), '2026-12');
    expect([slipOf(run, 'Kochi').daysNotEmployed, slipOf(run, 'Goa').daysNotEmployed]).toEqual([11.5, 11]);
  });

  it('totals and posts each currency on its own', async () => {
    await person('A', {});
    await person('B', {});
    await person('C', { currency: 'USD', annualCtc: 12_000 });
    const [salary, bank] = await LedgerAccount.create([
      { taskflowOrganizationId: org, code: '5000', name: 'Salaries', type: 'expense' },
      { taskflowOrganizationId: org, code: '1000', name: 'Bank', type: 'asset' },
    ]);
    await AccountsSettings.create({ taskflowOrganizationId: org, autoPost: true, accountMap: { salaryExpense: salary._id, bank: bank._id } });
    const run = await generatePayrollRun(String(org), '2026-12');
    expect(run!.totalsByCurrency).toEqual([
      { currency: 'INR', gross: 44_000, deductions: 0, net: 44_000, employees: 2 },
      { currency: 'USD', gross: 1_000, deductions: 0, net: 1_000, employees: 1 },
    ]);
    expect(run!.totals).toMatchObject({ currency: 'INR', gross: 44_000, employees: 3 });
    const user = String(new mongoose.Types.ObjectId());
    await setPayrollRunStatus(String(org), String(run!._id), 'finalized', user);
    await setPayrollRunStatus(String(org), String(run!._id), 'paid', user);
    await new Promise((r) => setTimeout(r, 500));
    const journals = await JournalEntry.find({ sourceType: 'payroll' }).lean();
    expect(journals.map((j) => [j.currency, j.lines.reduce((s, l) => s + (l.debit ?? 0), 0)]).sort()).toEqual([['INR', 44_000], ['USD', 1_000]]);
  });

  it('keeps one total and the run id as the journal source for single-currency runs', () => {
    expect(totalsByCurrency([{ currency: 'INR', gross: 1, net: 1 }, { currency: 'INR', gross: 2, net: 2 }])).toEqual([{ currency: 'INR', gross: 3, deductions: 0, net: 3, employees: 2 }]);
  });
});
