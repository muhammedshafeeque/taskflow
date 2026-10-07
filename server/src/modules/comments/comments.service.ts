import { notifyIssuePeople } from '../notifications/domainNotify';
import { Comment } from './comment.model';
import * as issueHistoryService from '../issues/issueHistory.service';
import type { PaginationOptions, PaginatedResult } from '../projects/projects.service';
import { ApiError } from '../../utils/ApiError';

export async function create(
  issueId: string,
  authorId: string,
  body: string,
  opts: { portalHighlighted?: boolean; portalAuthorName?: string; customerRequestId?: string } = {}
): Promise<unknown> {
  const plainText = body.replace(/<[^>]+>/g, '');
  const portalVisible = /@requ\b/i.test(plainText);
  const doc = await Comment.create({
    body,
    issue: issueId,
    author: authorId,
    portalVisible,
    ...opts,
  });
  await issueHistoryService.recordCommentAdded(issueId, authorId, String(doc._id));
  notifyIssuePeople(issueId, 'task_commented', { title: 'New comment', body: plainText.slice(0, 200) }, authorId);
  const populated = await Comment.findById(doc._id)
    .populate('author', 'name email')
    .lean();
  return populated ?? doc.toObject();
}

export async function findByIssue(
  issueId: string,
  pagination: PaginationOptions = { page: 1, limit: 20 }
): Promise<PaginatedResult<unknown>> {
  const { page, limit } = pagination;
  const skip = (page - 1) * limit;

  const [data, total] = await Promise.all([
    Comment.find({ issue: issueId })
      .populate('author', 'name email')
      .lean()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Comment.countDocuments({ issue: issueId }),
  ]);

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function findById(commentId: string, issueId: string): Promise<unknown | null> {
  const comment = await Comment.findOne({ _id: commentId, issue: issueId })
    .populate('author', 'name email')
    .lean();
  return comment ?? null;
}

export async function update(
  commentId: string,
  issueId: string,
  body: string,
  authorId: string
): Promise<unknown | null> {
  const existing = await Comment.findOne({ _id: commentId, issue: issueId }).select('body author').lean();
  if (!existing) return null;
  if (String(existing.author) !== String(authorId)) {
    throw new ApiError(403, 'You can only edit your own comments');
  }
  const oldComment = existing;
  const plainText = body.replace(/<[^>]+>/g, '');
  const portalVisible = /@requ\b/i.test(plainText);
  const comment = await Comment.findOneAndUpdate(
    { _id: commentId, issue: issueId },
    { $set: { body, portalVisible } },
    { new: true, runValidators: true }
  )
    .populate('author', 'name email')
    .lean();

  if (comment && oldComment && oldComment.body !== body) {
    await issueHistoryService.recordCommentUpdated(issueId, authorId, commentId, oldComment.body, body);
  }
  return comment ?? null;
}

export async function remove(commentId: string, issueId: string): Promise<boolean> {
  const result = await Comment.findOneAndDelete({ _id: commentId, issue: issueId });
  return result != null;
}
