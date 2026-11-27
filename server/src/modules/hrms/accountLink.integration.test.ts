import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { User } from '../auth/user.model';
import { Role } from '../roles/role.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { flushAuditLogs } from '../auditLogs/logAudit';
import * as domainNotify from '../notifications/domainNotify';
import { invite } from '../users/users.service';
import { hireCandidate } from './people.service';
import { cancelAccountRequest, listAccountRequests } from './accountLink';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsCandidate, HrmsJobOpening } from './models/hrmsPeople.model';
import type { GrantActor } from '../auth/grantGuard';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

jest.mock('../../services/email.service', () => new Proxy({}, { get: (_t, name) => (name === '__esModule' ? true : name === 'tfEmailWrap' ? (s: string) => s : jest.fn().mockResolvedValue(undefined)) }));
jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const T = TASK_FLOW_PERMISSIONS;
const H = T.TASKFLOW.HR;
const STAFF = [...Object.values(T.TASKFLOW.SELF).flatMap((v) => Object.values(v as Record<string, string>))];

let mongo: MongoMemoryServer;
let orgId = '';
let otherOrgId = '';
let staffRoleId = '';
let leadRoleId = '';
let jobId: mongoose.Types.ObjectId;
const ids: Record<string, string> = {};

/** People admin: adds users, changes roles, edits HR. Recruiter: hires only. */
const peopleAdmin = (): GrantActor => ({
  id: ids.admin,
  permissions: [T.AUTH.USER.CREATE, T.AUTH.USER.UPDATE, T.AUTH.USER.CHANGE_ROLE, H.EMPLOYEE.CREATE, H.EMPLOYEE.UPDATE, H.EMPLOYEE.LIST, H.SCOPE.ALL, H.RECRUITMENT.MANAGE, ...STAFF],
});
const userAdminOnly = (): GrantActor => ({ id: ids.admin, permissions: [T.AUTH.USER.CREATE, ...STAFF] });
const recruiter = (): GrantActor => ({ id: ids.recruiter, permissions: [H.RECRUITMENT.MANAGE, H.SCOPE.ALL] });

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
  await HrmsEmployee.syncIndexes();
  jest.restoreAllMocks();
  const [staff, lead] = await Role.create([
    { name: 'Staff', permissions: STAFF },
    { name: 'Team lead', permissions: STAFF },
  ]);
  staffRoleId = String(staff._id);
  leadRoleId = String(lead._id);
  const [org, other] = await Organization.create([
    { name: 'Co', slug: 'co', createdBy: new mongoose.Types.ObjectId() },
    { name: 'Other', slug: 'other', createdBy: new mongoose.Types.ObjectId() },
  ]);
  orgId = String(org._id);
  otherOrgId = String(other._id);
  ids.admin = String(new mongoose.Types.ObjectId());
  const adminRole = await Role.create({ name: 'People admin', permissions: peopleAdmin().permissions });
  for (const name of ['admin', 'recruiter']) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, roleId: name === 'admin' ? adminRole._id : staff._id });
    await OrganizationMember.create({ organization: org._id, user: u._id, role: 'org_member', status: 'active' });
    ids[name] = String(u._id);
  }
  jobId = (await HrmsJobOpening.create({ taskflowOrganizationId: org._id, title: 'Developer', department: 'Dev', stages: ['Applied', 'Hired'], currency: 'INR' , openings: 50 }))._id as mongoose.Types.ObjectId;
});

const employee = (extra: Record<string, unknown> = {}) =>
  HrmsEmployee.create({ taskflowOrganizationId: orgId, employeeCode: `E-${Math.random().toString(36).slice(2, 7)}`, name: 'Jo', email: 'jo@example.com', joinedDate: new Date(), ...extra });
const candidate = async (email = 'jo@example.com') =>
  String((await HrmsCandidate.create({ taskflowOrganizationId: orgId, jobId, name: 'Jo', email, stage: 'Applied' }))._id);
const linkedUserOf = async (employeeId: unknown) => {
  const e = await HrmsEmployee.findById(employeeId).lean();
  return e?.userId ? String(e.userId) : null;
};

describe('adding a user connects the employee record (AUT-35)', () => {
  it('links the one employee with the same email, when the inviter may edit employees', async () => {
    const emp = await employee();
    const out = await invite({ name: 'Jo', email: 'Jo@Example.com', roleId: staffRoleId }, orgId, peopleAdmin());
    expect(out.employee).toMatchObject({ status: 'linked', employeeId: String(emp._id) });
    expect(await linkedUserOf(emp._id)).toBe(String((out.user as { _id: unknown })._id));
  });

  it('only reports the match when the inviter may not edit employees', async () => {
    const emp = await employee();
    const out = await invite({ name: 'Jo', email: 'jo@example.com', roleId: staffRoleId }, orgId, userAdminOnly());
    expect(out.employee).toMatchObject({ status: 'match_found', employeeId: String(emp._id) });
    expect(await linkedUserOf(emp._id)).toBeNull();
  });

  it('can create the employee record with the account', async () => {
    const out = await invite(
      { name: 'Sam', email: 'sam@example.com', roleId: staffRoleId, employee: { mode: 'create', department: 'QA', designation: 'Tester' } },
      orgId,
      peopleAdmin()
    );
    expect(out.employee.status).toBe('created');
    const e = (await HrmsEmployee.findById(out.employee.employeeId).lean())!;
    expect(e).toMatchObject({ name: 'Sam', email: 'sam@example.com', department: 'QA', designation: 'Tester' });
    expect(String(e.userId)).toBe(String((out.user as { _id: unknown })._id));
    // Without HR create rights the account is still made, and the problem is reported.
    const denied = await invite({ name: 'Al', email: 'al@example.com', roleId: staffRoleId, employee: { mode: 'create' } }, orgId, userAdminOnly());
    expect(denied.employee).toMatchObject({ status: 'failed' });
    expect(await User.exists({ email: 'al@example.com' })).toBeTruthy();
  });

  it('links a chosen employee, but never one already linked to someone else', async () => {
    const someone = await User.create({ email: 'x@example.com', name: 'X', password: 'Passw0rd!x', mustChangePassword: false });
    const taken = await employee({ email: 'other@example.com', userId: someone._id });
    const out = await invite({ name: 'Jo', email: 'jo2@example.com', roleId: staffRoleId, employee: { mode: 'link', employeeId: String(taken._id) } }, orgId, peopleAdmin());
    expect(out.employee).toMatchObject({ status: 'failed', message: expect.stringMatching(/already linked/) });
    expect(await linkedUserOf(taken._id)).toBe(String(someone._id));
  });
});

describe('inviting someone who already has an account (AUT-35)', () => {
  async function personElsewhere() {
    const u = await User.create({ email: 'pat@example.com', name: 'Pat', password: 'Passw0rd!x', mustChangePassword: false, roleId: staffRoleId });
    await OrganizationMember.create({ organization: otherOrgId, user: u._id, role: 'org_member', status: 'active' });
    return String(u._id);
  }

  it('says clearly that the chosen role was not applied, and leaves it unchanged', async () => {
    const pat = await personElsewhere();
    const out = await invite({ name: 'Pat', email: 'pat@example.com', roleId: leadRoleId }, orgId, peopleAdmin());
    expect(out.inviteKind).toBe('workspace_join');
    expect(out.role).toMatchObject({ applied: false, requested: 'Team lead', current: 'Staff' });
    expect(out.role.message).toMatch(/was not changed to Team lead/);
    expect(String((await User.findById(pat).lean())!.roleId)).toBe(staffRoleId);
  });

  it('applies the role when asked to, by someone who may change roles', async () => {
    const pat = await personElsewhere();
    await expect(invite({ name: 'Pat', email: 'pat@example.com', roleId: leadRoleId, applyRole: true }, orgId, userAdminOnly())).rejects.toMatchObject({ statusCode: 403 });
    const out = await invite({ name: 'Pat', email: 'pat@example.com', roleId: leadRoleId, applyRole: true }, orgId, peopleAdmin());
    expect(out.role).toMatchObject({ applied: true, current: 'Team lead' });
    expect(String((await User.findById(pat).lean())!.roleId)).toBe(leadRoleId);
  });

  it('reports the same role as applied', async () => {
    await personElsewhere();
    const out = await invite({ name: 'Pat', email: 'pat@example.com', roleId: staffRoleId }, orgId, peopleAdmin());
    expect(out.role).toMatchObject({ applied: true });
  });
});

describe('hiring sets up the account (AUT-35)', () => {
  it('creates the account with the suggested role and links the new employee', async () => {
    const res = await hireCandidate(orgId, await candidate(), { account: { action: 'create', roleId: staffRoleId } }, ids.admin, peopleAdmin().permissions);
    expect(res.account).toMatchObject({ status: 'created' });
    const user = (await User.findOne({ email: 'jo@example.com' }).lean())!;
    expect(String(user.roleId)).toBe(staffRoleId);
    expect(await OrganizationMember.exists({ organization: orgId, user: user._id, status: 'active' })).toBeTruthy();
    expect(String(res.employee.userId)).toBe(String(user._id));
  });

  it('refuses to create accounts for someone who cannot add users, before hiring', async () => {
    const id = await candidate();
    await expect(hireCandidate(orgId, id, { account: { action: 'create', roleId: staffRoleId } }, ids.recruiter, recruiter().permissions)).rejects.toMatchObject({ statusCode: 403 });
    expect((await HrmsCandidate.findById(id).lean())!.status).toBe('active');
    expect(await HrmsEmployee.countDocuments()).toBe(0);
    await expect(hireCandidate(orgId, id, { account: { action: 'create' } }, ids.admin, peopleAdmin().permissions)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('asks for the account; adding the user later links it and closes the request', async () => {
    const notify = jest.spyOn(domainNotify, 'notifyUsers');
    const res = await hireCandidate(orgId, await candidate(), { account: { action: 'request', roleId: leadRoleId } }, ids.recruiter, recruiter().permissions);
    expect(res.account).toMatchObject({ status: 'requested' });
    expect(notify).toHaveBeenCalledWith(expect.arrayContaining([ids.admin]), 'hr_account_requested', expect.objectContaining({ title: expect.stringContaining('Jo') }), ids.recruiter);

    const requests = await listAccountRequests(orgId);
    expect(requests).toEqual([expect.objectContaining({ name: 'Jo', email: 'jo@example.com', roleId: leadRoleId, roleName: 'Team lead', requestedBy: 'recruiter' })]);

    const out = await invite({ name: 'Jo', email: 'jo@example.com', roleId: leadRoleId }, orgId, peopleAdmin());
    expect(out.employee.status).toBe('linked');
    expect(await listAccountRequests(orgId)).toHaveLength(0);
    expect((await HrmsEmployee.findById(res.employee._id).lean())!.accountRequest).toMatchObject({ status: 'done' });
  });

  it('links an account that already exists in this workspace instead of asking', async () => {
    const u = await User.create({ email: 'jo@example.com', name: 'Jo', password: 'Passw0rd!x', mustChangePassword: false, roleId: staffRoleId });
    await OrganizationMember.create({ organization: orgId, user: u._id, role: 'org_member', status: 'active' });
    const res = await hireCandidate(orgId, await candidate(), { account: { action: 'request' } }, ids.recruiter, recruiter().permissions);
    expect(res.account).toMatchObject({ status: 'linked', userId: String(u._id) });
    expect(String(res.employee.userId)).toBe(String(u._id));
  });

  it('hires without an account by default, and requests can be dismissed', async () => {
    const plain = await hireCandidate(orgId, await candidate('a@example.com'), {}, ids.recruiter, recruiter().permissions);
    expect(plain.account).toMatchObject({ status: 'none' });
    const asked = await hireCandidate(orgId, await candidate('b@example.com'), { account: { action: 'request' } }, ids.recruiter, recruiter().permissions);
    await cancelAccountRequest(orgId, String(asked.employee._id), ids.admin);
    expect(await listAccountRequests(orgId)).toHaveLength(0);
    await expect(cancelAccountRequest(orgId, String(asked.employee._id), ids.admin)).rejects.toMatchObject({ statusCode: 404 });
  });
});
