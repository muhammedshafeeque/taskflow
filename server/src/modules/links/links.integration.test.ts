/**
 * Record graph against an in-memory Mongo: field links in both directions,
 * explicit links, per-type permissions, project membership and workspace isolation.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Organization } from '../organizations/organization.model';
import { User } from '../auth/user.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { Issue } from '../issues/issue.model';
import { CrmDeal } from '../crm/models/crmDeal.model';
import { CrmQuote } from '../crm/models/crmQuote.model';
import { ServiceTicket } from '../service-desk/models/serviceTicket.model';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { GraphAccess, createLink, deleteLink, getGraph, searchRecords } from './links.service';

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const ids: Record<string, string> = {};
const CRM = ['taskflow.crm.deal.read', 'taskflow.crm.quote.read'];
const SERVICE = ['taskflow.service.ticket.read'];

const as = (user: string, perms: string[] = [], org = ids.org) =>
  new GraphAccess(new mongoose.Types.ObjectId(org), { userId: ids[user], permissions: perms });
const titles = (g: Awaited<ReturnType<typeof getGraph>>) => g.edges.map((e) => `${e.record.type}:${e.record.title}`).sort();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongo.getUri());
  const [ana, ben] = await User.create([
    { email: 'ana@example.com', name: 'Ana', mustChangePassword: false },
    { email: 'ben@example.com', name: 'Ben', mustChangePassword: false },
  ]);
  const [org, other] = await Organization.create([
    { name: 'Studio', slug: 'studio', createdBy: ana._id },
    { name: 'Other', slug: 'other', createdBy: ana._id },
  ]);
  const [app, web] = await Project.create([
    { name: 'App', key: 'APP', lead: ana._id, taskflowOrganizationId: org._id },
    { name: 'Web', key: 'WEB', lead: ana._id, taskflowOrganizationId: org._id },
  ]);
  await ProjectMember.create([
    { project: app._id, user: ana._id },
    { project: web._id, user: ana._id },
    { project: app._id, user: ben._id },
  ]);
  const [bug, webIssue] = await Issue.create([
    { title: 'Checkout crash', key: 'APP-1', project: app._id, reporter: ana._id },
    { title: 'Hero banner', key: 'WEB-1', project: web._id, reporter: ana._id },
  ]);
  const deal = await CrmDeal.create({
    taskflowOrganizationId: org._id,
    title: 'App rebuild',
    value: 50000,
    pipelineId: new mongoose.Types.ObjectId(),
    stageId: new mongoose.Types.ObjectId(),
    projectId: app._id,
  });
  const quote = await CrmQuote.create({
    taskflowOrganizationId: org._id,
    title: 'App rebuild quote',
    dealId: deal._id,
    createdBy: ana._id,
  });
  const ticket = await ServiceTicket.create({
    taskflowOrganizationId: org._id,
    subject: 'Checkout fails',
    projectId: app._id,
    linkedIssueId: bug._id,
  });
  const foreignDeal = await CrmDeal.create({
    taskflowOrganizationId: other._id,
    title: 'Other workspace deal',
    pipelineId: new mongoose.Types.ObjectId(),
    stageId: new mongoose.Types.ObjectId(),
  });
  Object.assign(ids, {
    org: String(org._id),
    other: String(other._id),
    ana: String(ana._id),
    ben: String(ben._id),
    app: String(app._id),
    web: String(web._id),
    bug: String(bug._id),
    webIssue: String(webIssue._id),
    deal: String(deal._id),
    quote: String(quote._id),
    ticket: String(ticket._id),
    foreignDeal: String(foreignDeal._id),
  });
});

afterAll(async () => {
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('record graph', () => {
  it('shows field links both ways', async () => {
    const quote = await getGraph(as('ana', CRM), { type: 'quote', id: ids.quote });
    expect(quote.edges).toEqual([
      expect.objectContaining({ source: 'field', relation: 'Deal', direction: 'out', record: expect.objectContaining({ title: 'App rebuild' }) }),
    ]);

    const project = await getGraph(as('ana', [...CRM, ...SERVICE]), { type: 'project', id: ids.app });
    expect(titles(project)).toEqual(['deal:App rebuild', 'ticket:Checkout fails']);
    expect(project.edges.every((e) => e.direction === 'in')).toBe(true);

    const deal = await getGraph(as('ana', CRM), { type: 'deal', id: ids.deal });
    expect(titles(deal)).toEqual(['project:App', 'quote:App rebuild quote']);
  });

  it('hides records the viewer has no permission for, and counts them', async () => {
    const issue = await getGraph(as('ana'), { type: 'issue', id: ids.bug });
    expect(titles(issue)).toEqual(['project:App']);
    // Ana has no service permission, so tickets pointing here are not even looked up.
    expect(issue.hidden).toBe(0);
    await expect(getGraph(as('ana'), { type: 'deal', id: ids.deal })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('adds explicit links, rejects duplicates and self-links', async () => {
    const edge = await createLink(as('ana', CRM), {
      from: { type: 'issue', id: ids.webIssue },
      to: { type: 'deal', id: ids.deal },
      relation: 'delivers',
    });
    expect(edge).toMatchObject({ source: 'link', relation: 'delivers', record: { type: 'deal' } });

    // Same link seen from the other side is a duplicate.
    await expect(
      createLink(as('ana', CRM), { from: { type: 'deal', id: ids.deal }, to: { type: 'issue', id: ids.webIssue }, relation: 'delivers' })
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      createLink(as('ana', CRM), { from: { type: 'deal', id: ids.deal }, to: { type: 'deal', id: ids.deal } })
    ).rejects.toMatchObject({ statusCode: 400 });

    const deal = await getGraph(as('ana', CRM), { type: 'deal', id: ids.deal });
    expect(deal.edges).toContainEqual(
      expect.objectContaining({ source: 'link', relation: 'delivers', direction: 'in', record: expect.objectContaining({ title: 'WEB-1 · Hero banner' }) })
    );
  });

  it('respects project membership', async () => {
    // Ben is on APP only: WEB-1 is hidden from him and he cannot link to it.
    const deal = await getGraph(as('ben', CRM), { type: 'deal', id: ids.deal });
    expect(titles(deal)).not.toContain('issue:WEB-1 · Hero banner');
    expect(deal.hidden).toBe(1);
    await expect(
      createLink(as('ben', CRM), { from: { type: 'deal', id: ids.deal }, to: { type: 'issue', id: ids.webIssue } })
    ).rejects.toMatchObject({ statusCode: 404 });

    const link = deal.edges.length ? (await getGraph(as('ana', CRM), { type: 'deal', id: ids.deal })).edges.find((e) => e.source === 'link') : undefined;
    await expect(deleteLink(as('ben', CRM), link!.linkId!)).rejects.toMatchObject({ statusCode: 404 });

    expect((await searchRecords(as('ben'), 'issue', '')).map((r) => r.title)).toEqual(['APP-1 · Checkout crash']);
  });

  it('never crosses workspaces', async () => {
    await expect(
      createLink(as('ana', CRM), { from: { type: 'deal', id: ids.deal }, to: { type: 'deal', id: ids.foreignDeal } })
    ).rejects.toMatchObject({ statusCode: 404 });
    expect((await searchRecords(as('ana', CRM), 'deal', 'deal')).map((r) => r.title)).toEqual([]);
  });

  it('skips links to deleted records instead of counting them hidden', async () => {
    const gone = await CrmQuote.create({ taskflowOrganizationId: ids.org, title: 'Scrapped quote', createdBy: ids.ana });
    await createLink(as('ana', CRM), { from: { type: 'project', id: ids.web }, to: { type: 'quote', id: String(gone._id) } });
    await CrmQuote.deleteOne({ _id: gone._id });
    const web = await getGraph(as('ana', CRM), { type: 'project', id: ids.web });
    expect(titles(web)).not.toContain('quote:Scrapped quote');
    expect(web.hidden).toBe(0);
  });

  it('deletes a link when both ends are visible', async () => {
    const before = await getGraph(as('ana', CRM), { type: 'deal', id: ids.deal });
    const link = before.edges.find((e) => e.source === 'link')!;
    await deleteLink(as('ana', CRM), link.linkId!);
    const after = await getGraph(as('ana', CRM), { type: 'deal', id: ids.deal });
    expect(after.edges.some((e) => e.source === 'link')).toBe(false);
  });
});
