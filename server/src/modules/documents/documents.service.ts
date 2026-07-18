import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { DocumentRecord } from './models/documentRecord.model';

function asDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function listDocuments(
  workspaceId: string | null | undefined,
  query: { kind?: string; status?: string; entityType?: string; entityId?: string; accountId?: string; isTemplate?: string; search?: string } = {}
) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (query.kind) filter.kind = query.kind;
  if (query.status) filter.status = query.status;
  if (query.entityType) filter.entityType = query.entityType;
  if (query.entityId) filter.entityId = query.entityId;
  if (query.accountId) filter.accountId = query.accountId;
  if (query.isTemplate != null) filter.isTemplate = query.isTemplate === 'true';
  if (query.search) filter.title = new RegExp(query.search, 'i');
  return DocumentRecord.find(filter).populate('accountId', 'name').populate('ownerId', 'name').sort({ updatedAt: -1 }).lean();
}

export async function createDocument(workspaceId: string | null | undefined, input: Record<string, unknown>, userId?: string) {
  const orgId = requireWorkspaceId(workspaceId);
  if (!input.title || !String(input.title).trim()) throw new ApiError(400, 'Title is required');
  const doc = await DocumentRecord.create({
    taskflowOrganizationId: toOrgOid(orgId),
    title: String(input.title).trim(),
    kind: input.kind ?? 'proposal',
    status: input.status ?? 'draft',
    entityType: input.entityType ?? 'none',
    entityId: input.entityId || undefined,
    accountId: input.accountId || undefined,
    ownerId: input.ownerId || userId || undefined,
    value: Number(input.value ?? 0),
    currency: input.currency ?? 'USD',
    tags: Array.isArray(input.tags) ? input.tags : [],
    summary: input.summary,
    content: input.content,
    fileUrl: input.fileUrl,
    isTemplate: input.kind === 'template' || Boolean(input.isTemplate),
    expiresAt: asDate(input.expiresAt),
  });
  return doc.toObject();
}

export async function updateDocument(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const doc = await DocumentRecord.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!doc) throw new ApiError(404, 'Document not found');
  const fields = ['title', 'kind', 'entityType', 'entityId', 'accountId', 'ownerId', 'currency', 'summary', 'content', 'fileUrl'] as const;
  for (const key of fields) if (key in input) (doc as unknown as Record<string, unknown>)[key] = input[key] === '' ? undefined : input[key];
  if ('value' in input) doc.value = Number(input.value);
  if ('tags' in input && Array.isArray(input.tags)) doc.tags = input.tags as string[];
  if ('expiresAt' in input) doc.expiresAt = asDate(input.expiresAt);
  if ('status' in input) {
    const prev = doc.status;
    doc.status = input.status as never;
    if (doc.status === 'sent' && prev !== 'sent') doc.sentAt = new Date();
    if (doc.status === 'signed' && prev !== 'signed') doc.signedAt = new Date();
  }
  await doc.save();
  return doc.toObject();
}

export async function cloneTemplate(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>, userId?: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const tpl = await DocumentRecord.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!tpl) throw new ApiError(404, 'Template not found');
  const doc = await DocumentRecord.create({
    taskflowOrganizationId: tpl.taskflowOrganizationId,
    title: input.title ? String(input.title) : `${tpl.title} (copy)`,
    kind: input.kind ?? (tpl.kind === 'template' ? 'proposal' : tpl.kind),
    status: 'draft',
    entityType: input.entityType ?? 'none',
    entityId: input.entityId || undefined,
    accountId: input.accountId || undefined,
    ownerId: userId || undefined,
    value: tpl.value,
    currency: tpl.currency,
    tags: tpl.tags,
    summary: tpl.summary,
    content: tpl.content,
    isTemplate: false,
  });
  return doc.toObject();
}

export async function deleteDocument(id: string, workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const deleted = await DocumentRecord.findOneAndDelete({ _id: id, taskflowOrganizationId: toOrgOid(orgId) });
  if (!deleted) throw new ApiError(404, 'Document not found');
  return { deleted: true };
}

export async function getDocumentsDashboard(workspaceId: string | null | undefined) {
  const orgId = requireWorkspaceId(workspaceId);
  const docs = await DocumentRecord.find({ taskflowOrganizationId: toOrgOid(orgId) })
    .populate('accountId', 'name')
    .sort({ updatedAt: -1 })
    .lean();

  const byKind = ['proposal', 'sow', 'policy', 'template'].map((k) => ({
    name: k,
    value: docs.filter((d) => d.kind === k).length,
  }));

  const byStatus = ['draft', 'in_review', 'sent', 'signed', 'approved', 'archived'].map((s) => ({
    name: s.replace('_', ' '),
    value: docs.filter((d) => d.status === s).length,
  }));

  const commercial = docs.filter((d) => d.kind === 'proposal' || d.kind === 'sow');
  const proposalValue = Math.round(commercial.reduce((s, d) => s + (d.value ?? 0), 0) * 100) / 100;
  const signedValue = Math.round(
    commercial.filter((d) => d.status === 'signed' || d.status === 'approved').reduce((s, d) => s + (d.value ?? 0), 0) * 100
  ) / 100;

  const recent = docs.slice(0, 10).map((d) => ({
    _id: String(d._id),
    title: d.title,
    kind: d.kind,
    status: d.status,
    value: d.value,
    currency: d.currency,
    account: (d.accountId as unknown as { name?: string })?.name,
    updatedAt: d.updatedAt,
  }));

  const awaitingSignature = docs
    .filter((d) => d.status === 'sent' && (d.kind === 'proposal' || d.kind === 'sow'))
    .slice(0, 10)
    .map((d) => ({
      _id: String(d._id),
      title: d.title,
      account: (d.accountId as unknown as { name?: string })?.name,
      value: d.value,
      currency: d.currency,
      sentAt: d.sentAt,
    }));

  return {
    counts: {
      total: docs.length,
      templates: docs.filter((d) => d.isTemplate).length,
      awaitingSignature: docs.filter((d) => d.status === 'sent').length,
      signed: docs.filter((d) => d.status === 'signed' || d.status === 'approved').length,
    },
    proposalValue,
    signedValue,
    winRate: proposalValue ? Math.round((signedValue / proposalValue) * 1000) / 10 : 0,
    byKind,
    byStatus,
    recent,
    awaitingSignature,
  };
}
