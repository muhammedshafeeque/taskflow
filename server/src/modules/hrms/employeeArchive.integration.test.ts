import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { deleteEmployee, listEmployees, restoreEmployee, updateEmployee } from './hrms.service';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsAttendance } from './models/hrmsAttendance.model';
import { HrmsLeaveRequest } from './models/hrmsLeaveRequest.model';
import { HrmsPayrollRun } from './models/hrmsPayroll.model';
import { CrmContact } from '../crm/models/crmContact.model';
import type { Reach } from './dataScope';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const HR = ['taskflow.hr.employee.list', 'taskflow.hr.employee.update', 'taskflow.hr.scope.all'];
const actor = { id: String(new mongoose.Types.ObjectId()), permissions: HR };
let mongo: MongoMemoryServer;
let org: mongoose.Types.ObjectId;
let ws = '';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  org = new mongoose.Types.ObjectId();
  ws = String(org);
});

const employee = async (name: string, extra: Record<string, unknown> = {}) =>
  String((await HrmsEmployee.create({ taskflowOrganizationId: org, employeeCode: name.toUpperCase(), name, joinedDate: new Date('2024-01-01'), ...extra }))._id);
const names = async (query: Record<string, string> = {}) => (await listEmployees(ws, query, HR)).map((e) => e.name).sort();

describe('deleting an employee (AUT-38)', () => {
  it('really deletes a record with no history, e.g. added by mistake', async () => {
    const id = await employee('Typo');
    await CrmContact.create({ taskflowOrganizationId: org, name: 'Typo', email: 'typo@x.test', employeeId: id });
    expect(await deleteEmployee(id, ws, null, actor.id)).toEqual({ deleted: true, archived: false });
    expect(await HrmsEmployee.exists({ _id: id })).toBeNull();
    expect((await CrmContact.findOne({ email: 'typo@x.test' }).lean())!.employeeId).toBeUndefined();
  });

  it('keeps people with history: still working → asks to record the exit first', async () => {
    const id = await employee('Ana');
    await HrmsAttendance.create({ taskflowOrganizationId: org, employeeId: id, date: new Date('2026-11-02'), status: 'present' });
    await expect(deleteEmployee(id, ws, null, actor.id)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/attendance.*Record their exit/) });
    expect((await HrmsEmployee.findById(id).lean())!.archivedAt).toBeNull();
  });

  it('archives people who left: history stays linked, they are hidden by default, and can be restored', async () => {
    const id = await employee('Ben', { status: 'terminated', exitDate: new Date('2026-10-31') });
    await employee('Cy');
    await HrmsLeaveRequest.create({ taskflowOrganizationId: org, employeeId: id, startDate: new Date('2026-05-01'), endDate: new Date('2026-05-02'), days: 2, status: 'approved' });
    await HrmsPayrollRun.create({ taskflowOrganizationId: org, period: '2026-09', status: 'paid', payslips: [{ employeeId: id, name: 'Ben' }] });

    const out = await deleteEmployee(id, ws, null, actor.id);
    expect(out).toMatchObject({ deleted: false, archived: true, history: expect.arrayContaining(['leave', 'payroll']) });
    expect(await HrmsEmployee.exists({ _id: id })).toBeTruthy();
    expect(await HrmsLeaveRequest.exists({ employeeId: id })).toBeTruthy();

    expect(await names()).toEqual(['Cy']);
    expect(await names({ archived: 'only' })).toEqual(['Ben']);
    expect(await names({ archived: 'all' })).toEqual(['Ben', 'Cy']);

    // Archived records can't be changed, or archived twice, until restored.
    await expect(updateEmployee(id, ws, { location: 'Goa' }, actor)).rejects.toMatchObject({ statusCode: 409 });
    await expect(deleteEmployee(id, ws, null, actor.id)).rejects.toMatchObject({ statusCode: 409 });

    expect(await restoreEmployee(id, ws, null, actor.id)).toEqual({ restored: true });
    expect(await names()).toEqual(['Ben', 'Cy']);
    expect((await HrmsEmployee.findById(id).lean())!.status).toBe('terminated'); // still left until rehired
    await expect(restoreEmployee(id, ws, null, actor.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('counts people who report to them as history', async () => {
    const boss = await employee('Boss', { status: 'terminated' });
    await employee('Report', { managerId: boss });
    expect(await deleteEmployee(boss, ws, null, actor.id)).toMatchObject({ archived: true, history: ['people who report to them'] });
  });

  it('only reaches people within the HR scope', async () => {
    const id = await employee('Far');
    const reach: Reach = { level: 'team', employeeIds: new Set(), userIds: new Set(), departments: [] };
    await expect(deleteEmployee(id, ws, reach, actor.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(restoreEmployee(id, ws, reach, actor.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});
