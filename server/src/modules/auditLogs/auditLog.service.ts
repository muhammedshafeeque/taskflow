import mongoose from 'mongoose';
import { AuditLog, type AuditActorType } from './auditLog.model';
import { Project } from '../projects/project.model';
import { OrganizationMember } from '../organizations/organizationMember.model';

export interface CreateAuditLogInput {
  /** Omit only for system events with no user / service account. */
  userId?: string;
  actorType?: AuditActorType;
  actorLabel?: string;
  onBehalfOf?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  projectId?: string;
  meta?: Record<string, unknown>;
  ip?: string;
}

export async function create(input: CreateAuditLogInput): Promise<void> {
  await AuditLog.create({
    user: input.userId,
    actorType: input.actorType ?? 'user',
    actorLabel: input.actorLabel,
    onBehalfOf: input.onBehalfOf,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    projectId: input.projectId,
    meta: input.meta,
    ip: input.ip,
  });
}

export interface ListAuditLogsFilters {
  user?: string;
  action?: string;
  resourceType?: string;
  projectId?: string;
}

export interface ListAuditLogsOptions {
  page?: number;
  limit?: number;
}

export async function findAll(
  filters: ListAuditLogsFilters = {},
  opts: ListAuditLogsOptions = {},
  taskflowOrganizationId?: string | null
): Promise<{ data: unknown[]; total: number; page: number; limit: number; totalPages: number }> {
  const { page = 1, limit = 50 } = opts;
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (filters.user) filter.user = filters.user;
  if (filters.action) filter.action = filters.action;
  if (filters.resourceType) filter.resourceType = filters.resourceType;
  if (filters.projectId) filter.projectId = filters.projectId;

  let mongoFilter: Record<string, unknown> = filter;

  if (taskflowOrganizationId && mongoose.Types.ObjectId.isValid(taskflowOrganizationId)) {
    const orgOid = new mongoose.Types.ObjectId(taskflowOrganizationId);
    const [workspaceProjectIds, orgMemberUserIds] = await Promise.all([
      Project.find({ taskflowOrganizationId: orgOid }).distinct('_id'),
      OrganizationMember.find({ organization: orgOid, status: 'active' }).distinct('user'),
    ]);
    const workspaceScope = {
      $or: [
        { projectId: { $in: workspaceProjectIds } },
        {
          $and: [
            { $or: [{ projectId: null }, { projectId: { $exists: false } }] },
            { user: { $in: orgMemberUserIds } },
          ],
        },
      ],
    };
    mongoFilter = Object.keys(filter).length > 0 ? { $and: [filter, workspaceScope] } : workspaceScope;
  }

  const [data, total] = await Promise.all([
    AuditLog.find(mongoFilter)
      .populate('user', 'name email')
      .populate('onBehalfOf', 'name email')
      .populate('projectId', 'name key')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(mongoFilter),
  ]);

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}
