import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../auth/user.model';
import { Role } from '../roles/role.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { createToken } from '../apiTokens/apiToken.service';
import { errorHandler } from '../../middleware/errorHandler';
import { CrmDeal } from '../crm/models/crmDeal.model';
import { CommissionEntry, commissionRoutes } from '../crm/commissions/commissions';
import { generatePayrollRun, setPayrollRunStatus } from './payroll.service';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsPayrollRun, HrmsPayrollSettings } from './models/hrmsPayroll.model';

jest.setTimeout(120_000);
const oid = () => new mongoose.Types.ObjectId();
let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let org: mongoose.Types.ObjectId;
let sara: mongoose.Types.ObjectId;
let token = '';
const ws = () => String(org);
const by = String(oid());

async function entry(amount: number, extra: Record<string, unknown> = {}) {
  const deal = await CrmDeal.create({ taskflowOrganizationId: org, title: `Deal ${amount}`, pipelineId: oid(), stageId: oid(), ownerId: sara, status: 'won' });
  return CommissionEntry.create({ taskflowOrganizationId: org, userId: sara, dealId: deal._id, base: amount * 20, amount, currency: 'INR', status: 'approved', ...extra });
}
const slip = async (period: string) => (await HrmsPayrollRun.findOne({ period }).lean())!.payslips[0];
const status = async (id: unknown) => (await CommissionEntry.findById(id).lean())!.status;
const patch = (id: unknown, body: unknown) =>
  fetch(`${base}/entries/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }).then((r) => r.status);
const pay = async (period: string) => {
  const run = await generatePayrollRun(ws(), period);
  await setPayrollRunStatus(ws(), String(run!._id), 'finalized', by);
  await setPayrollRunStatus(ws(), String(run!._id), 'paid', by);
  return run!;
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  const app = express();
  app.use(express.json());
  app.use('/', commissionRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  org = (await Organization.create({ name: 'Co', slug: 'co', createdBy: oid() }))._id as mongoose.Types.ObjectId;
  const role = await Role.create({ name: 'Fin', permissions: ['taskflow.crm.commission.manage'] });
  const farah = await User.create({ email: 'f@example.com', name: 'Farah', password: 'Passw0rd!x', mustChangePassword: false, roleId: role._id });
  await OrganizationMember.create({ organization: org, user: farah._id, role: 'org_member', status: 'active' });
  token = (await createToken(String(farah._id), ws(), { name: 't' })).token;
  sara = (await User.create({ email: 's@example.com', name: 'Sara', password: 'Passw0rd!x', mustChangePassword: false }))._id as mongoose.Types.ObjectId;
  await HrmsPayrollSettings.create({ taskflowOrganizationId: org, workingDaysPerMonth: 22, components: [{ name: 'Basic', kind: 'earning', calc: 'percent_of_ctc', value: 100 }] });
  await HrmsEmployee.create({ taskflowOrganizationId: org, userId: sara, employeeCode: 'S', name: 'Sara', joinedDate: new Date('2025-01-01'), annualCtc: 264_000, currency: 'INR' });
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('commission in payroll (AUT-19)', () => {
  it('adds approved commission as an earning, and marks it paid when the run is paid', async () => {
    const a = await entry(2500);
    const pending = await entry(100, { status: 'pending' });
    await entry(300, { status: 'void' });
    const run = await pay('2026-12');
    const s = run.payslips[0];
    expect(s.earnings).toEqual(expect.arrayContaining([{ name: 'Commission: Deal 2500', amount: 2500 }]));
    expect(s.gross).toBe(24_500);
    expect(await status(a._id)).toBe('paid');
    expect((await CommissionEntry.findById(a._id).lean())!.paidAt).toBeTruthy();
    expect(await status(pending._id)).toBe('pending');
  });

  it('never pays one entry twice: not next month, not in two drafts', async () => {
    const a = await entry(2500);
    await generatePayrollRun(ws(), '2026-11');
    await generatePayrollRun(ws(), '2026-12');
    expect((await slip('2026-11')).gross).toBe(24_500);
    expect((await slip('2026-12')).gross).toBe(22_000);
    await generatePayrollRun(ws(), '2026-11'); // recalculating keeps it
    expect((await slip('2026-11')).gross).toBe(24_500);
    await pay('2026-11');
    await pay('2027-01');
    expect((await slip('2027-01')).gross).toBe(22_000);
    expect(await status(a._id)).toBe('paid');
  });

  it('follows changes while the run is a draft, and refuses to finalize a stale draft', async () => {
    const a = await entry(2500);
    const run = await generatePayrollRun(ws(), '2026-12');
    expect(await patch(a._id, { amount: 3000 })).toBe(200);
    await expect(setPayrollRunStatus(ws(), String(run!._id), 'finalized', by)).rejects.toMatchObject({ statusCode: 409 });
    await generatePayrollRun(ws(), '2026-12');
    expect((await slip('2026-12')).gross).toBe(25_000);
    expect(await patch(a._id, { status: 'void' })).toBe(200);
    await generatePayrollRun(ws(), '2026-12');
    expect((await slip('2026-12')).gross).toBe(22_000);
    await setPayrollRunStatus(ws(), String(run!._id), 'finalized', by);
  });

  it('locks an entry once its run is finalized', async () => {
    const a = await entry(2500);
    const run = await generatePayrollRun(ws(), '2026-12');
    await setPayrollRunStatus(ws(), String(run!._id), 'finalized', by);
    expect(await patch(a._id, { status: 'void' })).toBe(409);
    expect(await patch(a._id, { amount: 1 })).toBe(409);
    expect(await status(a._id)).toBe('approved');
  });

  it('leaves commission in another currency out, for later', async () => {
    const usd = await entry(100, { currency: 'USD' });
    const run = await pay('2026-12');
    expect(run.payslips[0].gross).toBe(22_000);
    expect(run.payslips[0].commissions).toEqual([expect.objectContaining({ amount: 100, currency: 'USD', paid: false })]);
    expect(await CommissionEntry.findById(usd._id).lean()).toMatchObject({ status: 'approved', payrollRunId: null });
  });
});
