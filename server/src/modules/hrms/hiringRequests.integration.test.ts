import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  cancelHiringRequest,
  createHiringRequest,
  decideHiringRequest,
  getHiringRequest,
  hiringPlan,
  listHiringRequests,
  openJobFromDemand,
  openJobFromRequest,
  submitHiringRequest,
  updateHiringRequest,
} from './hiringRequests.service';
import { HrmsHiringRequest } from './models/hrmsHiringRequest.model';
import { HrmsJobOpening } from './models/hrmsPeople.model';
import { ResourceDemand } from '../resources/models/resourceDemand.model';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';

jest.mock('../notifications/notificationDispatch.service', () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.setTimeout(120_000);

const H = TASK_FLOW_PERMISSIONS.TASKFLOW.HR;
const org = String(new mongoose.Types.ObjectId());
const person = (...permissions: string[]) => ({ id: String(new mongoose.Types.ObjectId()), permissions });
const head = person(H.HIRING_REQUEST.CREATE);
const otherHead = person(H.HIRING_REQUEST.CREATE);
const approver = person(H.HIRING_REQUEST.APPROVE);
const recruiter = person(H.RECRUITMENT.MANAGE);
let mongo: MongoMemoryServer;

const draft = (extra: Record<string, unknown> = {}, who = head) =>
  createHiringRequest(org, { title: 'Backend developer', department: 'Engineering', headcount: 2, budgetMin: 50_000, budgetMax: 70_000, currency: 'usd', justification: 'Two new client projects', ...extra }, who);
const approved = async (extra: Record<string, unknown> = {}) => {
  const r = await draft(extra);
  await submitHiringRequest(org, String(r!._id), head);
  return decideHiringRequest(org, String(r!._id), 'approve', approver);
};
const demand = (extra: Record<string, unknown> = {}) =>
  ResourceDemand.create({ taskflowOrganizationId: org, title: 'React dev for Northwind', roleLabel: 'React developer', hoursNeeded: 320, periodStart: new Date('2027-01-04'), periodEnd: new Date('2027-03-26'), skills: ['react', 'typescript'], ...extra });

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
beforeEach(async () => {
  await Promise.all([HrmsHiringRequest.deleteMany({}), HrmsJobOpening.deleteMany({}), ResourceDemand.deleteMany({})]);
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('hiring requests (AUT-41)', () => {
  it('a department head raises a draft and sends it for approval', async () => {
    const r = await draft();
    expect(r).toMatchObject({ status: 'draft', headcount: 2, currency: 'USD' });
    const sent = await submitHiringRequest(org, String(r!._id), head);
    expect(sent!.status).toBe('pending_approval');
    await expect(submitHiringRequest(org, String(r!._id), head)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('needs a role, a valid headcount and budget, and a reason before it is sent', async () => {
    await expect(createHiringRequest(org, {}, head)).rejects.toMatchObject({ statusCode: 400 });
    for (const bad of [{ headcount: 0 }, { headcount: 1.5 }, { budgetMax: -1 }, { budgetMin: 90_000, budgetMax: 10 }, { employmentType: 'gig' }, { targetStartDate: 'soon' }]) {
      await expect(draft(bad)).rejects.toMatchObject({ statusCode: 400 });
    }
    const noBudget = await draft({ budgetMin: null, budgetMax: null });
    await expect(submitHiringRequest(org, String(noBudget!._id), head)).rejects.toMatchObject({ statusCode: 400 });
    const noReason = await draft({ justification: ' ' });
    await expect(submitHiringRequest(org, String(noReason!._id), head)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('only the approver decides, never on their own request, and rejecting needs a reason', async () => {
    const r = await draft();
    const id = String(r!._id);
    await expect(decideHiringRequest(org, id, 'approve', approver)).rejects.toMatchObject({ statusCode: 409 });
    await submitHiringRequest(org, id, head);
    await expect(decideHiringRequest(org, id, 'approve', head)).rejects.toMatchObject({ statusCode: 403 });
    await expect(decideHiringRequest(org, id, 'approve', recruiter)).rejects.toMatchObject({ statusCode: 403 });
    const selfRaised = await draft({}, approver);
    await submitHiringRequest(org, String(selfRaised!._id), approver);
    await expect(decideHiringRequest(org, String(selfRaised!._id), 'approve', approver)).rejects.toMatchObject({ statusCode: 403 });
    await expect(decideHiringRequest(org, id, 'reject', approver, '')).rejects.toMatchObject({ statusCode: 400 });
    const rejected = await decideHiringRequest(org, id, 'reject', approver, 'No budget this quarter');
    expect(rejected).toMatchObject({ status: 'rejected', decisionNote: 'No budget this quarter' });
  });

  it('a rejected request can be changed and sent again; only its author changes it', async () => {
    const r = await draft();
    const id = String(r!._id);
    await submitHiringRequest(org, id, head);
    await decideHiringRequest(org, id, 'reject', approver, 'Too many');
    await expect(updateHiringRequest(org, id, { headcount: 1 }, otherHead)).rejects.toMatchObject({ statusCode: 404 });
    expect(await updateHiringRequest(org, id, { headcount: 1 }, head)).toMatchObject({ headcount: 1 });
    const again = await submitHiringRequest(org, id, head);
    expect(again).toMatchObject({ status: 'pending_approval' });
    expect(again!.decisionNote).toBeUndefined();
    await expect(updateHiringRequest(org, id, { headcount: 3 }, head)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('is decided once, even when approve and reject are pressed together', async () => {
    const r = await draft();
    await submitHiringRequest(org, String(r!._id), head);
    await Promise.allSettled([decideHiringRequest(org, String(r!._id), 'approve', approver), decideHiringRequest(org, String(r!._id), 'reject', person(H.HIRING_REQUEST.APPROVE), 'no')]);
    const after = await HrmsHiringRequest.findById(r!._id).lean();
    expect(['approved', 'rejected']).toContain(after!.status);
    expect(after!.decidedBy).toBeTruthy();
  });

  it('people see their own requests; approvers and recruiters see all', async () => {
    await draft();
    await draft({}, otherHead);
    expect(await listHiringRequests(org, {}, head)).toHaveLength(1);
    expect(await listHiringRequests(org, {}, approver)).toHaveLength(2);
    expect(await listHiringRequests(org, {}, recruiter)).toHaveLength(2);
    const theirs = (await listHiringRequests(org, {}, otherHead))[0];
    await expect(getHiringRequest(org, String(theirs._id), head)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('an approved request opens one job with its headcount and budget', async () => {
    const r = await approved();
    const id = String(r!._id);
    await expect(openJobFromRequest(org, String((await draft())!._id), recruiter)).rejects.toMatchObject({ statusCode: 409 });
    const results = await Promise.allSettled([openJobFromRequest(org, id, recruiter), openJobFromRequest(org, id, recruiter)]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const job = await HrmsJobOpening.findOne({ hiringRequestId: id }).lean();
    expect(job).toMatchObject({ title: 'Backend developer', department: 'Engineering', openings: 2, salaryMin: 50_000, salaryMax: 70_000, currency: 'USD', status: 'open' });
    expect(String(job!.hiringManagerId)).toBe(head.id);
    expect(job!.stages.length).toBeGreaterThan(0);
    expect(await HrmsJobOpening.countDocuments()).toBe(1);
    expect((await HrmsHiringRequest.findById(id).lean())).toMatchObject({ status: 'opened', jobId: job!._id });
    await expect(cancelHiringRequest(org, id, head)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('can be cancelled by its author or a recruiter, not by others', async () => {
    const r = await draft();
    await expect(cancelHiringRequest(org, String(r!._id), approver)).rejects.toMatchObject({ statusCode: 403 });
    expect(await cancelHiringRequest(org, String(r!._id), head)).toMatchObject({ status: 'cancelled' });
    await expect(cancelHiringRequest(org, String(r!._id), head)).rejects.toMatchObject({ statusCode: 409 });
    const other = await draft();
    expect(await cancelHiringRequest(org, String(other!._id), recruiter)).toMatchObject({ status: 'cancelled' });
  });

  it('the hiring plan totals headcount and budget by department', async () => {
    await approved();
    const waiting = await draft({ department: 'Design', headcount: 1, budgetMin: 40_000, budgetMax: null });
    await submitHiringRequest(org, String(waiting!._id), head);
    await draft({ department: 'Design' }); // drafts are not in the plan
    const opened = await approved({ headcount: 3 });
    const job = await openJobFromRequest(org, String(opened!._id), recruiter);
    await HrmsJobOpening.updateOne({ _id: job._id }, { $set: { filled: 1 } });
    const plan = await hiringPlan(org);
    expect(plan.departments).toEqual([
      { department: 'Design', currency: 'USD', requested: 1, approved: 0, opened: 0, hired: 0, requestedBudget: 40_000, approvedBudget: 0 },
      { department: 'Engineering', currency: 'USD', requested: 0, approved: 5, opened: 3, hired: 1, requestedBudget: 0, approvedBudget: 350_000 },
    ]);
    expect(plan.totals).toEqual([{ currency: 'USD', requested: 1, approved: 5, opened: 3, hired: 1, requestedBudget: 40_000, approvedBudget: 350_000 }]);
  });
});

describe('resource demand to recruitment (AUT-41)', () => {
  it('opens one job for an unfilled demand and links it', async () => {
    const d = await demand();
    const results = await Promise.allSettled([openJobFromDemand(org, String(d._id), recruiter, { headcount: 2 }), openJobFromDemand(org, String(d._id), recruiter)]);
    expect(results.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await HrmsJobOpening.countDocuments()).toBe(1);
    const job = await HrmsJobOpening.findOne({ demandId: d._id }).lean();
    expect(job!.title).toBe('React developer');
    expect(job!.description).toMatch(/320 hours/);
    expect(job!.description).toMatch(/react, typescript/);
    expect(String((await ResourceDemand.findById(d._id).lean())!.jobId)).toBe(String(job!._id));
  });

  it('refuses a filled or cancelled demand, or one from another workspace', async () => {
    for (const status of ['filled', 'cancelled']) {
      const d = await demand({ status });
      await expect(openJobFromDemand(org, String(d._id), recruiter)).rejects.toMatchObject({ statusCode: 409 });
    }
    const foreign = await demand({ taskflowOrganizationId: new mongoose.Types.ObjectId() });
    await expect(openJobFromDemand(org, String(foreign._id), recruiter)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('can raise a hiring request instead, filled in from the demand, which then links its job', async () => {
    const d = await demand();
    const r = await createHiringRequest(org, { demandId: String(d._id), budgetMax: 60_000 }, head);
    expect(r).toMatchObject({ title: 'React developer', status: 'draft' });
    expect(r!.justification).toMatch(/Unfilled resource demand/);
    await submitHiringRequest(org, String(r!._id), head);
    await decideHiringRequest(org, String(r!._id), 'approve', approver);
    const job = await openJobFromRequest(org, String(r!._id), recruiter);
    expect(String(job.demandId)).toBe(String(d._id));
    expect(String((await ResourceDemand.findById(d._id).lean())!.jobId)).toBe(String(job._id));
  });
});
