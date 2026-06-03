import mongoose from 'mongoose';
import { Project } from './project.model';
import {
  isPromoteToEnvironment,
} from './environmentHierarchy';
import { ProjectMember } from './projectMember.model';
import { Issue } from '../issues/issue.model';
import * as issueNotification from '../issues/issueNotification.service';
import { User } from '../auth/user.model';
import { ApiError } from '../../utils/ApiError';
import * as releaseNotificationService from './releaseNotification.service';
import type { IProjectReleaseRule } from './project.model';
import * as projectTemplatesService from '../projectTemplates/projectTemplates.service';
import * as projectInvitationsService from './projectInvitations.service';
import * as projectDesignationService from './projectDesignation.service';
import type { CreateProjectBody, UpdateProjectBody } from './projects.validation';
import { userHasPermission, mapLegacyProjectOrGlobalPermissions } from '../../shared/constants/legacyPermissionMap';
import { PROJECT_PERMISSIONS } from '../../shared/constants/permissions';
import { hasProjectFullAccess } from '../../middleware/requireProjectPermission';

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function create(
  input: CreateProjectBody,
  creatorUserId: string,
  taskflowOrganizationId: string
): Promise<mongoose.Document> {
  if (!mongoose.Types.ObjectId.isValid(taskflowOrganizationId)) {
    throw new ApiError(400, 'Invalid workspace id');
  }
  const key = input.key.toUpperCase();
  const existing = await Project.findOne({ key, taskflowOrganizationId }).lean();
  if (existing) {
    throw new ApiError(409, `Project with key "${key}" already exists in this workspace`);
  }
  const leadUserId = String(input.lead).trim();
  if (!mongoose.Types.ObjectId.isValid(leadUserId)) {
    throw new ApiError(400, 'Invalid lead user id');
  }
  const leadUserExists = await User.exists({ _id: leadUserId });
  if (!leadUserExists) {
    throw new ApiError(400, 'Lead user not found');
  }

  const config = input.templateId
    ? await projectTemplatesService.getById(input.templateId, taskflowOrganizationId)
    : null;
  const tid = input.templateId ? String(input.templateId).trim() : '';
  if (tid && tid !== 'default' && !config) {
    throw new ApiError(404, 'Template not found in this workspace');
  }
  const template = config as { statuses?: unknown[]; issueTypes?: unknown[]; priorities?: unknown[] } | null;
  const defaultConfig = projectTemplatesService.getDefaultConfig();
  const statuses = (template?.statuses?.length ? template.statuses : defaultConfig.statuses) as typeof defaultConfig.statuses;
  const issueTypes = (template?.issueTypes?.length ? template.issueTypes : defaultConfig.issueTypes) as typeof defaultConfig.issueTypes;
  const priorities = (template?.priorities?.length ? template.priorities : defaultConfig.priorities) as typeof defaultConfig.priorities;

  const project = await Project.create({
    name: input.name,
    key,
    description: input.description ?? '',
    lead: leadUserId,
    taskflowOrganizationId,
    statuses,
    issueTypes,
    priorities,
  });
  const projectId = project._id.toString();

  // Create default designations
  await projectDesignationService.createDefaultDesignations(projectId);

  // Selected lead gets every project permission (including settings:manage, project:delete, etc.)
  await projectInvitationsService.ensureUserHasFullProjectAccess(projectId, leadUserId);

  // Creator may differ from lead; they still need membership to access the project they created.
  if (creatorUserId && creatorUserId !== leadUserId) {
    await projectInvitationsService.ensureUserHasFullProjectAccess(projectId, creatorUserId);
  }

  // Automatically add all users who have global project CRUD permissions as default members
  const globalAccessUsers = await User.find({ enabled: true }).select('_id permissions').lean();
  const globalUserIds = globalAccessUsers
    .filter((u) => hasProjectFullAccess(u.permissions || []))
    .map((u) => String(u._id));

  for (const uid of globalUserIds) {
    if (uid !== leadUserId && uid !== creatorUserId) {
      await projectInvitationsService.ensureUserIsDefaultProjectMember(projectId, uid);
    }
  }

  return project;
}

export async function findAll(
  opts: PaginationOptions = { page: 1, limit: 20 }
): Promise<PaginatedResult<unknown>> {
  const { page, limit } = opts;
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    Project.find().populate('lead', 'name email').lean().skip(skip).limit(limit),
    Project.countDocuments(),
  ]);
  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function findAllForUser(
  userId: string,
  _permissions: string[],
  activeTaskflowOrganizationId: string,
  opts: PaginationOptions = { page: 1, limit: 20 }
): Promise<PaginatedResult<unknown>> {
  // Only show projects the user is a member of (accepted invitation or added as member).
  const userObjectId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
  const projectIds = await ProjectMember.find({ user: userObjectId }).distinct('project');
  const orgFilter = {
    _id: { $in: projectIds },
    taskflowOrganizationId: activeTaskflowOrganizationId,
  };
  const skip = (opts.page - 1) * opts.limit;
  const [data, total] = await Promise.all([
    Project.find(orgFilter)
      .populate('lead', 'name email')
      .lean()
      .skip(skip)
      .limit(opts.limit),
    Project.countDocuments(orgFilter),
  ]);

  // Per-project permissions so the UI can show/hide Edit and Delete.
  const memberships = await ProjectMember.find({ user: userObjectId, project: { $in: projectIds } })
    .populate('role', 'permissions')
    .lean();
  const permissionsByProject = new Map<string, string[]>();
  for (const m of memberships) {
    const pid = (m.project as mongoose.Types.ObjectId).toString();
    const role = m.role as { permissions?: string[] } | null;
    const snap = Array.isArray(m.permissions) && m.permissions.length > 0
      ? mapLegacyProjectOrGlobalPermissions(m.permissions)
      : mapLegacyProjectOrGlobalPermissions(Array.isArray(role?.permissions) ? role.permissions : []);
    permissionsByProject.set(pid, snap);
  }

  const dataWithPerms = (data as Record<string, unknown>[]).map((p) => {
    const pid = (p._id as mongoose.Types.ObjectId).toString();
    const perms = permissionsByProject.get(pid) ?? [];
    const isGlobalAdmin = hasProjectFullAccess(_permissions);
    return {
      ...p,
      canEdit: isGlobalAdmin || userHasPermission(perms, PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE),
      canDelete: isGlobalAdmin || userHasPermission(perms, PROJECT_PERMISSIONS.SCOPE.DELETE),
    };
  });

  return {
    data: dataWithPerms,
    total,
    page: opts.page,
    limit: opts.limit,
    totalPages: Math.ceil(total / opts.limit) || 1,
  };
}

export async function findById(id: string, activeTaskflowOrganizationId: string): Promise<unknown | null> {
  const project = await Project.findOne({
    _id: id,
    taskflowOrganizationId: activeTaskflowOrganizationId,
  })
    .populate('lead', 'name email')
    .lean();
  if (!project) return null;
  const out = withProjectDefaults(project as Record<string, unknown>);
  const versions = out.versions as Array<{ id: string }> | undefined;
  if (versions?.length) {
    const counts = await Promise.all(
      versions.map((v) => Issue.countDocuments({ project: id, fixVersion: v.id }))
    );
    (out as Record<string, unknown>).versions = versions.map((v, i) => ({ ...v, issueCount: counts[i] }));
  }
  return out;
}

function withProjectDefaults(p: Record<string, unknown>): Record<string, unknown> {
  if (!p.statuses || (Array.isArray(p.statuses) && p.statuses.length === 0)) {
    p.statuses = [
      { id: 'backlog', name: 'Backlog', order: 0, isClosed: false },
      { id: 'todo', name: 'Todo', order: 1, isClosed: false },
      { id: 'inprogress', name: 'In Progress', order: 2, isClosed: false },
      { id: 'done', name: 'Done', order: 3, isClosed: true },
    ];
  } else if (Array.isArray(p.statuses)) {
    p.statuses = p.statuses.map((raw, idx) => {
      const status = raw as { id?: string; name?: string; order?: number; isClosed?: boolean };
      const inferredClosed = ['done', 'closed', 'resolved', 'completed'].includes(
        String(status.name ?? '').trim().toLowerCase()
      );
      return {
        ...status,
        order: typeof status.order === 'number' ? status.order : idx,
        isClosed: status.isClosed ?? inferredClosed,
      };
    });
  }
  if (!p.issueTypes || (Array.isArray(p.issueTypes) && p.issueTypes.length === 0)) {
    p.issueTypes = [
      { id: 'task', name: 'Task', order: 0 },
      { id: 'bug', name: 'Bug', order: 1 },
      { id: 'story', name: 'Story', order: 2 },
      { id: 'epic', name: 'Epic', order: 3 },
    ];
  }
  if (!p.priorities || (Array.isArray(p.priorities) && p.priorities.length === 0)) {
    p.priorities = [
      { id: 'lowest', name: 'Lowest', order: 0 },
      { id: 'low', name: 'Low', order: 1 },
      { id: 'medium', name: 'Medium', order: 2 },
      { id: 'high', name: 'High', order: 3 },
      { id: 'highest', name: 'Highest', order: 4 },
    ];
  }
  if (!p.customFields) p.customFields = [];
  if (!p.versions) p.versions = [];
  if (!p.environments) p.environments = [];
  if (!p.releaseRules) p.releaseRules = [];
  return p;
}

export async function saveAsTemplate(
  projectId: string,
  input: { name: string; description?: string },
  activeTaskflowOrganizationId: string
): Promise<unknown | null> {
  const project = await Project.findOne({
    _id: projectId,
    taskflowOrganizationId: activeTaskflowOrganizationId,
  }).lean();
  if (!project) return null;
  const p = withProjectDefaults(project as Record<string, unknown>) as {
    statuses?: unknown[];
    issueTypes?: unknown[];
    priorities?: unknown[];
  };
  return projectTemplatesService.createTemplateRecord({
    taskflowOrganizationId: activeTaskflowOrganizationId,
    name: input.name.trim(),
    description: (input.description ?? '').trim(),
    statuses: (p.statuses ?? []) as unknown[],
    issueTypes: (p.issueTypes ?? []) as unknown[],
    priorities: (p.priorities ?? []) as unknown[],
  });
}

export async function update(
  id: string,
  input: UpdateProjectBody,
  activeTaskflowOrganizationId: string
): Promise<unknown | null> {
  let previousLeadId: string | null = null;
  if (input.lead !== undefined) {
    const existingProj = await Project.findOne({ _id: id, taskflowOrganizationId: activeTaskflowOrganizationId })
      .select('lead')
      .lean();
    if (existingProj && (existingProj as { lead?: unknown }).lead != null) {
      previousLeadId = String((existingProj as { lead: unknown }).lead);
    }
  }

  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.lead !== undefined) {
    const nextLead = String(input.lead).trim();
    if (!mongoose.Types.ObjectId.isValid(nextLead)) {
      throw new ApiError(400, 'Invalid lead user id');
    }
    const leadUserExists = await User.exists({ _id: nextLead });
    if (!leadUserExists) {
      throw new ApiError(400, 'Lead user not found');
    }
    updateData.lead = nextLead;
  }
  if (input.key !== undefined) {
    const key = input.key.toUpperCase();
    const existing = await Project.findOne({
      key,
      taskflowOrganizationId: activeTaskflowOrganizationId,
      _id: { $ne: id },
    }).lean();
    if (existing) throw new ApiError(409, `Project with key "${key}" already exists in this workspace`);
    updateData.key = key;
  }
  if (input.templateId !== undefined && String(input.templateId).trim() !== '') {
    const config = await projectTemplatesService.getById(
      String(input.templateId).trim(),
      activeTaskflowOrganizationId
    );
    if (!config) throw new ApiError(404, 'Template not found in this workspace');
    const template = config as { statuses?: unknown[]; issueTypes?: unknown[]; priorities?: unknown[] };
    const defaultConfig = projectTemplatesService.getDefaultConfig();
    updateData.statuses = (template.statuses?.length ? template.statuses : defaultConfig.statuses) as unknown[];
    updateData.issueTypes = (template.issueTypes?.length ? template.issueTypes : defaultConfig.issueTypes) as unknown[];
    updateData.priorities = (template.priorities?.length ? template.priorities : defaultConfig.priorities) as unknown[];
  } else {
    if (input.statuses !== undefined) updateData.statuses = input.statuses;
    if (input.issueTypes !== undefined) updateData.issueTypes = input.issueTypes;
    if (input.priorities !== undefined) updateData.priorities = input.priorities;
  }
  if (input.customFields !== undefined) updateData.customFields = input.customFields;
  if (input.versions !== undefined) {
    updateData.versions = input.versions.map((v) => ({
      ...v,
      releaseDate: v.releaseDate ? new Date(v.releaseDate) : undefined,
    }));
  }
  if (input.environments !== undefined) updateData.environments = input.environments;
  if (input.releaseRules !== undefined) updateData.releaseRules = input.releaseRules;

  const project = await Project.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: activeTaskflowOrganizationId },
    { $set: updateData },
    { new: true, runValidators: true }
  )
    .populate('lead', 'name email')
    .lean();

  if (!project) return null;

  if (input.lead !== undefined) {
    const nextLead = String(input.lead).trim();
    if (previousLeadId && previousLeadId !== nextLead) {
      await projectInvitationsService.downgradeToProjectMemberIfHasLeadRole(id, previousLeadId);
    }
    await projectInvitationsService.ensureUserHasFullProjectAccess(id, nextLead);
  }
  const out = withProjectDefaults(project as Record<string, unknown>);
  const versions = out.versions as Array<{ id: string }> | undefined;
  if (versions?.length) {
    const counts = await Promise.all(
      versions.map((v) => Issue.countDocuments({ project: id, fixVersion: v.id }))
    );
    (out as Record<string, unknown>).versions = versions.map((v, i) => ({ ...v, issueCount: counts[i] }));
  }
  return out;
}

export async function remove(id: string, activeTaskflowOrganizationId: string): Promise<boolean> {
  const result = await Project.findOneAndDelete({ _id: id, taskflowOrganizationId: activeTaskflowOrganizationId });
  return result != null;
}

export async function releaseVersionToEnvironment(
  projectId: string,
  versionId: string,
  environmentId: string,
  issueIds: string[] | undefined,
  activeTaskflowOrganizationId: string,
  releasedByUserId?: string
): Promise<{ releaseNotes: string; version: unknown; updatedCount: number }> {
  const rawProject = await Project.findOne({
    _id: projectId,
    taskflowOrganizationId: activeTaskflowOrganizationId,
  }).lean();
  if (!rawProject) throw new ApiError(404, 'Project not found');
  const project = withProjectDefaults(rawProject as Record<string, unknown>) as Record<string, unknown>;
  const p = project as {
    versions?: Array<{ id: string; name: string; releasedAtByEnvironment?: Record<string, string> }>;
    environments?: Array<{ id: string; name: string; order: number }>;
    releaseRules?: IProjectReleaseRule[];
    statuses?: Array<{ name: string }>;
    issueTypes?: Array<{ name: string; order: number }>;
  };
  const version = p.versions?.find((v) => v.id === versionId);
  if (!version) throw new ApiError(404, 'Version not found');
  const envList = p.environments ?? [];
  const env = envList.find((e) => e.id === environmentId);
  if (!env) throw new ApiError(404, 'Environment not found');
  const promoteRelease = isPromoteToEnvironment(envList, version, environmentId);
  if (version.releasedAtByEnvironment?.[environmentId]) {
    throw new ApiError(400, `Version is already released to "${env.name}". Choose a higher environment to promote.`);
  }
  const rule = p.releaseRules?.find((r) => r.environmentId === environmentId) as IProjectReleaseRule | undefined;
  if (!rule) throw new ApiError(400, `No release rule for environment "${env.name}". Configure it in Project settings → Release rules.`);
  const validStatuses = (p.statuses ?? []).map((s) => s.name);
  if (!validStatuses.includes(rule.statusName)) throw new ApiError(400, `Release rule status "${rule.statusName}" is not a valid project status. Add or restore "${rule.statusName}" in Project settings → Statuses.`);

  const assigneeIdRaw = rule.assigneeId?.trim();
  let releaseAssigneeId: string | undefined;
  if (assigneeIdRaw) {
    if (!mongoose.Types.ObjectId.isValid(assigneeIdRaw)) {
      throw new ApiError(400, 'Release rule assignee is not a valid user id.');
    }
    const isMember = await ProjectMember.exists({ project: projectId, user: assigneeIdRaw });
    if (!isMember) {
      throw new ApiError(400, 'Release rule assignee must be a member of this project.');
    }
    releaseAssigneeId = assigneeIdRaw;
  }

  const useSelection = Array.isArray(issueIds);
  const selectedIds = useSelection ? issueIds : [];

  // Issues to include in release (status update + release notes). If selection is explicit and empty, include none.
  const queryIncluded =
    useSelection && selectedIds.length > 0
      ? { project: projectId, fixVersion: versionId, _id: { $in: selectedIds } }
      : useSelection && selectedIds.length === 0
        ? { project: projectId, fixVersion: versionId, _id: { $in: [] } }
        : { project: projectId, fixVersion: versionId };

  const releaseUpdate: Record<string, unknown> = { status: rule.statusName };
  if (releaseAssigneeId) {
    releaseUpdate.assignee = new mongoose.Types.ObjectId(releaseAssigneeId);
  }

  const issuesForAssignNotify = releaseAssigneeId
    ? await Issue.find(queryIncluded)
        .select('_id key title type status assignee project')
        .populate('project', 'key name')
        .lean()
    : [];

  const issues = await Issue.find(queryIncluded)
    .populate('project', 'key')
    .lean();

  await Issue.updateMany(queryIncluded, { $set: releaseUpdate });

  if (releaseAssigneeId && issuesForAssignNotify.length > 0) {
    const actorId = releasedByUserId ?? '';
    for (const issueDoc of issuesForAssignNotify) {
      const issue = {
        ...(issueDoc as unknown as issueNotification.IssueNotifySnapshot & {
          assignee?: { _id?: unknown } | null;
        }),
        _id: String(issueDoc._id),
        status: rule.statusName,
      };
      const previousAssigneeId = issue.assignee?._id ? String(issue.assignee._id) : null;
      if (previousAssigneeId === releaseAssigneeId) continue;
      if (previousAssigneeId) {
        issueNotification
          .notifyIssueUnassigned({
            issue,
            previousAssigneeUserId: previousAssigneeId,
            actorUserId: actorId,
          })
          .catch((err) => console.error('[release] unassign notify failed:', err));
      }
      issueNotification
        .notifyIssueAssigned({
          issue,
          assigneeUserId: releaseAssigneeId,
          actorUserId: actorId,
        })
        .catch((err) => console.error('[release] assign notify failed:', err));
    }
  }

  // Promoting to a higher tier: keep fixVersion on issues not in selection (same version, no new version row).
  if (!promoteRelease) {
    if (useSelection && selectedIds.length > 0) {
      await Issue.updateMany(
        { project: projectId, fixVersion: versionId, _id: { $nin: selectedIds } },
        { $pull: { fixVersion: versionId } }
      );
    } else if (useSelection && selectedIds.length === 0) {
      await Issue.updateMany(
        { project: projectId, fixVersion: versionId },
        { $pull: { fixVersion: versionId } }
      );
    }
    await Issue.updateMany(
      { project: projectId, fixVersion: { $exists: true, $size: 0 } },
      { $unset: { fixVersion: 1 } }
    );
  }

  // Group by issue type (dynamic from project issue types); section headings = type names
  const issueTypeNames = (p.issueTypes ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((t) => t.name);
  const byType: Record<string, Array<{ key: string; title: string; description: string }>> = {};
  /** One line for GFM table cells: strip HTML, normalize whitespace, cap length. */
  const plainTextForMarkdownCell = (raw: string, maxLen = 50000): string => {
    let s = (raw ?? '').trim();
    if (!s) return '';
    s = s.replace(/<[^>]+>/g, ' ');
    s = s.replace(/\s+/g, ' ');
    s = s.replace(/\|/g, ', ');
    if (s.length > maxLen) return `${s.slice(0, maxLen)}…`;
    return s;
  };
  for (const issue of issues) {
    const i = issue as unknown as { type: string; key?: string; title: string; description?: string; project?: { key: string } };
    const projKey = i.project && typeof i.project === 'object' && 'key' in i.project ? (i.project as { key: string }).key : '';
    const key = i.key ?? (projKey ? `${projKey}-${String(issue._id).slice(-6)}` : String(issue._id).slice(-8));
    const typeName = i.type ?? 'Task';
    const desc = plainTextForMarkdownCell(i.description ?? '');
    if (!byType[typeName]) byType[typeName] = [];
    byType[typeName].push({ key, title: i.title, description: desc });
  }
  const sections = issueTypeNames.length > 0
    ? issueTypeNames.filter((name) => byType[name]?.length)
    : Object.keys(byType).sort();
  if (sections.length === 0 && Object.keys(byType).length > 0) {
    sections.push(...Object.keys(byType).sort());
  }
  const now = new Date();
  const projectName = (rawProject as { name?: string }).name ?? 'Project';
  const releasedAtFormatted = now.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const actionLabel = promoteRelease ? 'Promotion' : 'Release';
  let releaseNotes = `# ${actionLabel} ${version.name} → ${env.name}\n\n`;
  releaseNotes += `**Project:** ${projectName}\n\n`;
  releaseNotes += `**Release date & time:** ${releasedAtFormatted}\n\n`;
  releaseNotes += `*Issues in this release have been updated.*\n\n`;
  for (const heading of sections) {
    const items = byType[heading] ?? [];
    if (items.length === 0) continue;
    releaseNotes += `## ${heading}\n\n`;
    releaseNotes += `| Id | Name | Description |\n| --- | --- | --- |\n`;
    for (const item of items) {
      const esc = (s: string) => s.replace(/\|/g, ', ');
      // Bold issue id so the reader can render it as a link to the issue; name/description stay plain.
      releaseNotes += `| **${esc(item.key)}** | ${esc(item.title)} | ${esc(item.description)} |\n`;
    }
    releaseNotes += '\n';
  }

  const nowIso = now.toISOString();
  const raw = await Project.findOne({
    _id: projectId,
    taskflowOrganizationId: activeTaskflowOrganizationId,
  }).lean();
  if (!raw) throw new ApiError(404, 'Project not found');
  const versions = (raw as unknown as { versions: Array<Record<string, unknown>> }).versions.map((v) => {
    if (v.id !== versionId) return v;
    const releasedAt = (v.releasedAtByEnvironment as Record<string, string>) ?? {};
    const notes = (v.releaseNotesByEnvironment as Record<string, string>) ?? {};
    releasedAt[environmentId] = nowIso;
    notes[environmentId] = releaseNotes;
    return { ...v, status: 'released', releasedAtByEnvironment: releasedAt, releaseNotesByEnvironment: notes };
  });
  await Project.findOneAndUpdate(
    { _id: projectId, taskflowOrganizationId: activeTaskflowOrganizationId },
    { $set: { versions } }
  );
  const updatedProject = await Project.findOne({
    _id: projectId,
    taskflowOrganizationId: activeTaskflowOrganizationId,
  })
    .populate('lead', 'name email')
    .lean();
  const versionsList = (updatedProject as unknown as { versions?: Array<{ id: string }> })?.versions;
  const updatedVersion = versionsList?.find((v) => v.id === versionId) ?? version;
  const issueCount = await Issue.countDocuments({ project: projectId, fixVersion: versionId });

  const releaseTitle = `Release: ${version.name} → ${env.name}`;
  releaseNotificationService
    .dispatchReleaseNotifications({
      projectId,
      rule: rule as IProjectReleaseRule,
      releaseTitle,
      releaseNotesMarkdown: releaseNotes,
      versionName: version.name,
      environmentName: env.name,
      projectName,
      releasedAtFormatted,
      issueCount: issues.length,
      promoteRelease,
    })
    .catch((err) => console.error('Release notifications failed:', err));

  return {
    releaseNotes,
    version: { ...updatedVersion, issueCount },
    updatedCount: issues.length,
  };
}
