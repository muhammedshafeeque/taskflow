import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { createLeave, decideLeave } from './hrms.service';
import { getBalances, splitByLeaveYear } from './policy.service';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsLeaveRequest } from './models/hrmsLeaveRequest.model';
import { HrmsLeaveLedger, HrmsLeaveType, HrmsSettings } from './models/hrmsPolicy.model';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
let org: mongoose.Types.ObjectId;
let ws = '';
let casual = '';
let ana = '';
const anaUser = String(new mongoose.Types.ObjectId());
const hr = String(new mongoose.Types.ObjectId());

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
  // Weekends Saturday and Sunday; leave year starts in January.
  await HrmsSettings.create({ taskflowOrganizationId: org, weekendDays: [0, 6], leaveYearStartMonth: 1 });
  casual = String((await HrmsLeaveType.create({ taskflowOrganizationId: org, name: 'Casual', code: 'casual', annualAllowance: 12, accrual: 'yearly', paid: true }))._id);
  ana = String((await HrmsEmployee.create({ taskflowOrganizationId: org, employeeCode: 'ANA', name: 'Ana', joinedDate: new Date('2020-01-01'), userId: anaUser }))._id);
});

const ask = (from: string, to: string, extra: Record<string, unknown> = {}) =>
  createLeave(ws, { employeeId: ana, leaveTypeId: casual, startDate: from, endDate: to, ...extra }, null, anaUser);
const used = async (year: number) => (await HrmsLeaveLedger.findOne({ employeeId: ana, leaveTypeId: casual, year }).lean())?.used ?? 0;

describe('leave rules (AUT-39)', () => {
  it('refuses leave that overlaps pending or approved leave, but allows two half days on one day', async () => {
    const first = (await ask('2026-03-09', '2026-03-11')) as { _id: unknown };
    await expect(ask('2026-03-11', '2026-03-12')).rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/overlaps pending leave/) });
    // Once it is rejected, the dates are free again.
    await decideLeave(String(first._id), ws, 'rejected', hr);
    await expect(ask('2026-03-11', '2026-03-12')).resolves.toBeTruthy();

    await ask('2026-04-01', '2026-04-01', { halfDay: true });
    await expect(ask('2026-04-01', '2026-04-01', { halfDay: true })).resolves.toBeTruthy();
    await expect(ask('2026-04-01', '2026-04-01', { halfDay: true })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('never lets someone approve or reject their own leave', async () => {
    const leave = (await ask('2026-03-09', '2026-03-10')) as { _id: unknown };
    await expect(decideLeave(String(leave._id), ws, 'approved', anaUser)).rejects.toMatchObject({ statusCode: 403 });
    await expect(decideLeave(String(leave._id), ws, 'rejected', anaUser)).rejects.toMatchObject({ statusCode: 403 });
    // Cancelling your own request is fine.
    await expect(decideLeave(String(leave._id), ws, 'cancelled', anaUser)).resolves.toBeTruthy();
  });

  it('refuses invalid status changes: a decided request is not decided again', async () => {
    const a = String(((await ask('2026-03-09', '2026-03-10')) as { _id: unknown })._id);
    await decideLeave(a, ws, 'approved', hr);
    await expect(decideLeave(a, ws, 'rejected', hr)).rejects.toMatchObject({ statusCode: 409 });
    await expect(decideLeave(a, ws, 'approved', hr)).rejects.toMatchObject({ statusCode: 409 });
    expect(await used(2026)).toBe(2); // charged once, not twice

    await decideLeave(a, ws, 'cancelled', hr);
    expect(await used(2026)).toBe(0);
    await expect(decideLeave(a, ws, 'approved', hr)).rejects.toMatchObject({ statusCode: 409 });

    const b = String(((await ask('2026-03-16', '2026-03-16')) as { _id: unknown })._id);
    await decideLeave(b, ws, 'rejected', hr);
    await expect(decideLeave(b, ws, 'approved', hr)).rejects.toMatchObject({ statusCode: 409 });
    await expect(decideLeave(b, ws, 'nonsense' as never, hr)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('two people deciding at once: only one decision counts', async () => {
    const a = String(((await ask('2026-03-09', '2026-03-10')) as { _id: unknown })._id);
    const results = await Promise.allSettled([decideLeave(a, ws, 'approved', hr), decideLeave(a, ws, 'approved', hr), decideLeave(a, ws, 'rejected', hr)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const status = (await HrmsLeaveRequest.findById(a).lean())!.status;
    expect(await used(2026)).toBe(status === 'approved' ? 2 : 0);
  });

  it('splits leave across two leave years, and cancelling gives each year back its own days', async () => {
    // Mon 28 Dec 2026 – Fri 1 Jan 2027: four working days in 2026, one in 2027.
    expect((await splitByLeaveYear(org, new Date('2026-12-28'), new Date('2027-01-01'), 5)).map(({ year, days }) => ({ year, days }))).toEqual([
      { year: 2026, days: 4 },
      { year: 2027, days: 1 },
    ]);
    const leave = (await ask('2026-12-28', '2027-01-01')) as { _id: unknown; days: number };
    expect(leave.days).toBe(5);
    expect((await HrmsLeaveRequest.findById(leave._id).lean())!.yearSplit).toEqual([{ year: 2026, days: 4 }, { year: 2027, days: 1 }]);

    await decideLeave(String(leave._id), ws, 'approved', hr);
    expect(await used(2026)).toBe(4);
    expect(await used(2027)).toBe(1);
    const balance2027 = (await getBalances(ws, ana, new Date('2027-06-01'))).find((b) => b.code === 'casual')!;
    expect(balance2027.used).toBe(1);

    await decideLeave(String(leave._id), ws, 'cancelled', hr);
    expect(await used(2026)).toBe(0);
    expect(await used(2027)).toBe(0);
  });

  it('checks each leave year’s balance on its own', async () => {
    // 2026 is nearly used up: 11 of 12 days taken.
    await HrmsLeaveLedger.create({ taskflowOrganizationId: org, employeeId: ana, leaveTypeId: casual, year: 2026, used: 11 });
    // 4 days fall in 2026 (only 1 left) though 2027 has plenty: refused, naming the year.
    await expect(ask('2026-12-28', '2027-01-01')).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/leave year 2026/) });
    // A request that puts just one day in 2026 fits.
    await expect(ask('2026-12-31', '2027-01-01')).resolves.toBeTruthy();
  });
});
