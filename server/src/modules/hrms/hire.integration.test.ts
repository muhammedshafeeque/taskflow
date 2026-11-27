import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createEmployee } from './hrms.service';
import { hireCandidate } from './people.service';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsCandidate, HrmsChecklist, HrmsChecklistTemplate, HrmsJobOpening } from './models/hrmsPeople.model';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const HR = ['taskflow.hr.recruitment.manage', 'taskflow.hr.salary.manage'];
const org = new mongoose.Types.ObjectId();
const actor = String(new mongoose.Types.ObjectId());
let mongo: MongoMemoryServer;
let jobId: mongoose.Types.ObjectId;

const candidate = async (extra: Record<string, unknown> = {}) =>
  String((await HrmsCandidate.create({ taskflowOrganizationId: org, jobId, name: 'Jo', email: 'jo@example.com', stage: 'Offer', ...extra }))._id);
const hire = (id: string, input: Record<string, unknown> = {}, perms = HR) => hireCandidate(String(org), id, input, actor, perms);
const status = async (id: string) => (await HrmsCandidate.findById(id).lean())!;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await HrmsEmployee.init();
});
beforeEach(async () => {
  await Promise.all([HrmsEmployee, HrmsCandidate, HrmsChecklist, HrmsChecklistTemplate, HrmsJobOpening].map((m) => (m as typeof HrmsEmployee).deleteMany({})));
  jobId = (await HrmsJobOpening.create({ taskflowOrganizationId: org, title: 'Developer', department: 'Dev', employmentType: 'intern', stages: ['Applied', 'Offer', 'Hired'], currency: 'INR' , openings: 50 }))._id as mongoose.Types.ObjectId;
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('hiring a candidate (AUT-12)', () => {
  it('works with only a joining date, as the old screen sent', async () => {
    const id = await candidate();
    const { employee, checklist } = await hire(id, { joinedDate: '2026-12-01' });
    expect(employee).toMatchObject({ employeeCode: 'EMP-0001', name: 'Jo', department: 'Dev', designation: 'Developer', employmentType: 'intern', status: 'probation', currency: 'INR' });
    expect(checklist).toBeNull();
    expect(await status(id)).toMatchObject({ status: 'hired', stage: 'Hired', hiredEmployeeId: employee._id });
  });

  it('uses the chosen title, code and CTC, and starts the onboarding checklist from the joining date', async () => {
    const t = await HrmsChecklistTemplate.create({ taskflowOrganizationId: org, name: 'Staff', kind: 'onboarding', tasks: [{ title: 'Laptop', assignTo: 'hr', dueOffsetDays: 2 }] });
    const { employee, checklist } = await hire(await candidate(), { joinedDate: '2026-12-01', designation: 'Junior Developer', employeeCode: 'DEV-7', annualCtc: 900, onboardingTemplateId: String(t._id) });
    expect(employee).toMatchObject({ employeeCode: 'DEV-7', designation: 'Junior Developer', annualCtc: 900 });
    expect(checklist).toMatchObject({ kind: 'onboarding', employeeId: employee._id });
    expect(checklist!.tasks[0].dueDate!.toISOString().slice(0, 10)).toBe('2026-12-03');
  });

  it('refuses bad input before creating anything, so it can be retried', async () => {
    const off = await HrmsChecklistTemplate.create({ taskflowOrganizationId: org, name: 'Exit', kind: 'offboarding' });
    const id = await candidate();
    await HrmsEmployee.create({ taskflowOrganizationId: org, employeeCode: 'TAKEN', name: 'x', joinedDate: new Date() });
    for (const [input, code] of [
      [{ joinedDate: 'soon' }, 400],
      [{ annualCtc: -1 }, 400],
      [{ onboardingTemplateId: 'nope' }, 400],
      [{ onboardingTemplateId: String(new mongoose.Types.ObjectId()) }, 400],
      [{ onboardingTemplateId: String(off._id) }, 400],
      [{ employeeCode: 'TAKEN' }, 409],
    ] as Array<[Record<string, unknown>, number]>) {
      await expect(hire(id, input)).rejects.toMatchObject({ statusCode: code });
      expect(await status(id)).toMatchObject({ status: 'active', stage: 'Offer' });
    }
    expect(await HrmsEmployee.countDocuments()).toBe(1);
    await expect(hire(id)).resolves.toBeTruthy();
  });

  it('hires once, even when pressed twice at the same time', async () => {
    const id = await candidate();
    const results = await Promise.allSettled([hire(id), hire(id), hire(id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await HrmsEmployee.countDocuments()).toBe(1);
    await expect(hire(id)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('does not hire rejected candidates, or set pay without pay access', async () => {
    const rejected = await candidate({ status: 'rejected' });
    await expect(hire(rejected)).rejects.toMatchObject({ statusCode: 409 });
    expect(await status(rejected)).toMatchObject({ status: 'rejected', stage: 'Offer' });
    await expect(hire(await candidate(), { annualCtc: 5 }, ['taskflow.hr.recruitment.manage'])).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('automatic employee codes', () => {
  it('continue after the highest, ignoring gaps and custom codes', async () => {
    for (const employeeCode of ['EMP-0002', 'EMP-0009', 'DEV-99', 'EMP-X']) await HrmsEmployee.create({ taskflowOrganizationId: org, employeeCode, name: 'x', joinedDate: new Date() });
    expect((await hire(await candidate())).employee.employeeCode).toBe('EMP-0010');
    expect((await createEmployee(String(org), { name: 'New' }, HR)).employeeCode).toBe('EMP-0011');
  });

  it('never clash when several people are added at once', async () => {
    const ids = await Promise.all([1, 2, 3].map(() => candidate()));
    const hired = await Promise.all(ids.map((id) => hire(id)));
    expect(new Set(hired.map((h) => h.employee.employeeCode)).size).toBe(3);
  });

  it('still refuse a code that is taken', async () => {
    await createEmployee(String(org), { name: 'A', employeeCode: 'A1' }, HR);
    await expect(createEmployee(String(org), { name: 'B', employeeCode: 'A1' }, HR)).rejects.toMatchObject({ statusCode: 409 });
  });
});
