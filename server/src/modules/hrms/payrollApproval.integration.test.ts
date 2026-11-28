import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { generatePayrollRun, setPayrollRunStatus, setPayslipAdjustments } from './payroll.service';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsPayrollRun, HrmsPayrollSettings } from './models/hrmsPayroll.model';
import { ApprovalPolicy } from '../approvals/approval.models';
import { Role } from '../roles/role.model';
import { User } from '../auth/user.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { migratePayrollApproveIfNeeded, payrollApproveToKeep } from '../../migrations/migrateDataScopes';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const P = TASK_FLOW_PERMISSIONS.TASKFLOW.HR.PAYROLL;
const org = new mongoose.Types.ObjectId();
const ws = String(org);
const hana = String(new mongoose.Types.ObjectId()); // prepares payroll
const farah = String(new mongoose.Types.ObjectId()); // approves payroll
const clerk = String(new mongoose.Types.ObjectId()); // manages payroll, can't approve
const approver = { permissions: [P.APPROVE] };
const manager = { permissions: [P.MANAGE] };
let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
beforeEach(async () => {
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  await HrmsPayrollSettings.create({ taskflowOrganizationId: org, workingDaysPerMonth: 23, components: [{ name: 'Basic', kind: 'earning', calc: 'percent_of_ctc', value: 100 }] });
  await HrmsEmployee.create({ taskflowOrganizationId: org, employeeCode: 'E1', name: 'Ana', joinedDate: new Date('2025-01-01'), annualCtc: 120_000, currency: 'INR' });
});
afterAll(async () => {
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

const idOf = (run: unknown) => String((run as { _id: unknown })._id);

describe('payroll approval is separate from preparation (AUT-43)', () => {
  it('records who prepared the run, and they cannot approve it', async () => {
    const run = await generatePayrollRun(ws, '2026-12', hana);
    expect(String((await HrmsPayrollRun.findById(idOf(run)).lean())!.preparedBy)).toBe(hana);
    await expect(setPayrollRunStatus(ws, idOf(run), 'finalized', hana, { permissions: [P.MANAGE, P.APPROVE] })).rejects.toMatchObject({
      statusCode: 403,
      message: expect.stringMatching(/You prepared this payroll run/),
    });
  });

  it('needs the approve permission to finalize', async () => {
    const run = await generatePayrollRun(ws, '2026-12', hana);
    await expect(setPayrollRunStatus(ws, idOf(run), 'finalized', clerk, manager)).rejects.toMatchObject({ statusCode: 403, message: expect.stringMatching(/approve payroll permission/) });
    const done = await setPayrollRunStatus(ws, idOf(run), 'finalized', farah, approver);
    expect(done).toMatchObject({ status: 'finalized' });
    expect(String(done!.finalizedBy)).toBe(farah);
    // Paying out an approved run is a payroll manager's job.
    expect(await setPayrollRunStatus(ws, idOf(run), 'paid', hana, manager)).toMatchObject({ status: 'paid' });
  });

  it('whoever changes the draft last counts as its preparer', async () => {
    const run = await generatePayrollRun(ws, '2026-12', hana);
    const emp = (await HrmsEmployee.findOne({ name: 'Ana' }).lean())!;
    // Farah adjusts a payslip, so she has now prepared it and can no longer approve it.
    await setPayslipAdjustments(ws, idOf(run), String(emp._id), [{ name: 'Bonus', amount: 500, kind: 'earning' }], farah);
    await expect(setPayrollRunStatus(ws, idOf(run), 'finalized', farah, approver)).rejects.toMatchObject({ statusCode: 403 });
    await expect(setPayrollRunStatus(ws, idOf(run), 'finalized', hana, approver)).resolves.toMatchObject({ status: 'finalized' });
  });

  it('with a payroll approval chain on, the chain does the approving', async () => {
    // The chain's approver must be an active member of the workspace.
    await User.create({ _id: farah, email: 'farah@example.com', name: 'Farah', password: 'Passw0rd!x', mustChangePassword: false });
    await OrganizationMember.create({ organization: org, user: farah, role: 'org_member', status: 'active' });
    await ApprovalPolicy.create({ taskflowOrganizationId: org, recordType: 'payroll', enabled: true, steps: [{ name: 'Finance', kind: 'users', userIds: [farah] }] });
    const run = await generatePayrollRun(ws, '2026-12', hana);
    // The first try sends it to the chain instead of finalizing.
    await expect(setPayrollRunStatus(ws, idOf(run), 'finalized', hana, manager)).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/Sent for approval/) });
    expect((await HrmsPayrollRun.findById(idOf(run)).lean())!.status).toBe('draft');
  });

  it('existing payroll roles get the approve permission once', async () => {
    expect(payrollApproveToKeep([P.MANAGE])).toEqual([P.APPROVE]);
    expect(payrollApproveToKeep([P.READ])).toEqual([]);
    expect(payrollApproveToKeep([P.MANAGE, P.APPROVE])).toEqual([]);
    const payrollRole = await Role.create({ name: 'Payroll', permissions: [P.MANAGE] });
    const reader = await Role.create({ name: 'Reader', permissions: [P.READ] });
    expect((await migratePayrollApproveIfNeeded()).roles).toBe(1);
    expect((await Role.findById(payrollRole._id).lean())!.permissions).toContain(P.APPROVE);
    expect((await Role.findById(reader._id).lean())!.permissions).not.toContain(P.APPROVE);
    expect(await migratePayrollApproveIfNeeded()).toEqual({ roles: 0, users: 0 });
  });
});
