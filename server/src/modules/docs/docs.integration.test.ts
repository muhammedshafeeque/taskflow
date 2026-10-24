/**
 * Docs (knowledge spaces) against an in-memory Mongo: space access by audience and role,
 * page tree, drafts, edit conflicts, versions, trash, issue/project links and search.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Organization } from '../organizations/organization.model';
import { OrganizationMember } from '../organizations/organizationMember.model';
import { User } from '../auth/user.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { Issue } from '../issues/issue.model';
import { flushAuditLogs } from '../auditLogs/logAudit';
import { DocsActor } from './docs.access';
import { createSpace, listSpaces, updateSpace } from './docSpaces.service';
import {
  createPage,
  getPage,
  links,
  listTrash,
  listVersions,
  movePage,
  restorePage,
  restoreVersion,
  search,
  spaceTree,
  trashPage,
  updatePage,
  addComment,
} from './docPages.service';

jest.setTimeout(120_000);

let mongo: MongoMemoryServer;
const ids: Record<string, string> = {};
const CREATE = 'taskflow.docs.space.create';

const as = (user: string, perms: string[] = []) => new DocsActor(ids[user], ids.org, perms);

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongo.getUri());
  const [ana, ben, cy] = await User.create([
    { email: 'ana@example.com', name: 'Ana', mustChangePassword: false },
    { email: 'ben@example.com', name: 'Ben', mustChangePassword: false },
    { email: 'cy@example.com', name: 'Cy', mustChangePassword: false },
  ]);
  const org = await Organization.create({ name: 'Studio', slug: 'studio', createdBy: ana._id });
  await OrganizationMember.create([
    { organization: org._id, user: ana._id, role: 'org_admin', status: 'active' },
    { organization: org._id, user: ben._id, role: 'org_member', status: 'active' },
    { organization: org._id, user: cy._id, role: 'org_member', status: 'active' },
  ]);
  const [app, web] = await Project.create([
    { name: 'App', key: 'APP', lead: ana._id, taskflowOrganizationId: org._id },
    { name: 'Web', key: 'WEB', lead: ana._id, taskflowOrganizationId: org._id },
  ]);
  await ProjectMember.create([
    { project: app._id, user: ana._id },
    { project: app._id, user: ben._id },
    { project: web._id, user: cy._id },
  ]);
  const [i1, i2] = await Issue.create([
    { title: 'Login screen', key: 'APP-1', project: app._id, reporter: ana._id },
    { title: 'Landing page', key: 'WEB-7', project: web._id, reporter: cy._id },
  ]);
  Object.assign(ids, {
    org: String(org._id),
    ana: String(ana._id),
    ben: String(ben._id),
    cy: String(cy._id),
    app: String(app._id),
    web: String(web._id),
    i1: String(i1._id),
    i2: String(i2._id),
  });
});

afterAll(async () => {
  await flushAuditLogs();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('docs', () => {
  let eng: string;
  let home: string;
  let spec: string;
  let child: string;

  it('needs the create permission and gives the creator admin with a home page', async () => {
    await expect(createSpace(as('ben'), { key: 'ENG', name: 'Engineering' })).rejects.toMatchObject({ statusCode: 403 });
    const space = await createSpace(as('ana', [CREATE]), { key: 'eng', name: 'Engineering', projectIds: [ids.app] });
    eng = space.id;
    home = space.homePageId!;
    expect(space.key).toBe('ENG');
    expect(space.audience).toBe('project');
    expect(space.myRole).toBe('admin');
    await expect(createSpace(as('ana', [CREATE]), { key: 'ENG', name: 'Again' })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('shows project spaces only to project members', async () => {
    expect((await listSpaces(as('ben'))).map((s) => s.key)).toEqual(['ENG']);
    expect(await listSpaces(as('cy'))).toEqual([]);
    expect((await listSpaces(as('cy', ['taskflow.docs.admin']))).map((s) => s.key)).toEqual(['ENG']);
    await expect(getPage(as('cy'), home)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('builds a page tree and keeps drafts private', async () => {
    const a = await createPage(as('ben'), { spaceId: eng, title: 'Spec', content: '<p>Covers APP-1 and WEB-7.</p>', issueIds: [ids.i1] });
    spec = a.id;
    // Ben is on APP only, so WEB-7 is shown by key alone.
    expect(a.issues.map((i) => i.key)).toEqual(['APP-1']);
    expect(a.mentionedIssues).toEqual([expect.objectContaining({ key: 'WEB-7', hidden: true })]);
    const b = await createPage(as('ben'), { spaceId: eng, parentId: spec, title: 'API notes' });
    child = b.id;
    await createPage(as('ben'), { spaceId: eng, title: 'Scratch', status: 'draft' });
    const bensTree = await spaceTree(as('ben'), eng);
    expect(bensTree.map((p) => p.title).sort()).toEqual(['API notes', 'Engineering home', 'Scratch', 'Spec']);
    const anasTree = await spaceTree(as('ana'), eng);
    expect(anasTree.map((p) => p.title)).not.toContain('Scratch');
    expect(anasTree.find((p) => p.title === 'API notes')?.parentId).toBe(spec);
  });

  it('rejects stale saves and keeps versions', async () => {
    const v1 = await getPage(as('ana'), spec);
    await updatePage(as('ana'), spec, { content: '<p>Second</p>', baseVersion: v1.version });
    await expect(updatePage(as('ben'), spec, { content: '<p>Stale</p>', baseVersion: v1.version })).rejects.toMatchObject({ statusCode: 409 });
    const versions = await listVersions(as('ben'), spec);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    const restored = await restoreVersion(as('ben'), spec, 1);
    expect(restored.version).toBe(3);
    expect(restored.content).toContain('APP-1');
  });

  it('lets viewers read but not edit, and admins lock pages', async () => {
    await updateSpace(as('ana'), eng, { audienceRole: 'viewer' });
    await expect(updatePage(as('ben'), spec, { title: 'Nope' })).rejects.toMatchObject({ statusCode: 403 });
    await addComment(as('ben'), spec, { body: '<p>Looks good</p>' });
    await updateSpace(as('ana'), eng, { audienceRole: 'editor' });
    await updatePage(as('ana'), spec, { locked: true });
    await expect(updatePage(as('ben'), spec, { title: 'Nope' })).rejects.toMatchObject({ statusCode: 403 });
    await updatePage(as('ana'), spec, { locked: false });
  });

  it('moves pages without cycles', async () => {
    await expect(movePage(as('ana'), spec, { parentId: child })).rejects.toMatchObject({ statusCode: 400 });
    await movePage(as('ana'), child, { parentId: null, index: 0 });
    const tree = await spaceTree(as('ana'), eng);
    const roots = tree.filter((p) => !p.parentId).sort((a, b) => a.position - b.position);
    expect(roots[0].title).toBe('API notes');
    await movePage(as('ana'), child, { parentId: spec });
  });

  it('links pages to issues and projects', async () => {
    await updatePage(as('ana'), child, { projectIds: [ids.app] });
    const byIssue = await links(as('ana'), { issueId: ids.i1 });
    expect(byIssue.pages).toEqual([expect.objectContaining({ title: 'Spec', linkType: 'linked' })]);
    const byProject = await links(as('ana'), { projectId: ids.app });
    expect(byProject.pages.map((p) => p.title)).toEqual(['API notes']);
    expect(byProject.spaces.map((s) => s.key)).toEqual(['ENG']);
    await expect(updatePage(as('ana'), spec, { issueIds: [new mongoose.Types.ObjectId().toString()] })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('searches visible pages', async () => {
    const found = await search(as('ben'), { q: 'app-1' });
    expect(found.pages.map((p) => p.title)).toContain('Spec');
    expect((await search(as('cy'), { q: 'spec' })).pages).toEqual([]);
  });

  it('trashes and restores a subtree, but not the home page', async () => {
    await expect(trashPage(as('ana'), home)).rejects.toMatchObject({ statusCode: 400 });
    expect((await trashPage(as('ana'), spec)).trashed).toBe(2);
    await expect(getPage(as('ana'), child)).rejects.toMatchObject({ statusCode: 404 });
    const trash = await listTrash(as('ana'), eng);
    expect(trash).toEqual([expect.objectContaining({ title: 'Spec', childCount: 1 })]);
    await restorePage(as('ana'), spec);
    expect((await getPage(as('ana'), child)).parentId).toBe(spec);
  });
});
