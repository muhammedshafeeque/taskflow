/**
 * Internal teams against an in-memory Mongo: many-to-many people/teams/projects, validation,
 * and the team and project filters on the engagement report.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { User } from '../auth/user.model';
import { Project } from '../projects/project.model';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { getEngagement } from './engagement.service';
import { createTeam, deleteTeam, listTeams, updateTeam } from './teams.service';

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const ids: Record<string, string> = {};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongo.getUri());
  const [ana, ben, cy, outsider] = await User.create([
    { email: 'ana@example.com', name: 'Ana', mustChangePassword: false },
    { email: 'ben@example.com', name: 'Ben', mustChangePassword: false },
    { email: 'cy@example.com', name: 'Cy', mustChangePassword: false },
    { email: 'out@example.com', name: 'Outsider', mustChangePassword: false },
  ]);
  const org = await Organization.create({ name: 'Studio', slug: 'studio', createdBy: ana._id });
  const other = await Organization.create({ name: 'Other', slug: 'other', createdBy: outsider._id });
  await OrganizationMember.create([
    { organization: org._id, user: ana._id, role: 'org_admin', status: 'active' },
    { organization: org._id, user: ben._id, role: 'org_member', status: 'active' },
    { organization: org._id, user: cy._id, role: 'org_member', status: 'active' },
  ]);
  const [app, web] = await Project.create([
    { name: 'App', key: 'APP', lead: ana._id, taskflowOrganizationId: org._id },
    { name: 'Web', key: 'WEB', lead: ana._id, taskflowOrganizationId: org._id },
  ]);
  const foreign = await Project.create({ name: 'Foreign', key: 'FOR', lead: outsider._id, taskflowOrganizationId: other._id });
  Object.assign(ids, {
    org: String(org._id),
    ana: String(ana._id),
    ben: String(ben._id),
    cy: String(cy._id),
    outsider: String(outsider._id),
    app: String(app._id),
    web: String(web._id),
    foreign: String(foreign._id),
  });
});

afterAll(async () => {
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('internal teams', () => {
  let mobile: string;
  let platform: string;

  it('creates teams where people and projects overlap', async () => {
    const a = await createTeam(ids.org, ids.ana, { name: 'Mobile', memberIds: [ids.ben], leadId: ids.ana, projectIds: [ids.app] });
    const b = await createTeam(ids.org, ids.ana, { name: 'Platform', memberIds: [ids.ben, ids.cy], projectIds: [ids.app, ids.web] });
    mobile = a.id;
    platform = b.id;
    // The lead is added as a member.
    expect(a.members.map((m) => m.id).sort()).toEqual([ids.ana, ids.ben].sort());
    expect(b.projects.map((p) => p.key)).toEqual(['APP', 'WEB']);
    const onApp = await listTeams(ids.org, { projectId: ids.app });
    expect(onApp.map((t) => t.name)).toEqual(['Mobile', 'Platform']);
    const bens = await listTeams(ids.org, { userId: ids.ben });
    expect(bens).toHaveLength(2);
  });

  it('rejects duplicate names, outsiders and foreign projects', async () => {
    await expect(createTeam(ids.org, ids.ana, { name: 'mobile' })).rejects.toMatchObject({ statusCode: 409 });
    await expect(createTeam(ids.org, ids.ana, { name: 'X', memberIds: [ids.outsider] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(createTeam(ids.org, ids.ana, { name: 'Y', projectIds: [ids.foreign] })).rejects.toMatchObject({ statusCode: 400 });
    await expect(updateTeam(ids.org, ids.ana, platform, { name: 'Mobile' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('filters engagement by team and keeps project team members visible', async () => {
    const all = await getEngagement(ids.org, {});
    expect(all.teams.map((t) => t.name)).toEqual(['Mobile', 'Platform']);
    expect(all.people.find((p) => p.userId === ids.ben)?.teams.map((t) => t.name)).toEqual(['Mobile', 'Platform']);

    const mobileOnly = await getEngagement(ids.org, { teamIds: [mobile] });
    expect(mobileOnly.people.map((p) => p.name).sort()).toEqual(['Ana', 'Ben']);

    const both = await getEngagement(ids.org, { teamIds: [mobile, platform] });
    expect(both.people.map((p) => p.name).sort()).toEqual(['Ana', 'Ben', 'Cy']);

    // No one has work on WEB, but Platform is assigned to it, so its members show.
    const web = await getEngagement(ids.org, { projectId: ids.web });
    expect(web.people.map((p) => p.name).sort()).toEqual(['Ben', 'Cy']);
    const webMobile = await getEngagement(ids.org, { projectId: ids.web, teamIds: [mobile] });
    expect(webMobile.people.map((p) => p.name)).toEqual(['Ben']);
  });

  it('updates membership and deletes', async () => {
    const t = await updateTeam(ids.org, ids.ana, mobile, { memberIds: [ids.cy], leadId: null, projectIds: [ids.web] });
    expect(t.members.map((m) => m.name)).toEqual(['Cy']);
    expect(t.lead).toBeNull();
    await deleteTeam(ids.org, ids.ana, mobile);
    expect((await listTeams(ids.org)).map((x) => x.name)).toEqual(['Platform']);
  });
});
