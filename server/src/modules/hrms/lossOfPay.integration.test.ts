import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { generatePayrollRun } from './payroll.service';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsAttendance } from './models/hrmsAttendance.model';
import { HrmsLeaveRequest } from './models/hrmsLeaveRequest.model';
import { HrmsLeaveType } from './models/hrmsPolicy.model';

jest.setTimeout(120_000);
const org = new mongoose.Types.ObjectId();
let mongo: MongoMemoryServer;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

it('a payroll run deducts an absent day of unpaid leave once (AUT-17)', async () => {
  const e = await HrmsEmployee.create({ taskflowOrganizationId: org, employeeCode: 'S', name: 'Sam', joinedDate: new Date('2025-01-01'), annualCtc: 264_000 });
  const unpaid = await HrmsLeaveType.create({ taskflowOrganizationId: org, name: 'Unpaid', code: 'unpaid', paid: false });
  await HrmsLeaveRequest.create({ taskflowOrganizationId: org, employeeId: e._id, leaveTypeId: unpaid._id, type: 'unpaid', status: 'approved', startDate: new Date('2026-12-02'), endDate: new Date('2026-12-02'), days: 1 });
  // Marked absent by HR, saved at local midnight in India.
  await HrmsAttendance.create({ taskflowOrganizationId: org, employeeId: e._id, date: new Date('2026-12-01T18:30:00Z'), status: 'absent' });
  const run = await generatePayrollRun(String(org), '2026-12');
  const slip = run!.payslips[0];
  expect(slip.lopDays).toBe(1);
  expect(slip.gross).toBe(21_000); // 22,000 a month, one of 22 working days lost
});
