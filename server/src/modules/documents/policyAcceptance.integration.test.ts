import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { documentsRoutes } from './documents.routes';
import { meRoutes } from '../me/me.routes';
import { errorHandler } from '../../middleware/errorHandler';
import { Role } from '../roles/role.model';
import { User } from '../auth/user.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { createToken } from '../apiTokens/apiToken.service';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { ResourceTeam } from '../resources/models/resourceTeam.model';
import { DocumentRecord } from './models/documentRecord.model';
import { PolicyAcceptance, PolicyAssignment, remindPendingPolicies } from './policyAcceptance';
import { ReminderLog } from '../reminders/reminderLog.model';
import * as domainNotify from '../notifications/domainNotify';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

jest.mock('../../services/email.service', () => new Proxy({}, { get: (_t, name) => (name === '__esModule' ? true : name === 'tfEmailWrap' ? (s: string) => s : jest.fn().mockResolvedValue(undefined)) }));
jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const T = TASK_FLOW_PERMISSIONS.TASKFLOW;
const SELF = Object.values(T.SELF).flatMap((g) => Object.values(g as Record<string, string>));
const DAY = 86_400_000;

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let orgId = '';
let orgOid: mongoose.Types.ObjectId;
let policyId = '';
let teamId = '';
const ids: Record<string, string> = {};
const emp: Record<string, string> = {};
const tokens: Record<string, string> = {};
let notify: jest.SpyInstance;

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[who]}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; data?: any } };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongo.getUri());
  const app = express();
  app.use(express.json());
  app.use('/api/documents', documentsRoutes);
  app.use('/api/me', meRoutes);
  app.use(errorHandler);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await flushAuditLogs();
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongo?.stop();
});

/** hana: HR (policy manage). ana and ben: staff; ana is in the "Delivery" team. cy: an employee with no account. */
beforeEach(async () => {
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  await Promise.all([PolicyAcceptance.syncIndexes(), PolicyAssignment.syncIndexes(), ReminderLog.syncIndexes()]);
  jest.restoreAllMocks();
  notify = jest.spyOn(domainNotify, 'notifyUsers');
  const [staff, hr] = await Role.create([
    { name: 'Staff', permissions: SELF },
    { name: 'HR', permissions: [...SELF, T.DOCUMENTS.POLICY.LIST, T.DOCUMENTS.POLICY.MANAGE] },
  ]);
  const org = await Organization.create({ name: 'Co', slug: 'co', createdBy: new mongoose.Types.ObjectId() });
  orgId = String(org._id);
  orgOid = org._id as mongoose.Types.ObjectId;
  for (const [name, role] of Object.entries({ hana: hr, ana: staff, ben: staff })) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, roleId: role._id });
    await OrganizationMember.create({ organization: org._id, user: u._id, role: 'org_member', status: 'active' });
    ids[name] = String(u._id);
    tokens[name] = (await createToken(ids[name], orgId, { name: 't' })).token;
    emp[name] = String((await HrmsEmployee.create({ taskflowOrganizationId: org._id, employeeCode: name.toUpperCase(), name, email: `${name}@example.com`, userId: u._id, joinedDate: new Date() }))._id);
  }
  emp.cy = String((await HrmsEmployee.create({ taskflowOrganizationId: org._id, employeeCode: 'CY', name: 'cy', email: 'cy@example.com', joinedDate: new Date() }))._id);
  await HrmsEmployee.create({ taskflowOrganizationId: org._id, employeeCode: 'GONE', name: 'gone', joinedDate: new Date(), status: 'terminated' });
  teamId = String((await ResourceTeam.create({ taskflowOrganizationId: org._id, name: 'Delivery', memberIds: [ids.ana] }))._id);
  policyId = String((await DocumentRecord.create({ taskflowOrganizationId: org._id, title: 'Code of conduct', kind: 'policy', status: 'approved', content: 'Be kind.', version: 1 }))._id);
});

const assign = (body: Record<string, unknown>, who = 'hana') => call(who, 'PUT', `/documents/documents/${policyId}/acceptance/assignment`, body);
const report = () => call('hana', 'GET', `/documents/documents/${policyId}/acceptance`);
const statusOf = async (name: string) => (await report()).body.data.rows.find((r: { name: string }) => r.name === name)?.status;
const mine = async (who: string) => (await call(who, 'GET', '/me/hr/policies')).body.data as Array<{ documentId: string; status: string; version: number }>;

describe('policy read-and-accept (AUT-36)', () => {
  it('assigns to everyone; only HR can assign; people are asked straight away', async () => {
    expect((await assign({ everyone: true }, 'ana')).status).toBe(403);
    expect((await assign({})).status).toBe(400);
    expect((await assign({ everyone: true })).status).toBe(200);

    const r = (await report()).body.data;
    expect(r.counts).toEqual({ total: 4, accepted: 0, pending: 3, noAccount: 1 }); // terminated people are left out
    expect(r.rows.find((x: { name: string }) => x.name === 'cy').status).toBe('no_account');
    expect(notify).toHaveBeenCalledWith(expect.arrayContaining([ids.ana, ids.ben, ids.hana]), 'policy_acceptance_required', expect.objectContaining({ link: `/me/policies/${policyId}` }), ids.hana);
  });

  it('assigns to a team or to a person', async () => {
    await assign({ teamIds: [teamId] });
    expect((await report()).body.data.rows.map((x: { name: string }) => x.name)).toEqual(['ana']);
    expect(await mine('ben')).toEqual([]);

    await assign({ employeeIds: [emp.ben] });
    expect((await report()).body.data.rows.map((x: { name: string }) => x.name)).toEqual(['ben']);
    expect((await mine('ben')).map((p) => p.status)).toEqual(['pending']);
    expect(await mine('ana')).toEqual([]);

    expect((await assign({ employeeIds: [String(new mongoose.Types.ObjectId())] })).status).toBe(400);
  });

  it('employees read and accept from Me; accepting twice changes nothing', async () => {
    await assign({ everyone: true });
    const read = await call('ana', 'GET', `/me/hr/policies/${policyId}`);
    expect(read.body.data).toMatchObject({ title: 'Code of conduct', content: 'Be kind.', version: 1, status: 'pending' });

    const ok = await call('ana', 'POST', `/me/hr/policies/${policyId}/accept`, { version: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('accepted');
    expect((await call('ana', 'POST', `/me/hr/policies/${policyId}/accept`, { version: 1 })).status).toBe(200);
    expect(await PolicyAcceptance.countDocuments({ documentId: policyId })).toBe(1);
    expect(await statusOf('ana')).toBe('accepted');
    expect(await statusOf('ben')).toBe('pending');
  });

  it('a new version asks again, and an old version cannot be accepted', async () => {
    await assign({ everyone: true });
    await call('ana', 'POST', `/me/hr/policies/${policyId}/accept`, { version: 1 });
    notify.mockClear();

    // Editing the text makes version 2 and asks everyone who hasn't accepted it.
    const edited = await call('hana', 'PATCH', `/documents/documents/${policyId}`, { content: 'Be kind. Be on time.' });
    expect(edited.status).toBe(200);
    expect(edited.body.data.version).toBe(2);
    expect(notify).toHaveBeenCalledWith(expect.arrayContaining([ids.ana, ids.ben]), 'policy_acceptance_required', expect.objectContaining({ body: 'Version 2' }), undefined);

    expect((await mine('ana'))[0]).toMatchObject({ status: 'new_version', version: 2 });
    expect(await statusOf('ana')).toBe('outdated');
    const stale = await call('ana', 'POST', `/me/hr/policies/${policyId}/accept`, { version: 1 });
    expect(stale.status).toBe(409);
    expect((await call('ana', 'POST', `/me/hr/policies/${policyId}/accept`, { version: 2 })).body.data.status).toBe('accepted');
  });

  it('drafts and archived policies are not shown to employees', async () => {
    await assign({ everyone: true });
    await DocumentRecord.updateOne({ _id: policyId }, { status: 'draft' });
    expect(await mine('ana')).toEqual([]);
    expect((await call('ana', 'GET', `/me/hr/policies/${policyId}`)).status).toBe(404);
    expect((await call('hana', 'POST', `/documents/documents/${policyId}/acceptance/remind`)).status).toBe(400);
  });

  it('HR can remind pending people now, and reminders repeat on schedule, once per period', async () => {
    await assign({ everyone: true, remindEveryDays: 2 });
    await call('ana', 'POST', `/me/hr/policies/${policyId}/accept`, { version: 1 });
    notify.mockClear();

    const now = await call('hana', 'POST', `/documents/documents/${policyId}/acceptance/remind`);
    expect(now.body.data.reminded).toBe(2); // ben and hana; cy has no account, ana accepted
    expect(notify).toHaveBeenCalledWith(expect.not.arrayContaining([ids.ana]), 'policy_acceptance_required', expect.objectContaining({ title: expect.stringMatching(/^Reminder/) }), ids.hana);

    // Not yet a full period since assigning: nothing.
    expect(await remindPendingPolicies(new Date())).toBe(0);
    const later = new Date(Date.now() + 2 * DAY + 60_000);
    expect(await remindPendingPolicies(later)).toBe(2);
    expect(await remindPendingPolicies(later)).toBe(0); // same period: not again
    expect(await remindPendingPolicies(new Date(Date.now() + 4 * DAY + 60_000))).toBe(2);

    // Turned off: no reminders.
    await assign({ everyone: true, remindEveryDays: 0 });
    expect(await remindPendingPolicies(new Date(Date.now() + 30 * DAY))).toBe(0);
  });

  it('only policies can be assigned', async () => {
    const sow = await DocumentRecord.create({ taskflowOrganizationId: orgOid, title: 'SOW', kind: 'sow', status: 'approved' });
    expect((await call('hana', 'PUT', `/documents/documents/${sow._id}/acceptance/assignment`, { everyone: true })).status).toBe(400);
  });
});
