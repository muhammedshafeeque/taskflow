import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { apiRoutes } from '../../routes';
import { errorHandler } from '../../middleware/errorHandler';
import { Role } from '../roles/role.model';
import { User } from '../auth/user.model';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { createToken } from '../apiTokens/apiToken.service';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { HrmsCandidate, HrmsJobOpening } from './models/hrmsPeople.model';
import { HrmsOffer } from './models/hrmsOffer.model';
import { HrmsEmployee } from './models/hrmsEmployee.model';
import { HrmsSettings } from './models/hrmsPolicy.model';
import { offerToken } from './offers.service';
import { decide as decideApproval, myQueue } from '../approvals/approvals.service';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as email from '../../services/email.service';

jest.mock('../../services/email.service', () => {
  const fns: Record<string, jest.Mock> = {};
  return new Proxy({}, { get: (_t, name: string) => (name === '__esModule' ? true : name === 'tfEmailWrap' ? (s: string) => s : (fns[name] ??= jest.fn().mockResolvedValue(undefined))) });
});
jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const H = TASK_FLOW_PERMISSIONS.TASKFLOW.HR;
const A = TASK_FLOW_PERMISSIONS.TASKFLOW.APPROVALS;

let mongo: MongoMemoryServer;
let server: Server;
let base = '';
let orgId = '';
let orgOid: mongoose.Types.ObjectId;
let jobId = '';
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};

async function call(who: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(who ? { Authorization: `Bearer ${tokens[who]}`, 'x-organization-id': orgId } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as { success?: boolean; message?: string; data?: any } };
}

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongo.getUri());
  const app = express();
  app.use(express.json());
  app.use('/api', apiRoutes);
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

/** hana: recruiter who may set pay. rita: recruiter without pay rights. fin: approves pay. */
beforeEach(async () => {
  await flushAuditLogs();
  await mongoose.connection.dropDatabase();
  await HrmsOffer.syncIndexes();
  (email.sendCustomerEmail as jest.Mock).mockClear();
  const [hrRole, ritaRole, finRole] = await Role.create([
    { name: 'HR', permissions: [H.RECRUITMENT.MANAGE, H.RECRUITMENT.READ, H.SALARY.MANAGE, H.SCOPE.ALL, H.EMPLOYEE.LIST, A.POLICY.MANAGE] },
    { name: 'Recruiter', permissions: [H.RECRUITMENT.MANAGE, H.RECRUITMENT.READ, H.SCOPE.ALL] },
    { name: 'Finance', permissions: [H.SALARY.MANAGE, H.SCOPE.ALL] },
  ]);
  const org = await Organization.create({ name: 'Northwind Studio', slug: 'northwind', createdBy: new mongoose.Types.ObjectId() });
  orgId = String(org._id);
  orgOid = org._id as mongoose.Types.ObjectId;
  for (const [name, role] of Object.entries({ hana: hrRole, rita: ritaRole, fin: finRole })) {
    const u = await User.create({ email: `${name}@example.com`, name, password: 'Passw0rd!x', mustChangePassword: false, roleId: role._id });
    await OrganizationMember.create({ organization: org._id, user: u._id, role: 'org_member', status: 'active' });
    ids[name] = String(u._id);
    tokens[name] = (await createToken(ids[name], orgId, { name: 't' })).token;
  }
  jobId = String((await HrmsJobOpening.create({ taskflowOrganizationId: org._id, title: 'Developer', openings: 1, stages: ['Applied', 'Offer', 'Hired'], currency: 'INR', salaryMax: 1_000_000, status: 'open' }))._id);
});

const candidate = async (name = 'Jo', extra: Record<string, unknown> = {}) =>
  String((await HrmsCandidate.create({ taskflowOrganizationId: orgOid, jobId, name, email: `${name.toLowerCase()}@cand.test`, stage: 'Offer', ...extra }))._id);
const draft = (cand: string, body: Record<string, unknown> = {}, who = 'hana') =>
  call(who, 'POST', `/hrms/candidates/${cand}/offers`, { annualCtc: 900_000, joiningDate: '2027-01-04', expiresAt: '2030-01-01', ...body });

async function sentOffer(cand: string) {
  const id = (await draft(cand)).body.data._id;
  await call('hana', 'POST', `/hrms/offers/${id}/submit`);
  await call('fin', 'POST', `/hrms/offers/${id}/approve`);
  await call('hana', 'POST', `/hrms/offers/${id}/send`);
  return id as string;
}

describe('offer letters (AUT-37)', () => {
  it('is generated, approved by someone else with pay rights, sent and accepted online', async () => {
    const cand = await candidate();
    const made = await draft(cand);
    expect(made.status).toBe(200);
    expect(made.body.data).toMatchObject({ status: 'draft', designation: 'Developer', currency: 'INR', aboveBand: false });
    expect(made.body.data.letter).toMatch(/Dear Jo,/);
    expect(made.body.data.letter).toMatch(/INR 900,000/);
    expect(made.body.data.letter).toMatch(/Northwind Studio/);
    const id = made.body.data._id;

    // Only one open offer per candidate.
    expect((await draft(cand)).status).toBe(409);

    expect((await call('hana', 'POST', `/hrms/offers/${id}/send`)).status).toBe(409); // not approved yet
    expect((await call('hana', 'POST', `/hrms/offers/${id}/submit`)).body.data.status).toBe('pending_approval');
    expect((await call('hana', 'POST', `/hrms/offers/${id}/approve`)).status).toBe(403); // own offer
    expect((await call('rita', 'POST', `/hrms/offers/${id}/approve`)).status).toBe(403); // no pay rights
    expect((await call('fin', 'POST', `/hrms/offers/${id}/approve`)).body.data.status).toBe('approved');

    const sent = await call('hana', 'POST', `/hrms/offers/${id}/send`);
    expect(sent.body.data.status).toBe('sent');
    expect(email.sendCustomerEmail).toHaveBeenCalledWith('jo@cand.test', expect.stringContaining('offer'), expect.stringContaining('/offer/'));
    const token = String(sent.body.data.url).split('/offer/')[1];

    const view = await call(null, 'GET', `/public/offers/${token}`);
    expect(view.body.data).toMatchObject({ company: 'Northwind Studio', name: 'Jo', designation: 'Developer', annualCtc: 900_000, status: 'open' });
    expect((await call(null, 'POST', `/public/offers/${token}/respond`, { decision: 'accept' })).status).toBe(400); // must sign with a name
    const accepted = await call(null, 'POST', `/public/offers/${token}/respond`, { decision: 'accept', name: 'Jo Bloggs' });
    expect(accepted.body.data).toMatchObject({ status: 'accepted', response: { decision: 'accepted', name: 'Jo Bloggs' } });
    expect((await call(null, 'POST', `/public/offers/${token}/respond`, { decision: 'decline', name: 'Jo' })).status).toBe(409);
    expect((await call(null, 'GET', `/public/offers/${token}x`)).status).toBe(404);
    // The link can't be used to sign in.
    expect((await fetch(`${base}/api/hrms/jobs`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it('can be sent back with a reason, changed, and declined by the candidate', async () => {
    const id = (await draft(await candidate())).body.data._id;
    await call('hana', 'POST', `/hrms/offers/${id}/submit`);
    expect((await call('fin', 'POST', `/hrms/offers/${id}/reject`)).status).toBe(400);
    const back = await call('fin', 'POST', `/hrms/offers/${id}/reject`, { note: 'Too high for the band' });
    expect(back.body.data).toMatchObject({ status: 'draft', rejectionNote: 'Too high for the band' });
    const changed = await call('hana', 'PATCH', `/hrms/offers/${id}`, { annualCtc: 800_000 });
    expect(changed.body.data.letter).toMatch(/800,000/);
    await call('hana', 'POST', `/hrms/offers/${id}/submit`);
    await call('fin', 'POST', `/hrms/offers/${id}/approve`);
    expect((await call('hana', 'PATCH', `/hrms/offers/${id}`, { annualCtc: 1 })).status).toBe(409); // approved: no more changes
    await call('hana', 'POST', `/hrms/offers/${id}/send`);
    const token = offerToken(id);
    expect((await call(null, 'POST', `/public/offers/${token}/respond`, { decision: 'decline', name: 'Jo', note: 'Took another job' })).body.data.status).toBe('declined');
  });

  it('needs pay rights to put a salary in an offer, and flags pay above the band', async () => {
    expect((await draft(await candidate(), {}, 'rita')).status).toBe(403);
    expect((await draft(await candidate('Al'), { annualCtc: 2_000_000 })).body.data.aboveBand).toBe(true);
  });

  it('goes through the approval chain when one is set up for offers', async () => {
    const chain = await call('hana', 'PUT', '/approvals/policies/offer', { enabled: true, steps: [{ name: 'Finance', kind: 'users', userIds: [ids.fin] }] });
    expect(chain.status).toBe(200);
    const id = (await draft(await candidate())).body.data._id;
    await call('hana', 'POST', `/hrms/offers/${id}/submit`);
    expect((await call('fin', 'POST', `/hrms/offers/${id}/approve`)).status).toBe(409); // decide in Approvals
    const req = (await myQueue(orgId, { userId: ids.fin, permissions: [] })).find((r) => String((r as { recordId: unknown }).recordId) === id) as { _id: unknown };
    expect(req).toBeTruthy();
    await decideApproval(orgId, String(req._id), { userId: ids.fin, permissions: [] }, 'approve');
    expect((await HrmsOffer.findById(id).lean())!.status).toBe('approved');
  });
});

describe('hiring rules (AUT-37)', () => {
  const hire = (cand: string, body: Record<string, unknown> = {}) => call('hana', 'POST', `/hrms/candidates/${cand}/hire`, { joinedDate: '2027-01-04', ...body });

  it('can require an accepted offer, and takes its terms', async () => {
    await HrmsSettings.create({ taskflowOrganizationId: orgOid, requireAcceptedOffer: true });
    const cand = await candidate();
    const without = await call('hana', 'POST', `/hrms/candidates/${cand}/hire`, {});
    expect(without.status).toBe(409);
    expect(without.body.message).toMatch(/accepted offer/);

    const id = await sentOffer(cand);
    await call(null, 'POST', `/public/offers/${offerToken(id)}/respond`, { decision: 'accept', name: 'Jo' });
    const hired = await call('hana', 'POST', `/hrms/candidates/${cand}/hire`, {});
    expect(hired.status).toBe(200);
    const e = (await HrmsEmployee.findById(hired.body.data.employee._id).lean())!;
    expect(e).toMatchObject({ annualCtc: 900_000, designation: 'Developer', currency: 'INR' });
    expect(e.joinedDate.toISOString().slice(0, 10)).toBe('2027-01-04');
  });

  it('closes the opening when it is filled and refuses more hires', async () => {
    expect((await hire(await candidate('A'))).status).toBe(200);
    expect((await HrmsJobOpening.findById(jobId).lean())!).toMatchObject({ status: 'closed', filled: 1 });
    const second = await hire(await candidate('B'));
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/filled/);
  });

  it('never hires more than the openings, even at the same moment', async () => {
    await HrmsJobOpening.updateOne({ _id: jobId }, { openings: 2 });
    const cands = await Promise.all(['A', 'B', 'C', 'D'].map((n) => candidate(n)));
    const results = await Promise.all(cands.map((c) => hire(c)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(await HrmsEmployee.countDocuments()).toBe(2);
    expect((await HrmsJobOpening.findById(jobId).lean())!).toMatchObject({ filled: 2, status: 'closed' });
  });

  it('counts people hired before places were counted', async () => {
    await HrmsJobOpening.updateOne({ _id: jobId }, { openings: 2, $unset: { filled: 1 } });
    await candidate('Old', { status: 'hired' });
    expect((await hire(await candidate('New'))).status).toBe(200);
    expect((await hire(await candidate('Late'))).status).toBe(409);
  });
});

describe('careers page (AUT-37)', () => {
  it('lists published openings and accepts applications once the page is on', async () => {
    expect((await call(null, 'GET', '/public/careers/northwind')).status).toBe(404);
    await HrmsSettings.create({ taskflowOrganizationId: orgOid, careersPageEnabled: true, careersIntro: 'Join us' });
    expect((await call(null, 'GET', '/public/careers/northwind')).body.data).toMatchObject({ company: 'Northwind Studio', intro: 'Join us', jobs: [] });

    await HrmsJobOpening.updateOne({ _id: jobId }, { published: true, description: 'Build things' });
    const page = (await call(null, 'GET', '/public/careers/northwind')).body.data;
    expect(page.jobs).toEqual([expect.objectContaining({ _id: jobId, title: 'Developer', description: 'Build things' })]);
    expect(page.jobs[0]).not.toHaveProperty('salaryMax');

    const apply = (body: Record<string, unknown>) => call(null, 'POST', `/public/careers/northwind/jobs/${jobId}/apply`, body);
    expect((await apply({ name: 'Ann', email: 'nope' })).status).toBe(400);
    expect((await apply({ name: 'Ann', email: 'ann@x.test', resumeUrl: 'javascript:alert(1)' })).status).toBe(400);
    expect((await apply({ name: 'Ann', email: 'ann@x.test', resumeUrl: 'https://cv.test/ann.pdf', coverNote: 'Hello' })).status).toBe(200);
    expect(await HrmsCandidate.findOne({ email: 'ann@x.test' }).lean()).toMatchObject({ source: 'careers_page', stage: 'Applied', status: 'active', resumeUrl: 'https://cv.test/ann.pdf', coverNote: 'Hello' });
    expect((await apply({ name: 'Ann', email: 'ann@x.test' })).status).toBe(409);
    // Bots that fill the hidden field get a polite answer and nothing is saved.
    expect((await apply({ name: 'Bot', email: 'bot@x.test', website: 'spam.test' })).status).toBe(200);
    expect(await HrmsCandidate.exists({ email: 'bot@x.test' })).toBeNull();

    // Closed or unpublished openings disappear.
    await HrmsJobOpening.updateOne({ _id: jobId }, { status: 'closed' });
    expect((await call(null, 'GET', '/public/careers/northwind')).body.data.jobs).toEqual([]);
    expect((await apply({ name: 'Cy', email: 'cy@x.test' })).status).toBe(404);
  });
});
