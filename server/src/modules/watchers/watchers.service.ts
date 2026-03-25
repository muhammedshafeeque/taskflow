import mongoose from 'mongoose';
import { Watcher } from './watcher.model';
import { Issue } from '../issues/issue.model';
import { ProjectMember } from '../projects/projectMember.model';
import { User } from '../auth/user.model';
import { ApiError } from '../../utils/ApiError';
import { env } from '../../config/env';
import * as emailService from '../../services/email.service';
import * as notificationsService from '../notifications/notifications.service';

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

export async function watch(issueId: string, userId: string): Promise<void> {
  await ensureUserCanAccessIssue(userId, issueId);
  await Watcher.findOneAndUpdate(
    { issue: issueId, user: userId },
    { $setOnInsert: { issue: issueId, user: userId } },
    { upsert: true }
  );
}

export async function unwatch(issueId: string, userId: string): Promise<boolean> {
  await ensureUserCanAccessIssue(userId, issueId);
  const result = await Watcher.deleteOne({ issue: issueId, user: userId });
  return result.deletedCount > 0;
}

export async function getWatchers(issueId: string, userId: string): Promise<unknown[]> {
  await ensureUserCanAccessIssue(userId, issueId);
  const list = await Watcher.find({ issue: issueId })
    .populate('user', 'name email')
    .sort({ createdAt: 1 })
    .lean();
  return list;
}

export async function isWatching(issueId: string, userId: string): Promise<boolean> {
  const w = await Watcher.findOne({ issue: issueId, user: userId }).lean();
  return w != null;
}

export async function getWatchingStatusBatch(
  issueIds: string[],
  userId: string
): Promise<Record<string, boolean>> {
  if (issueIds.length === 0) return {};
  const safeIds = issueIds.slice(0, 100).filter((id) => id && typeof id === 'string');
  if (safeIds.length === 0) return {};
  const list = await Watcher.find({
    issue: { $in: safeIds },
    user: userId,
  })
    .select('issue')
    .lean();
  const result: Record<string, boolean> = {};
  for (const id of safeIds) result[id] = false;
  for (const w of list) result[String(w.issue)] = true;
  return result;
}

export async function getWatcherUserIds(issueId: string): Promise<string[]> {
  const list = await Watcher.find({ issue: issueId }).select('user').lean();
  return list.map((w) => String(w.user));
}

export async function notifyWatchers(
  issueId: string,
  excludeUserId: string,
  params: {
    type: string;
    title: string;
    body?: string;
    meta?: Record<string, unknown> & { projectId?: string; issueKey?: string };
  }
): Promise<void> {
  const userIds = await getWatcherUserIds(issueId);
  const toNotify = userIds.filter((id) => id !== excludeUserId);
  const projectId = params.meta?.projectId as string | undefined;
  const issueKey = params.meta?.issueKey as string | undefined;
  const issueUrl =
    projectId && issueKey
      ? `${env.appUrl}/projects/${projectId}/issues/${encodeURIComponent(issueKey)}`
      : `${env.appUrl}/inbox`;

  const metaWithUrl = { ...params.meta, url: issueUrl };

  for (const toUser of toNotify) {
    const mappedType =
      params.type === 'comment_added'
        ? 'watch_comment'
        : params.type === 'status_changed'
          ? 'watch_status'
          : 'watch_field';
    await notificationsService.createNotification({
      toUser,
      type: mappedType as any,
      title: params.title,
      body: params.body ?? '',
      url: issueUrl,
      meta: metaWithUrl,
    });
  }

  if (projectId && issueKey && toNotify.length > 0) {
    const users = await User.find({ _id: { $in: toNotify } }).select('email').lean();
    const emailParams: emailService.WatcherNotificationParams = {
      type: params.type,
      title: params.title,
      body: params.body,
      issueKey,
      issueUrl,
    };
    for (const u of users) {
      const email = (u as { email?: string }).email;
      if (email) {
        emailService.sendWatcherNotificationEmail(email, emailParams).catch(() => {});
      }
    }
  }
}
