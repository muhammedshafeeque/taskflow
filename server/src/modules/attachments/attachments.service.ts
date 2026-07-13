import mongoose from 'mongoose';
import { Attachment } from './attachment.model';
import { Issue } from '../issues/issue.model';
import { ProjectMember } from '../projects/projectMember.model';
import { ApiError } from '../../utils/ApiError';

async function ensureUserCanAccessIssue(userId: string, issueId: string): Promise<void> {
  const issue = await Issue.findById(issueId).select('project').lean();
  if (!issue) throw new ApiError(404, 'Issue not found');
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const member = await ProjectMember.findOne({
    project: issue.project,
    user: userObjectId,
  }).lean();
  if (!member) throw new ApiError(403, 'Access denied to this issue');
}

export async function findByIssue(issueId: string, userId: string): Promise<unknown[]> {
  await ensureUserCanAccessIssue(userId, issueId);
  const list = await Attachment.find({ issue: issueId })
    .populate('uploadedBy', 'name')
    .sort({ createdAt: -1 })
    .lean();
  return list;
}

export async function create(
  issueId: string,
  userId: string,
  data: { url: string; originalName: string; mimeType: string; size: number }
): Promise<unknown> {
  await ensureUserCanAccessIssue(userId, issueId);
  const doc = await Attachment.create({
    issue: issueId,
    url: data.url,
    originalName: data.originalName,
    mimeType: data.mimeType,
    size: data.size,
    uploadedBy: userId,
  });
  const populated = await Attachment.findById(doc._id)
    .populate('uploadedBy', 'name')
    .lean();
  return populated ?? doc.toObject();
}

export async function createFromAdoSync(
  issueId: string,
  userId: string,
  data: {
    url: string;
    originalName: string;
    mimeType: string;
    size: number;
    adoAttachmentId: string;
  }
): Promise<boolean> {
  const existing = await Attachment.findOne({
    issue: issueId,
    adoAttachmentId: data.adoAttachmentId,
  }).lean();
  if (existing) return false;

  await Attachment.create({
    issue: issueId,
    url: data.url,
    originalName: data.originalName,
    mimeType: data.mimeType,
    size: data.size,
    uploadedBy: userId,
    adoAttachmentId: data.adoAttachmentId,
  });
  return true;
}

export async function remove(
  attachmentId: string,
  issueId: string,
  userId: string
): Promise<boolean> {
  await ensureUserCanAccessIssue(userId, issueId);
  const attachment = await Attachment.findOne({ _id: attachmentId, issue: issueId }).lean();
  if (!attachment) return false;
  const userObjectId = new mongoose.Types.ObjectId(userId);
  if (String(attachment.uploadedBy) !== String(userObjectId)) {
    throw new ApiError(403, 'Only the uploader can delete this attachment');
  }
  const result = await Attachment.deleteOne({ _id: attachmentId, issue: issueId });
  return result.deletedCount > 0;
}
