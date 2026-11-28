/**
 * Company-wide project designation templates: editable per workspace, copied into projects, and used to
 * suggest a designation when someone is invited (from their HR job title or department, then their level).
 */
import mongoose from 'mongoose';
import { ApiError } from '../../utils/ApiError';
import { ALL_PROJECT_PERMISSIONS } from '../../shared/constants/permissions';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { getHrSettings } from '../hrms/policy.service';
import { DesignationTemplate } from './designationTemplate.model';
import { ProjectDesignation } from './projectDesignation.model';
import { Project } from './project.model';
import { DEFAULT_PERMS } from './projectDesignation.service';

type Oid = mongoose.Types.ObjectId;
const RESERVED = ['project_lead', 'project_member'];
export const codeOf = (name: string) => name.toLowerCase().trim().replace(/\s+/g, '_');
const only = (perms: string[]) => [...new Set(perms)].filter((p) => ALL_PROJECT_PERMISSIONS.includes(p));
const without = (perms: string[], drop: string[]) => perms.filter((p) => !drop.includes(p));

/**
 * What a fresh workspace starts with. Everything here can be edited or removed.
 * The developer ladder goes by level (a "Software Engineer" may be Junior or Senior); functions go by job title.
 */
export function defaultTemplates() {
  const member = only(DEFAULT_PERMS);
  const memberNoAdmin = without(member, ['project.member.invitations_manage', 'issue.issue.delete', 'version.version.release', 'version.version.update', 'board.board.update']);
  const reader = only([
    'issue.issue.read', 'issue.issue.list', 'issue.issue.update', 'issue.comment.create', 'issue.comment.read', 'issue.comment.list',
    'issue.attachment.create', 'issue.attachment.read', 'issue.attachment.list', 'issue.estimate.submit', 'issue.estimate.view',
    'board.board.read', 'sprint.sprint.read', 'sprint.sprint.list', 'version.version.read', 'roadmap.roadmap.read',
    'test_management.suite.read', 'work_log.work_log.create', 'work_log.work_log.read',
  ]);
  return [
    { name: 'Dev Lead', description: 'Leads the delivery team: plans sprints, approves estimates, sees reports.', levels: ['Lead', 'Manager'], keywords: ['tech lead', 'dev lead', 'development lead', 'engineering manager'],
      permissions: only([...member, 'issue.issue.assign', 'issue.issue.close', 'issue.issue.reopen', 'issue.estimate.approve', 'sprint.sprint.create', 'sprint.sprint.update', 'sprint.sprint.start', 'sprint.sprint.close', 'report.report.read', 'report.report.list', 'work_log.work_log.read', 'timesheet.timesheet.read', 'project.risk.read', 'project.risk.manage', 'project.status_report.read', 'project.requirement.read']) },
    { name: 'Senior Developer', description: 'Builds and reviews; can assign and close work.', levels: ['Senior'], keywords: [],
      permissions: only([...memberNoAdmin, 'issue.issue.assign', 'issue.issue.close', 'issue.issue.reopen', 'report.report.read', 'report.report.list', 'work_log.work_log.read']) },
    { name: 'Developer', description: 'Builds features and fixes.', levels: ['Junior'], keywords: [], permissions: memberNoAdmin },
    { name: 'Intern', description: 'Works on assigned issues, comments and logs time.', levels: ['Intern'], keywords: ['intern', 'trainee'], permissions: reader },
    { name: 'Business Analyst', description: 'Writes requirements, keeps the roadmap and milestones.', levels: [], keywords: ['business analyst', 'functional analyst', 'ba'],
      permissions: only([...memberNoAdmin, 'roadmap.roadmap.update', 'milestone.milestone.create', 'milestone.milestone.update', 'report.report.read', 'report.report.list', 'project.status_report.read', 'project.requirement.read', 'project.requirement.manage']) },
    { name: 'QA Engineer', description: 'Tests, raises bugs, keeps test suites, closes and reopens issues.', levels: [], keywords: ['qa', 'qa analyst', 'quality', 'test', 'tester', 'test analyst'],
      permissions: only([...memberNoAdmin, 'test_management.suite.update', 'issue.issue.close', 'issue.issue.reopen', 'report.report.read']) },
    { name: 'Designer', description: 'Designs; works on issues and comments.', levels: [], keywords: ['designer', 'design', 'ux', 'ui'], permissions: memberNoAdmin },
    { name: 'DevOps Engineer', description: 'Releases versions and looks after environments.', levels: [], keywords: ['devops', 'sre', 'infrastructure', 'release'],
      permissions: only([...memberNoAdmin, 'version.version.release', 'version.version.update', 'setting.project_setting.read']) },
    { name: 'Support Engineer', description: 'Raises and follows up customer issues.', levels: [], keywords: ['support', 'helpdesk', 'service desk'],
      permissions: only(['issue.issue.create', ...reader]) },
  ].map((t) => ({ ...t, code: codeOf(t.name), addToNewProjects: true, active: true }));
}

/** A workspace gets the defaults once; after that, what is there is what the company kept. */
async function seedOnce(orgOid: Oid) {
  const marker = `designation-templates:${orgOid}`;
  const done = mongoose.connection.collection<{ _id: string; at: Date }>('appmigrations');
  if (await done.findOne({ _id: marker })) return;
  if (!(await DesignationTemplate.exists({ taskflowOrganizationId: orgOid }))) {
    await DesignationTemplate.insertMany(defaultTemplates().map((t) => ({ ...t, taskflowOrganizationId: orgOid })), { ordered: false }).catch(() => undefined);
  }
  await done.updateOne({ _id: marker }, { $set: { at: new Date() } }, { upsert: true });
}

export async function listTemplates(workspaceId: string | null | undefined, activeOnly = false) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  await seedOnce(orgOid);
  return DesignationTemplate.find({ taskflowOrganizationId: orgOid, ...(activeOnly ? { active: true } : {}) }).sort({ name: 1 }).lean();
}

const strings = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim()).filter(Boolean).slice(0, max);

export async function saveTemplate(workspaceId: string | null | undefined, input: Record<string, unknown>, id?: string) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  await seedOnce(orgOid);
  const data: Record<string, unknown> = {};
  if ('name' in input) {
    const name = String(input.name ?? '').trim().slice(0, 60);
    if (!name) throw new ApiError(400, 'Name is required');
    if (RESERVED.includes(codeOf(name))) throw new ApiError(400, 'Project Lead and Project Member are built into every project');
    data.name = name;
    data.code = codeOf(name);
  }
  if ('description' in input) data.description = String(input.description ?? '').slice(0, 300);
  if ('permissions' in input) {
    const perms = strings(input.permissions, 200);
    const bad = perms.filter((p) => !ALL_PROJECT_PERMISSIONS.includes(p));
    if (bad.length) throw new ApiError(400, `Not project permissions: ${bad.join(', ')}`);
    data.permissions = [...new Set(perms)];
  }
  if ('levels' in input) {
    const levels = strings(input.levels, 20);
    const known = (((await getHrSettings(String(orgOid))) as { levels?: string[] }).levels ?? []).map((l) => l.toLowerCase());
    const unknown = levels.filter((l) => !known.includes(l.toLowerCase()));
    if (unknown.length) throw new ApiError(400, `Unknown level(s): ${unknown.join(', ')}. Levels are set in HR settings.`);
    data.levels = levels;
  }
  if ('keywords' in input) data.keywords = strings(input.keywords, 30).map((k) => k.toLowerCase().slice(0, 40));
  for (const k of ['addToNewProjects', 'active'] as const) if (k in input) data[k] = Boolean(input[k]);
  if (data.code) {
    const clash = await DesignationTemplate.exists({ taskflowOrganizationId: orgOid, code: data.code, ...(id ? { _id: { $ne: id } } : {}) });
    if (clash) throw new ApiError(409, 'A template with this name already exists');
  }
  try {
    if (id) {
      const doc = await DesignationTemplate.findOneAndUpdate({ _id: id, taskflowOrganizationId: orgOid }, { $set: data }, { new: true, runValidators: true }).lean();
      if (!doc) throw new ApiError(404, 'Template not found');
      return doc;
    }
    if (!data.name) throw new ApiError(400, 'Name is required');
    return (await DesignationTemplate.create({ ...data, taskflowOrganizationId: orgOid })).toObject();
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw new ApiError(409, 'A template with this name already exists');
    throw e;
  }
}

/** Projects keep their copies; removing a template only stops it being offered. */
export async function deleteTemplate(workspaceId: string | null | undefined, id: string) {
  const orgOid = toOrgOid(requireWorkspaceId(workspaceId));
  const doc = await DesignationTemplate.findOneAndDelete({ _id: id, taskflowOrganizationId: orgOid }).lean();
  if (!doc) throw new ApiError(404, 'Template not found');
  return { deleted: true };
}

/** Refuse unknown template ids before anything is created. */
export async function assertTemplatesExist(workspaceId: string, templateIds?: string[]) {
  if (!templateIds?.length) return;
  const ids = [...new Set(templateIds)];
  if (ids.some((t) => !mongoose.isValidObjectId(t))) throw new ApiError(400, 'Unknown designation template');
  const found = await DesignationTemplate.countDocuments({ _id: { $in: ids }, taskflowOrganizationId: toOrgOid(workspaceId), active: true });
  if (found !== ids.length) throw new ApiError(400, 'Unknown designation template');
}

/**
 * Copy templates into a project: the chosen ones, or (when none are named) the ones marked for new projects.
 * Designations the project already has (same name) are left as they are.
 */
export async function addTemplatesToProject(projectId: string, templateIds?: string[]) {
  const project = await Project.findById(projectId).select('taskflowOrganizationId').lean();
  if (!project?.taskflowOrganizationId) return { added: [] as string[] };
  const orgOid = project.taskflowOrganizationId as Oid;
  await seedOnce(orgOid);
  const filter: Record<string, unknown> = { taskflowOrganizationId: orgOid, active: true };
  if (templateIds) {
    const ids = templateIds.filter((t) => mongoose.isValidObjectId(t));
    if (ids.length !== templateIds.length) throw new ApiError(400, 'Unknown designation template');
    filter._id = { $in: ids };
  } else filter.addToNewProjects = true;
  const templates = await DesignationTemplate.find(filter).lean();
  if (templateIds && templates.length !== new Set(templateIds).size) throw new ApiError(400, 'Unknown designation template');
  const have = new Set((await ProjectDesignation.find({ projectId }).select('code').lean()).map((d) => d.code));
  const added: string[] = [];
  for (const t of templates) {
    if (have.has(t.code) || RESERVED.includes(t.code)) continue;
    await ProjectDesignation.create({ name: t.name, code: t.code, projectId, permissions: only(t.permissions), isSystem: false, templateId: t._id });
    added.push(t.name);
  }
  return { added };
}

const wordMatch = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'i').test(text);

/** Which template fits an employee: the longest keyword found in their job title or department, else their level. */
export function pickTemplate<T extends { keywords?: string[]; levels?: string[] }>(
  templates: T[],
  employee: { designation?: string | null; department?: string | null; level?: string | null }
): { template: T; reason: string } | null {
  const text = [employee.designation, employee.department].filter(Boolean).join(' · ');
  let best: { template: T; keyword: string } | null = null;
  if (text) {
    for (const t of templates) {
      for (const k of t.keywords ?? []) {
        if (wordMatch(text, k) && (!best || k.length > best.keyword.length)) best = { template: t, keyword: k };
      }
    }
  }
  if (best) return { template: best.template, reason: `job title “${text}”` };
  const level = (employee.level ?? '').toLowerCase();
  if (level) {
    const byLevel = templates.find((t) => (t.levels ?? []).some((l) => l.toLowerCase() === level));
    if (byLevel) return { template: byLevel, reason: `level “${employee.level}”` };
  }
  return null;
}

export type DesignationSuggestion = {
  templateId: string;
  name: string;
  reason: string;
  /** The project's designation to use; null when the project does not have this one yet. */
  designationId: string | null;
};

/** A designation for someone joining a project, from their HR record. Null when nothing fits. */
export async function suggestDesignation(projectId: string, userId: string): Promise<DesignationSuggestion | null> {
  const project = await Project.findById(projectId).select('taskflowOrganizationId').lean();
  if (!project?.taskflowOrganizationId || !mongoose.isValidObjectId(userId)) return null;
  const orgOid = project.taskflowOrganizationId as Oid;
  const employee = await HrmsEmployee.findOne({ taskflowOrganizationId: orgOid, userId, status: { $ne: 'terminated' } })
    .select('designation department level')
    .lean();
  if (!employee) return null;
  await seedOnce(orgOid);
  const picked = pickTemplate(await DesignationTemplate.find({ taskflowOrganizationId: orgOid, active: true }).sort({ name: 1 }).lean(), employee);
  if (!picked) return null;
  const t = picked.template;
  const inProject = await ProjectDesignation.findOne({ projectId, $or: [{ templateId: t._id }, { code: t.code }] }).select('_id').lean();
  return { templateId: String(t._id), name: t.name, reason: picked.reason, designationId: inProject ? String(inProject._id) : null };
}
