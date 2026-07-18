import { KbArticle } from './models/kbArticle.model';
import { ApiError } from '../../utils/ApiError';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export async function listKbArticles(workspaceId: string | null | undefined, publishedOnly = false) {
  const orgId = requireWorkspaceId(workspaceId);
  const filter: Record<string, unknown> = { taskflowOrganizationId: toOrgOid(orgId) };
  if (publishedOnly) filter.published = true;
  return KbArticle.find(filter).sort({ title: 1 }).lean();
}

export async function createKbArticle(
  workspaceId: string | null | undefined,
  input: Record<string, unknown>,
  authorId: string
) {
  const orgId = requireWorkspaceId(workspaceId);
  const title = String(input.title ?? '').trim();
  let slug = input.slug ? String(input.slug) : slugify(title);
  const exists = await KbArticle.findOne({ taskflowOrganizationId: toOrgOid(orgId), slug });
  if (exists) slug = `${slug}-${Date.now()}`;
  const doc = await KbArticle.create({
    taskflowOrganizationId: toOrgOid(orgId),
    title,
    slug,
    category: input.category ?? 'general',
    body: String(input.body ?? ''),
    published: Boolean(input.published),
    authorId,
  });
  return doc.toObject();
}

export async function updateKbArticle(id: string, workspaceId: string | null | undefined, input: Record<string, unknown>) {
  const orgId = requireWorkspaceId(workspaceId);
  const updated = await KbArticle.findOneAndUpdate(
    { _id: id, taskflowOrganizationId: toOrgOid(orgId) },
    { $set: input },
    { new: true }
  ).lean();
  if (!updated) throw new ApiError(404, 'Article not found');
  return updated;
}

export async function searchKbArticles(workspaceId: string | null | undefined, q: string) {
  const orgId = requireWorkspaceId(workspaceId);
  const term = q.trim();
  if (!term) return listKbArticles(orgId, true);
  return KbArticle.find({
    taskflowOrganizationId: toOrgOid(orgId),
    published: true,
    $or: [
      { title: { $regex: term, $options: 'i' } },
      { body: { $regex: term, $options: 'i' } },
    ],
  })
    .sort({ title: 1 })
    .limit(20)
    .lean();
}
