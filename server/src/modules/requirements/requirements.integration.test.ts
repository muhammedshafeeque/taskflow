import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import * as svc from './requirements.service';
import { ChangeRequest, Requirement, RequirementSettings } from './requirement.models';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { Issue } from '../issues/issue.model';
import { CustomerProjectMapping } from '../customer-portal/customer-project-mapping/customerProjectMapping.model';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const id = () => new mongoose.Types.ObjectId();
const ba = String(id());
const baLead = String(id());
const pm = String(id());
const customerOrg = String(id());
const customer = { id: String(id()), orgId: customerOrg, name: 'Cara Client', email: 'cara@client.test' };
const stranger = { id: String(id()), orgId: String(id()), name: 'Other', email: 'other@x.test' };
let mongo: MongoMemoryServer;
let projectId = '';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([Requirement.init(), ChangeRequest.init(), RequirementSettings.init()]);
});
beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await Promise.all([Requirement.init(), ChangeRequest.init(), RequirementSettings.init()]);
  const p = await Project.create({ name: 'Portal', key: 'POR', lead: pm, taskflowOrganizationId: id() });
  projectId = String(p._id);
  await ProjectMember.create([{ project: p._id, user: ba }, { project: p._id, user: baLead }, { project: p._id, user: pm }]);
  await CustomerProjectMapping.create({ customerOrgId: customerOrg, projectId: p._id, mappedBy: pm });
  await svc.updateSettings(projectId, { baLeadUserId: baLead });
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

const newRequirement = async () => (await svc.createRequirement(projectId, { title: 'Login', content: 'Users sign in with email and password.' }, ba))!;
const signedRequirement = async () => {
  const r = await newRequirement();
  await svc.sendForSignOff(projectId, String(r._id), ba);
  await svc.customerSignOff(customer, String(r._id), { decision: 'sign', name: 'Cara Client' });
  return String(r._id);
};
const pendingChange = async (requirementId?: string) => {
  const cr = (await svc.createChangeRequest(projectId, { title: 'Add SSO', description: 'Sign in with Google too', costImpact: 2500, currency: 'eur', scheduleImpactDays: 5, requirementId }, ba))!;
  await svc.submitChangeRequest(projectId, String(cr._id), ba);
  return String(cr._id);
};
const approvedChange = async (requirementId?: string) => {
  const crId = await pendingChange(requirementId);
  await svc.decideAsStaff(projectId, crId, 'approve', baLead);
  await svc.decideAsStaff(projectId, crId, 'approve', pm);
  await svc.customerDecideChange(customer, crId, { decision: 'approve' });
  return crId;
};

describe('requirement sign-off (AUT-44)', () => {
  it('numbers requirements and change requests per project without reusing numbers', async () => {
    const a = await newRequirement();
    await Requirement.deleteOne({ _id: a._id });
    const b = await newRequirement();
    expect([a.key, b.key]).toEqual(['REQ-1', 'REQ-2']);
    const cr = await svc.createChangeRequest(projectId, { title: 'x' }, ba);
    expect(cr!.key).toBe('CR-1');
  });

  it('a customer signs off the version sent to them, typing their name', async () => {
    const r = await newRequirement();
    // Drafts are not visible to the customer.
    expect(await svc.customerListRequirements(customer)).toHaveLength(0);
    await svc.sendForSignOff(projectId, String(r._id), ba);
    const listed = await svc.customerListRequirements(customer);
    expect(listed[0]).toMatchObject({ key: 'REQ-1', awaitingSignOff: true });
    await expect(svc.customerSignOff(customer, String(r._id), { decision: 'sign', name: ' ' })).rejects.toMatchObject({ statusCode: 400 });
    const signed = await svc.customerSignOff(customer, String(r._id), { decision: 'sign', name: 'Cara Client', version: 1 });
    expect(signed).toMatchObject({ status: 'signed_off', awaitingSignOff: false });
    const stored = (await Requirement.findById(r._id).lean())!;
    expect(stored.versions[0].signOff).toMatchObject({ decision: 'signed', by: { name: 'Cara Client', email: 'cara@client.test' } });
    await expect(svc.customerSignOff(customer, String(r._id), { decision: 'sign', name: 'Cara' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('a sent version is locked; rejection needs a reason; only customers of the project can answer', async () => {
    const r = await newRequirement();
    await svc.sendForSignOff(projectId, String(r._id), ba);
    await expect(svc.updateRequirement(projectId, String(r._id), { content: 'changed' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(svc.customerSignOff(stranger, String(r._id), { decision: 'sign', name: 'X' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.customerSignOff(customer, String(r._id), { decision: 'reject', name: 'Cara' })).rejects.toMatchObject({ statusCode: 400 });
    const rejected = await svc.customerSignOff(customer, String(r._id), { decision: 'reject', name: 'Cara', note: 'Add password reset' });
    expect(rejected.status).toBe('rejected');
    // Never signed off, so the BA can revise without a change request.
    const v2 = await svc.newVersion(projectId, String(r._id), { content: 'With password reset', summary: 'Added reset' }, ba);
    expect(v2!.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(v2!.status).toBe('draft');
  });

  it('cannot be sent when nobody can sign it, or when empty', async () => {
    const r = await newRequirement();
    await CustomerProjectMapping.deleteMany({});
    await expect(svc.sendForSignOff(projectId, String(r._id), ba)).rejects.toMatchObject({ statusCode: 400 });
    await CustomerProjectMapping.create({ customerOrgId: customerOrg, projectId, mappedBy: pm });
    const empty = await svc.createRequirement(projectId, { title: 'Empty' }, ba);
    await expect(svc.sendForSignOff(projectId, String(empty!._id), ba)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('after sign-off, a new version needs an approved change request, used once', async () => {
    const reqId = await signedRequirement();
    await expect(svc.newVersion(projectId, reqId, { content: 'v2' }, ba)).rejects.toMatchObject({ statusCode: 400 });
    const pending = await pendingChange(reqId);
    await expect(svc.newVersion(projectId, reqId, { content: 'v2', changeRequestId: pending }, ba)).rejects.toMatchObject({ statusCode: 400 });
    const crId = await approvedChange(reqId);
    const v2 = await svc.newVersion(projectId, reqId, { content: 'v2 with SSO', changeRequestId: crId }, ba);
    expect(v2!.versions[1]).toMatchObject({ version: 2, content: 'v2 with SSO' });
    await svc.sendForSignOff(projectId, reqId, ba);
    await svc.customerSignOff(customer, reqId, { decision: 'sign', name: 'Cara' });
    await expect(svc.newVersion(projectId, reqId, { content: 'v3', changeRequestId: crId }, ba)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('change requests (AUT-44)', () => {
  it('records cost and date impact, and is approved by the BA lead, then the PM, then the customer', async () => {
    const crId = await pendingChange();
    let cr = (await ChangeRequest.findById(crId).lean())!;
    expect(cr).toMatchObject({ status: 'pending', costImpact: 2500, currency: 'EUR', scheduleImpactDays: 5 });
    expect(cr.steps.map((s) => s.status)).toEqual(['pending', 'waiting', 'waiting']);

    // Out of turn, or the wrong person.
    await expect(svc.decideAsStaff(projectId, crId, 'approve', pm)).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.decideAsStaff(projectId, crId, 'approve', ba)).rejects.toMatchObject({ statusCode: 403 });
    expect(await svc.customerListChanges(customer)).toHaveLength(0);
    await expect(svc.customerDecideChange(customer, crId, { decision: 'approve' })).rejects.toMatchObject({ statusCode: 404 });

    await svc.decideAsStaff(projectId, crId, 'approve', baLead);
    await expect(svc.decideAsStaff(projectId, crId, 'approve', baLead)).rejects.toMatchObject({ statusCode: 403 });
    await svc.decideAsStaff(projectId, crId, 'approve', pm);
    await expect(svc.decideAsStaff(projectId, crId, 'approve', pm)).rejects.toMatchObject({ statusCode: 409 });

    const forCustomer = await svc.customerListChanges(customer);
    expect(forCustomer[0]).toMatchObject({ key: 'CR-1', waitingForYou: true, costImpact: 2500, scheduleImpactDays: 5 });
    expect(await svc.customerListChanges(stranger)).toHaveLength(0);
    await expect(svc.customerDecideChange(stranger, crId, { decision: 'approve' })).rejects.toMatchObject({ statusCode: 404 });
    const done = await svc.customerDecideChange(customer, crId, { decision: 'approve' });
    expect(done).toMatchObject({ status: 'approved', waitingForYou: false, yourDecision: { status: 'approved', name: 'Cara Client' } });
    cr = (await ChangeRequest.findById(crId).lean())!;
    expect(cr.steps.map((s) => s.status)).toEqual(['approved', 'approved', 'approved']);
    expect(String(cr.steps[0].userId)).toBe(baLead);
    expect(String(cr.steps[1].userId)).toBe(pm);
  });

  it('a rejection at any step ends it with a reason; it can be changed and sent again from the start', async () => {
    const crId = await pendingChange();
    await svc.decideAsStaff(projectId, crId, 'approve', baLead);
    await expect(svc.decideAsStaff(projectId, crId, 'reject', pm, '')).rejects.toMatchObject({ statusCode: 400 });
    const rejected = await svc.decideAsStaff(projectId, crId, 'reject', pm, 'Too expensive');
    expect(rejected!.status).toBe('rejected');
    expect(await svc.customerListChanges(customer)).toHaveLength(0);
    await svc.updateChangeRequest(projectId, crId, { costImpact: 1000 });
    const again = await svc.submitChangeRequest(projectId, crId, ba);
    expect(again!.steps.map((s) => s.status)).toEqual(['pending', 'waiting', 'waiting']);
  });

  it('needs a description, a BA lead and a customer before it can be sent', async () => {
    const noDesc = await svc.createChangeRequest(projectId, { title: 'x' }, ba);
    await expect(svc.submitChangeRequest(projectId, String(noDesc!._id), ba)).rejects.toMatchObject({ statusCode: 400 });
    const cr = await svc.createChangeRequest(projectId, { title: 'x', description: 'y' }, ba);
    await svc.updateSettings(projectId, { baLeadUserId: null });
    await expect(svc.submitChangeRequest(projectId, String(cr!._id), ba)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/BA lead/) });
    await expect(svc.updateSettings(projectId, { baLeadUserId: String(id()) })).rejects.toMatchObject({ statusCode: 400 });
    for (const bad of [{ costImpact: 'lots' }, { scheduleImpactDays: 1.5 }, { title: ' ' }]) {
      await expect(svc.updateChangeRequest(projectId, String(cr!._id), bad)).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it('is decided once, even when the customer answers twice at the same moment', async () => {
    const crId = await pendingChange();
    await svc.decideAsStaff(projectId, crId, 'approve', baLead);
    await svc.decideAsStaff(projectId, crId, 'approve', pm);
    const results = await Promise.allSettled([
      svc.customerDecideChange(customer, crId, { decision: 'approve' }),
      svc.customerDecideChange({ ...customer, id: String(id()), name: 'Colleague' }, crId, { decision: 'reject', note: 'no' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('only approved changes link to stories: existing issues by key, or a new story', async () => {
    const pending = await pendingChange();
    await expect(svc.linkIssue(projectId, pending, { title: 'Story' }, ba)).rejects.toMatchObject({ statusCode: 409 });
    const crId = await approvedChange();
    const existing = await Issue.create({ title: 'SSO button', key: 'POR-7', reporter: ba, project: projectId, type: 'Story' });
    const otherProject = await Issue.create({ title: 'Elsewhere', key: 'ZZZ-1', reporter: ba, project: id() });
    await expect(svc.linkIssue(projectId, crId, { issueKey: 'zzz-1' }, ba)).rejects.toMatchObject({ statusCode: 400 });
    await expect(svc.linkIssue(projectId, crId, { issueId: String(otherProject._id) }, ba)).rejects.toMatchObject({ statusCode: 400 });
    await svc.linkIssue(projectId, crId, { issueKey: 'por-7' }, ba);
    const linked = await svc.linkIssue(projectId, crId, { title: 'Google sign-in' }, ba);
    expect(linked!.linkedIssueIds).toHaveLength(2);
    const story = await Issue.findOne({ title: 'Google sign-in' }).lean();
    expect(story).toMatchObject({ type: 'Story' });
    expect(String(story!.project)).toBe(projectId);
    expect(story!.description).toMatch(/CR-1/);
    expect((await svc.changesForIssue(String(existing._id)))[0]).toMatchObject({ key: 'CR-1' });
    const unlinked = await svc.unlinkIssue(projectId, crId, String(existing._id));
    expect(unlinked!.linkedIssueIds).toHaveLength(1);
  });

  it('can be cancelled until it is approved', async () => {
    const crId = await pendingChange();
    expect((await svc.cancelChangeRequest(projectId, crId, ba))!.status).toBe('cancelled');
    const approved = await approvedChange();
    await expect(svc.cancelChangeRequest(projectId, approved, ba)).rejects.toMatchObject({ statusCode: 409 });
  });
});
