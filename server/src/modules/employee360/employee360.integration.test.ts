/**
 * Employee 360 against an in-memory Mongo: every section for an HR viewer,
 * self-view without HR permissions, payroll privacy, flags, and project scoping.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Organization } from '../organizations/organization.model';
import { User } from '../auth/user.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { Issue } from '../issues/issue.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { HrmsLeaveRequest } from '../hrms/models/hrmsLeaveRequest.model';
import { HrmsAttendance } from '../hrms/models/hrmsAttendance.model';
import { HrmsPayrollRun } from '../hrms/models/hrmsPayroll.model';
import { ResourceAllocation } from '../resources/models/resourceAllocation.model';
import { ResourceProfile } from '../resources/models/resourceProfile.model';
import { WorkLog } from '../workLogs/workLog.model';
import { GraphAccess } from '../links/links.service';
import { getEmployee360, weekStart } from './employee360.service';

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const ids: Record<string, string> = {};
const DAY = 86_400_000;
const HR = [
  'taskflow.hr.employee.read',
  'taskflow.hr.leave.read',
  'taskflow.hr.attendance.read',
  'taskflow.hr.payroll.read',
  'taskflow.resources.allocation.read',
  'taskflow.timesheet.approve',
  'project.project.create',
];

const as = (user: string, perms: string[] = []) =>
  new GraphAccess(new mongoose.Types.ObjectId(ids.org), { userId: ids[user], permissions: perms });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongo.getUri());
  const [ana, hr, ben] = await User.create([
    { email: 'ana@example.com', name: 'Ana', mustChangePassword: false },
    { email: 'hr@example.com', name: 'Hana', mustChangePassword: false },
    { email: 'ben@example.com', name: 'Ben', mustChangePassword: false },
  ]);
  const org = await Organization.create({ name: 'Studio', slug: 'studio', createdBy: hr._id });
  const [app, secret] = await Project.create([
    { name: 'App', key: 'APP', lead: hr._id, taskflowOrganizationId: org._id },
    { name: 'Secret', key: 'SEC', lead: hr._id, taskflowOrganizationId: org._id },
  ]);
  await ProjectMember.create([
    { project: app._id, user: ana._id },
    { project: secret._id, user: ana._id },
    { project: app._id, user: ben._id },
  ]);
  const now = Date.now();
  const [late] = await Issue.create([
    { title: 'Late task', key: 'APP-1', project: app._id, reporter: hr._id, assignee: ana._id, dueDate: new Date(now - DAY) },
    { title: 'Soon task', key: 'APP-2', project: app._id, reporter: hr._id, assignee: ana._id, dueDate: new Date(now + 2 * DAY) },
    { title: 'Done task', key: 'APP-3', project: app._id, reporter: hr._id, assignee: ana._id, status: 'Done' },
    { title: 'Secret task', key: 'SEC-1', project: secret._id, reporter: hr._id, assignee: ana._id },
  ]);

  const lead = await HrmsEmployee.create({ taskflowOrganizationId: org._id, employeeCode: 'E0', name: 'Hana', userId: hr._id, joinedDate: new Date(now - 900 * DAY) });
  const emp = await HrmsEmployee.create({
    taskflowOrganizationId: org._id,
    employeeCode: 'E1',
    name: 'Ana',
    userId: ana._id,
    managerId: lead._id,
    designation: 'Engineer',
    joinedDate: new Date(now - 400 * DAY),
    leaveBalanceDays: 12,
  });
  await ResourceProfile.create({ taskflowOrganizationId: org._id, userId: ana._id, skills: ['react', 'node'], capacityHoursPerWeek: 40 });
  await ResourceAllocation.create([
    { taskflowOrganizationId: org._id, userId: ana._id, projectId: app._id, percent: 80, startDate: new Date(now - 30 * DAY) },
    { taskflowOrganizationId: org._id, userId: ana._id, projectId: secret._id, percent: 40, startDate: new Date(now - 10 * DAY) },
    { taskflowOrganizationId: org._id, userId: ana._id, projectId: app._id, percent: 50, startDate: new Date(now - 90 * DAY), endDate: new Date(now - 40 * DAY) },
  ]);
  await HrmsLeaveRequest.create([
    { taskflowOrganizationId: org._id, employeeId: emp._id, status: 'approved', startDate: new Date(now + 3 * DAY), endDate: new Date(now + 5 * DAY), days: 3 },
    { taskflowOrganizationId: org._id, employeeId: emp._id, status: 'pending', startDate: new Date(now + 20 * DAY), endDate: new Date(now + 20 * DAY), days: 1 },
  ]);
  await HrmsAttendance.create([
    { taskflowOrganizationId: org._id, employeeId: emp._id, date: new Date(now - DAY), status: 'present', hoursWorked: 8 },
    { taskflowOrganizationId: org._id, employeeId: emp._id, date: new Date(now - 2 * DAY), status: 'absent', hoursWorked: 0 },
  ]);
  const slip = (period: string) => ({ employeeId: emp._id, name: 'Ana', currency: 'USD', monthlyCtc: 5000, gross: 5000, totalDeductions: 500, net: 4500 });
  await HrmsPayrollRun.create([
    { taskflowOrganizationId: org._id, period: '2026-09', status: 'paid', payslips: [slip('2026-09')] },
    { taskflowOrganizationId: org._id, period: '2026-10', status: 'draft', payslips: [slip('2026-10')] },
  ]);
  // 10h last week, not submitted.
  const lastWeek = new Date(weekStart(now).getTime() - 7 * DAY + 2 * 3_600_000);
  await WorkLog.create({ issue: late._id, author: ana._id, minutesSpent: 600, date: lastWeek });

  Object.assign(ids, { org: String(org._id), ana: String(ana._id), hr: String(hr._id), ben: String(ben._id), emp: String(emp._id) });
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('employee 360', () => {
  it('shows every section and flags to an HR viewer', async () => {
    const e = await getEmployee360(as('hr', HR), ids.emp);
    expect(e.isSelf).toBe(false);
    expect(e.employee).toMatchObject({ name: 'Ana', designation: 'Engineer', manager: { name: 'Hana' } });
    expect(e.profile.skills).toEqual(['react', 'node']);

    expect(e.work.summary).toEqual({ open: 3, overdue: 1, dueSoon: 1, doneLast30: 1 });
    expect(e.allocations?.currentPercent).toBe(120);
    expect(e.allocations?.items).toHaveLength(2);
    expect(e.timesheet?.lastWeek).toEqual({ loggedHours: 10, submitted: false });
    expect(e.timesheet?.projects).toEqual([expect.objectContaining({ name: 'App', hours: 10 })]);
    expect(e.leave).toMatchObject({ balanceDays: 12, pending: [expect.objectContaining({ days: 1 })] });
    expect(e.leave?.upcoming).toHaveLength(1);
    expect(e.attendance?.counts).toMatchObject({ present: 1, absent: 1 });
    // Payroll readers see drafts and CTC.
    expect(e.payroll?.payslips.map((p) => p.period)).toEqual(['2026-10', '2026-09']);
    expect(e.payroll?.payslips[0]).toHaveProperty('monthlyCtc', 5000);

    expect(e.flags.map((f) => `${f.level}:${f.area}`)).toEqual(
      expect.arrayContaining(['red:allocations', 'amber:work', 'amber:timesheet', 'amber:leave'])
    );
  });

  it('lets people see themselves without HR permissions, minus payslips', async () => {
    const e = await getEmployee360(as('ana'), 'me');
    expect(e.isSelf).toBe(true);
    expect(e.leave?.balanceDays).toBe(12);
    expect(e.allocations?.currentPercent).toBe(120);
    expect(e.payroll).toBeNull();

    const withSlips = await getEmployee360(as('ana', ['taskflow.self.payslip.read']), 'me');
    // Only finalized/paid slips, and no CTC.
    expect(withSlips.payroll?.payslips.map((p) => p.period)).toEqual(['2026-09']);
    expect(withSlips.payroll?.payslips[0]).not.toHaveProperty('monthlyCtc');
  });

  it('keeps other people out and scopes work to the viewer’s projects', async () => {
    await expect(getEmployee360(as('ben'), ids.emp)).rejects.toMatchObject({ statusCode: 404 });

    const e = await getEmployee360(as('ben', ['taskflow.hr.employee.read']), ids.emp);
    expect(e.leave).toBeNull();
    expect(e.payroll).toBeNull();
    expect(e.allocations).toBeNull();
    // Ben is on APP only: SEC-1 is not counted.
    expect(e.work.summary.open).toBe(2);
    expect(e.work.hiddenProjects).toBe(1);
    await expect(getEmployee360(as('ben'), 'me')).rejects.toMatchObject({ statusCode: 404 });
  });
});
