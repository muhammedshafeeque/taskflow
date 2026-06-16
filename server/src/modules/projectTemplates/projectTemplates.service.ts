import mongoose from 'mongoose';
import { ProjectTemplate } from './projectTemplate.model';
import { ProjectTemplateVersion, type ITemplateSnapshot } from './projectTemplateVersion.model';
import { ApiError } from '../../utils/ApiError';

const DEFAULT_STATUSES = [
  { id: 'backlog', name: 'Backlog', order: 0, isClosed: false },
  { id: 'todo', name: 'Todo', order: 1, isClosed: false },
  { id: 'inprogress', name: 'In Progress', order: 2, isClosed: false },
  { id: 'done', name: 'Done', order: 3, isClosed: true },
];

const DEFAULT_ISSUE_TYPES = [
  { id: 'task', name: 'Task', order: 0 },
  { id: 'bug', name: 'Bug', order: 1 },
  { id: 'story', name: 'Story', order: 2 },
  { id: 'epic', name: 'Epic', order: 3 },
];

const DEFAULT_PRIORITIES = [
  { id: 'lowest', name: 'Lowest', order: 0 },
  { id: 'low', name: 'Low', order: 1 },
  { id: 'medium', name: 'Medium', order: 2 },
  { id: 'high', name: 'High', order: 3 },
  { id: 'highest', name: 'Highest', order: 4 },
];

function inferClosedFromName(name: string): boolean {
  const normalized = String(name ?? '').trim().toLowerCase();
  return normalized === 'done' || normalized === 'closed' || normalized === 'clossed' || normalized === 'resolved' || normalized.includes('completed');
}

function normalizeStatuses(statuses: unknown[]): unknown[] {
  return (Array.isArray(statuses) ? statuses : []).map((raw) => {
    const status = raw as { name?: string; isClosed?: boolean };
    return { ...status, isClosed: status.isClosed ?? inferClosedFromName(String(status.name ?? '')) };
  });
}

function toSnapshot(doc: {
  name: string;
  description?: string;
  statuses?: unknown[];
  issueTypes?: unknown[];
  priorities?: unknown[];
  customFields?: unknown[];
  fieldSchemes?: unknown[];
  projectRules?: unknown[];
  estimateApprovalEnabled?: boolean;
  rulesEnforcementMode?: 'log' | 'enforce';
}): ITemplateSnapshot {
  return {
    name: doc.name,
    description: doc.description ?? '',
    statuses: normalizeStatuses(doc.statuses ?? []),
    issueTypes: doc.issueTypes ?? [],
    priorities: doc.priorities ?? [],
    customFields: doc.customFields ?? [],
    fieldSchemes: doc.fieldSchemes ?? [],
    projectRules: doc.projectRules ?? [],
    estimateApprovalEnabled: doc.estimateApprovalEnabled ?? false,
    rulesEnforcementMode: doc.rulesEnforcementMode ?? 'enforce',
  };
}

async function snapshotVersion(
  templateId: mongoose.Types.ObjectId,
  doc: {
    name: string;
    description?: string;
    statuses?: unknown[];
    issueTypes?: unknown[];
    priorities?: unknown[];
    customFields?: unknown[];
    fieldSchemes?: unknown[];
    projectRules?: unknown[];
    estimateApprovalEnabled?: boolean;
    rulesEnforcementMode?: 'log' | 'enforce';
    currentVersion?: number;
  },
  createdBy?: string,
  changelog?: string
): Promise<number> {
  const version = doc.currentVersion ?? 1;
  await ProjectTemplateVersion.create({
    templateId,
    version,
    snapshot: toSnapshot(doc),
    changelog: changelog ?? '',
    createdBy: createdBy && mongoose.Types.ObjectId.isValid(createdBy)
      ? new mongoose.Types.ObjectId(createdBy)
      : undefined,
  });
  return version + 1;
}

function builtInTemplate(): {
  _id: string;
  name: string;
  description: string;
  statuses: typeof DEFAULT_STATUSES;
  issueTypes: typeof DEFAULT_ISSUE_TYPES;
  priorities: typeof DEFAULT_PRIORITIES;
} {
  const defaultConfig = getDefaultConfig();
  return {
    _id: 'default',
    name: 'Built-in default',
    description: 'Standard backlog workflow, issue types, and priorities',
    statuses: defaultConfig.statuses,
    issueTypes: defaultConfig.issueTypes,
    priorities: defaultConfig.priorities,
  };
}

/** List templates for the active workspace: built-in + custom rows for that org only. */
export async function list(taskflowOrganizationId: string | null | undefined): Promise<unknown[]> {
  const builtIn = builtInTemplate();
  if (!taskflowOrganizationId || !mongoose.Types.ObjectId.isValid(taskflowOrganizationId)) {
    return [builtIn];
  }
  const orgOid = new mongoose.Types.ObjectId(taskflowOrganizationId);
  const dbList = await ProjectTemplate.find({ taskflowOrganizationId: orgOid }).sort({ name: 1 }).lean();
  const normalizedDb = dbList.map((tpl) => ({
    ...tpl,
    statuses: normalizeStatuses((tpl as { statuses?: unknown[] }).statuses ?? []),
  }));
  return [builtIn, ...normalizedDb];
}

/** Org-wide published templates for project creation picker. */
export async function listLibrary(taskflowOrganizationId: string | null | undefined): Promise<unknown[]> {
  if (!taskflowOrganizationId || !mongoose.Types.ObjectId.isValid(taskflowOrganizationId)) {
    return [];
  }
  const orgOid = new mongoose.Types.ObjectId(taskflowOrganizationId);
  const dbList = await ProjectTemplate.find({
    taskflowOrganizationId: orgOid,
    isLibrary: true,
  })
    .sort({ name: 1 })
    .lean();
  return dbList.map((tpl) => ({
    ...tpl,
    statuses: normalizeStatuses((tpl as { statuses?: unknown[] }).statuses ?? []),
  }));
}

export async function getById(
  templateId: string,
  taskflowOrganizationId: string | null | undefined
): Promise<unknown | null> {
  if (templateId === 'default') {
    const config = getDefaultConfig();
    return { _id: 'default', name: 'Default', description: '', ...config };
  }
  if (!mongoose.Types.ObjectId.isValid(templateId)) return null;
  if (!taskflowOrganizationId || !mongoose.Types.ObjectId.isValid(taskflowOrganizationId)) {
    return null;
  }
  const doc = await ProjectTemplate.findOne({
    _id: templateId,
    taskflowOrganizationId: new mongoose.Types.ObjectId(taskflowOrganizationId),
  }).lean();
  if (!doc) return null;
  return {
    ...doc,
    statuses: normalizeStatuses((doc as { statuses?: unknown[] }).statuses ?? []),
  };
}

export function getDefaultConfig(): {
  statuses: typeof DEFAULT_STATUSES;
  issueTypes: typeof DEFAULT_ISSUE_TYPES;
  priorities: typeof DEFAULT_PRIORITIES;
} {
  return {
    statuses: DEFAULT_STATUSES,
    issueTypes: DEFAULT_ISSUE_TYPES,
    priorities: DEFAULT_PRIORITIES,
  };
}

export async function createTemplateRecord(input: {
  taskflowOrganizationId: string;
  name: string;
  description?: string;
  statuses: unknown[];
  issueTypes: unknown[];
  priorities: unknown[];
  customFields?: unknown[];
  fieldSchemes?: unknown[];
  projectRules?: unknown[];
  estimateApprovalEnabled?: boolean;
  rulesEnforcementMode?: 'log' | 'enforce';
}): Promise<unknown> {
  if (!mongoose.Types.ObjectId.isValid(input.taskflowOrganizationId)) {
    throw new ApiError(400, 'Invalid workspace id');
  }
  const doc = await ProjectTemplate.create({
    taskflowOrganizationId: new mongoose.Types.ObjectId(input.taskflowOrganizationId),
    name: input.name,
    description: input.description ?? '',
    statuses: normalizeStatuses(input.statuses),
    issueTypes: input.issueTypes,
    priorities: input.priorities,
    customFields: input.customFields ?? [],
    fieldSchemes: input.fieldSchemes ?? [],
    projectRules: input.projectRules ?? [],
    estimateApprovalEnabled: input.estimateApprovalEnabled ?? false,
    rulesEnforcementMode: input.rulesEnforcementMode ?? 'enforce',
    currentVersion: 1,
  });
  const obj = doc.toObject();
  await ProjectTemplateVersion.create({
    templateId: doc._id,
    version: 1,
    snapshot: toSnapshot(obj),
    changelog: 'Initial version',
  });
  return obj;
}

export async function removeById(
  id: string,
  taskflowOrganizationId: string | null | undefined
): Promise<'not_found' | 'forbidden' | 'ok'> {
  if (id === 'default') return 'forbidden';
  if (!mongoose.Types.ObjectId.isValid(id)) return 'not_found';
  if (!taskflowOrganizationId || !mongoose.Types.ObjectId.isValid(taskflowOrganizationId)) return 'not_found';
  const r = await ProjectTemplate.findOneAndDelete({
    _id: id,
    taskflowOrganizationId: new mongoose.Types.ObjectId(taskflowOrganizationId),
  });
  if (r) {
    await ProjectTemplateVersion.deleteMany({ templateId: r._id });
  }
  return r ? 'ok' : 'not_found';
}

export async function listVersions(
  id: string,
  taskflowOrganizationId: string | null | undefined
): Promise<'not_found' | 'forbidden' | unknown[]> {
  if (id === 'default') return 'forbidden';
  if (!mongoose.Types.ObjectId.isValid(id)) return 'not_found';
  if (!taskflowOrganizationId || !mongoose.Types.ObjectId.isValid(taskflowOrganizationId)) return 'not_found';
  const tpl = await ProjectTemplate.findOne({
    _id: id,
    taskflowOrganizationId: new mongoose.Types.ObjectId(taskflowOrganizationId),
  }).select('_id');
  if (!tpl) return 'not_found';
  const versions = await ProjectTemplateVersion.find({ templateId: tpl._id })
    .sort({ version: -1 })
    .select('version changelog createdAt createdBy')
    .lean();
  return versions;
}

export async function restoreVersion(
  id: string,
  version: number,
  taskflowOrganizationId: string | null | undefined,
  userId?: string
): Promise<'not_found' | 'forbidden' | 'version_not_found' | unknown> {
  if (id === 'default') return 'forbidden';
  if (!mongoose.Types.ObjectId.isValid(id)) return 'not_found';
  if (!taskflowOrganizationId || !mongoose.Types.ObjectId.isValid(taskflowOrganizationId)) return 'not_found';

  const existing = await ProjectTemplate.findOne({
    _id: id,
    taskflowOrganizationId: new mongoose.Types.ObjectId(taskflowOrganizationId),
  });
  if (!existing) return 'not_found';

  const verDoc = await ProjectTemplateVersion.findOne({
    templateId: existing._id,
    version,
  }).lean();
  if (!verDoc) return 'version_not_found';

  const nextVersion = await snapshotVersion(
    existing._id as mongoose.Types.ObjectId,
    existing.toObject(),
    userId,
    `Before restore to v${version}`
  );

  const snap = verDoc.snapshot;
  existing.name = snap.name;
  existing.description = snap.description;
  existing.statuses = snap.statuses as typeof existing.statuses;
  existing.issueTypes = snap.issueTypes as typeof existing.issueTypes;
  existing.priorities = snap.priorities as typeof existing.priorities;
  existing.customFields = (snap.customFields ?? []) as typeof existing.customFields;
  existing.fieldSchemes = (snap.fieldSchemes ?? []) as typeof existing.fieldSchemes;
  existing.projectRules = (snap.projectRules ?? []) as typeof existing.projectRules;
  existing.estimateApprovalEnabled = snap.estimateApprovalEnabled ?? false;
  existing.rulesEnforcementMode = snap.rulesEnforcementMode ?? 'enforce';
  existing.currentVersion = nextVersion;
  await existing.save();
  return existing.toObject();
}

export async function updateById(
  id: string,
  taskflowOrganizationId: string | null | undefined,
  input: {
    name?: string;
    description?: string;
    statuses?: unknown[];
    issueTypes?: unknown[];
    priorities?: unknown[];
    customFields?: unknown[];
    fieldSchemes?: unknown[];
    projectRules?: unknown[];
    estimateApprovalEnabled?: boolean;
    rulesEnforcementMode?: 'log' | 'enforce';
    isLibrary?: boolean;
    changelog?: string;
  },
  userId?: string
): Promise<'not_found' | 'forbidden' | 'noop' | unknown> {
  if (id === 'default') return 'forbidden';
  if (!mongoose.Types.ObjectId.isValid(id)) return 'not_found';
  if (!taskflowOrganizationId || !mongoose.Types.ObjectId.isValid(taskflowOrganizationId)) return 'not_found';

  const existing = await ProjectTemplate.findOne({
    _id: id,
    taskflowOrganizationId: new mongoose.Types.ObjectId(taskflowOrganizationId),
  });
  if (!existing) return 'not_found';

  const updates: Record<string, unknown> = {};
  if (input.name !== undefined) updates.name = input.name.trim();
  if (input.description !== undefined) updates.description = input.description.trim();
  if (input.statuses !== undefined) updates.statuses = normalizeStatuses(input.statuses);
  if (input.issueTypes !== undefined) updates.issueTypes = input.issueTypes;
  if (input.priorities !== undefined) updates.priorities = input.priorities;
  if (input.customFields !== undefined) updates.customFields = input.customFields;
  if (input.fieldSchemes !== undefined) updates.fieldSchemes = input.fieldSchemes;
  if (input.projectRules !== undefined) updates.projectRules = input.projectRules;
  if (input.estimateApprovalEnabled !== undefined) updates.estimateApprovalEnabled = input.estimateApprovalEnabled;
  if (input.rulesEnforcementMode !== undefined) updates.rulesEnforcementMode = input.rulesEnforcementMode;
  if (input.isLibrary !== undefined) updates.isLibrary = input.isLibrary;
  if (Object.keys(updates).length === 0) return 'noop';

  const nextVersion = await snapshotVersion(
    existing._id as mongoose.Types.ObjectId,
    existing.toObject(),
    userId,
    input.changelog ?? 'Updated template'
  );
  updates.currentVersion = nextVersion;

  Object.assign(existing, updates);
  await existing.save();
  return existing.toObject();
}
