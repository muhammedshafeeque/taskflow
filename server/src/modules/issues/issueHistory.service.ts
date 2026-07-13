import { IssueHistory } from './issueHistory.model';
import { User } from '../auth/user.model';
import { Sprint } from '../sprints/sprint.model';
import { Comment } from '../comments/comment.model';
import type { PaginationOptions, PaginatedResult } from '../projects/projects.service';

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  type: 'Type',
  priority: 'Priority',
  status: 'Status',
  assignee: 'Assignee',
  reporter: 'Reporter',
  sprint: 'Sprint',
  boardColumn: 'Board Column',
  labels: 'Labels',
  dueDate: 'Due Date',
  startDate: 'Start Date',
  storyPoints: 'Story Points',
  checklist: 'Checklist',
  fixVersion: 'Fix Version',
  affectsVersions: 'Affects Versions',
  parent: 'Parent',
  stageEstimate: 'Stage estimate',
  worklogOverrun: 'Work log overrun reason',
};

function formatValue(val: unknown): string {
  if (val === null || val === undefined || val === '') return 'None';
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (Array.isArray(val)) return val.join(', ') || 'None';
  if (typeof val === 'object' && val !== null && 'name' in val) return String((val as { name: string }).name);
  return String(val);
}

export async function recordCreated(issueId: string, authorId: string): Promise<void> {
  const now = new Date();
  await IssueHistory.create({
    issue: issueId,
    author: authorId,
    action: 'created',
    activityAt: now,
  });
}

export async function recordFieldChanges(
  issueId: string,
  authorId: string,
  changes: Array<{ field: string; fromValue: unknown; toValue: unknown }>
): Promise<void> {
  if (changes.length === 0) return;
  const now = new Date();
  await IssueHistory.insertMany(
    changes.map(({ field, fromValue, toValue }) => ({
      issue: issueId,
      author: authorId,
      action: 'field_change' as const,
      field,
      fromValue,
      toValue,
      activityAt: now,
    }))
  );
}

export async function recordCommentAdded(issueId: string, authorId: string, commentId: string): Promise<void> {
  await IssueHistory.create({
    issue: issueId,
    author: authorId,
    action: 'comment_added',
    commentId,
  });
}

export async function recordCommentUpdated(
  issueId: string,
  authorId: string,
  commentId: string,
  fromBody: string,
  toBody: string
): Promise<void> {
  if (fromBody === toBody) return;
  await IssueHistory.create({
    issue: issueId,
    author: authorId,
    action: 'comment_updated',
    commentId,
    fromValue: fromBody,
    toValue: toBody,
  });
}

export async function findByIssue(
  issueId: string,
  pagination: PaginationOptions = { page: 1, limit: 50 }
): Promise<PaginatedResult<IssueHistoryItem>> {
  const { page, limit } = pagination;
  const skip = (page - 1) * limit;

  const [rows, total] = await Promise.all([
    IssueHistory.find({ issue: issueId })
      .populate('author', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    IssueHistory.countDocuments({ issue: issueId }),
  ]);

  const userIds = new Set<string>();
  const sprintIds = new Set<string>();
  const commentIds = new Set<string>();
  for (const r of rows as RawHistoryRow[]) {
    if (r.action === 'field_change' && r.field) {
      if (r.field === 'assignee' && r.fromValue) userIds.add(String(r.fromValue));
      if (r.field === 'assignee' && r.toValue) userIds.add(String(r.toValue));
      if (r.field === 'reporter' && r.fromValue) userIds.add(String(r.fromValue));
      if (r.field === 'reporter' && r.toValue) userIds.add(String(r.toValue));
      if (r.field === 'sprint' && r.fromValue) sprintIds.add(String(r.fromValue));
      if (r.field === 'sprint' && r.toValue) sprintIds.add(String(r.toValue));
    }
    if ((r.action === 'comment_added' || r.action === 'comment_updated') && r.commentId) {
      commentIds.add(String(r.commentId));
    }
  }

  const [users, sprints, comments] = await Promise.all([
    userIds.size ? User.find({ _id: { $in: Array.from(userIds) } }).select('name').lean() : [],
    sprintIds.size ? Sprint.find({ _id: { $in: Array.from(sprintIds) } }).select('name').lean() : [],
    commentIds.size ? Comment.find({ _id: { $in: Array.from(commentIds) } }).select('body').lean() : [],
  ]);

  const userMap = new Map((users as { _id: unknown; name: string }[]).map((u) => [String(u._id), u.name]));
  const sprintMap = new Map((sprints as { _id: unknown; name: string }[]).map((s) => [String(s._id), s.name]));
  const commentMap = new Map((comments as { _id: unknown; body: string }[]).map((c) => [String(c._id), c.body]));

  const data: IssueHistoryItem[] = (rows as RawHistoryRow[]).map((r) => {
    const author = r.author && typeof r.author === 'object' && 'name' in r.author ? (r.author as { name: string }).name : 'Unknown';
    const action = r.action === 'created' ? 'created' : r.action === 'comment_added' ? 'comment_added' : r.action === 'comment_updated' ? 'comment_updated' : 'field_change';
    const item: IssueHistoryItem = {
      _id: String(r._id),
      action,
      author: { _id: String((r.author as { _id: unknown })?._id ?? ''), name: author },
      createdAt: (r as { createdAt: Date }).createdAt?.toISOString?.() ?? new Date().toISOString(),
      source: (r as RawHistoryRow).source ?? 'taskflow',
      adoRev: (r as RawHistoryRow).adoRev,
    };
    if ((r.action === 'comment_added' || r.action === 'comment_updated') && r.commentId) {
      item.commentId = String(r.commentId);
      if (r.action === 'comment_added') {
        item.commentBody = commentMap.get(String(r.commentId)) ?? '';
      } else {
        item.fromValue = r.fromValue != null ? String(r.fromValue) : undefined;
        item.toValue = r.toValue != null ? String(r.toValue) : undefined;
        item.commentBody = r.toValue != null ? String(r.toValue) : commentMap.get(String(r.commentId)) ?? '';
      }
    }
    if (r.action === 'field_change' && r.field) {
      const fieldLabel = FIELD_LABELS[r.field] ?? r.field;
      let fromDisplay = formatValue(r.fromValue);
      let toDisplay = formatValue(r.toValue);
      if (r.field === 'assignee') {
        if (r.fromValue) fromDisplay = userMap.get(String(r.fromValue)) ?? fromDisplay;
        if (r.toValue) toDisplay = userMap.get(String(r.toValue)) ?? toDisplay;
      }
      if (r.field === 'reporter') {
        if (r.fromValue) fromDisplay = userMap.get(String(r.fromValue)) ?? fromDisplay;
        if (r.toValue) toDisplay = userMap.get(String(r.toValue)) ?? toDisplay;
      }
      if (r.field === 'sprint') {
        if (r.fromValue) fromDisplay = sprintMap.get(String(r.fromValue)) ?? fromDisplay;
        if (r.toValue) toDisplay = sprintMap.get(String(r.toValue)) ?? toDisplay;
      }
      item.field = fieldLabel;
      item.fromValue = fromDisplay;
      item.toValue = toDisplay;
    }
    return item;
  });

  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

interface RawHistoryRow {
  _id: unknown;
  action: string;
  author: unknown;
  field?: string;
  fromValue?: unknown;
  toValue?: unknown;
  commentId?: unknown;
  createdAt?: Date;
  source?: 'taskflow' | 'ado';
  adoRev?: number;
}

export interface IssueHistoryItem {
  _id: string;
  action: 'created' | 'field_change' | 'comment_added' | 'comment_updated';
  author: { _id: string; name: string };
  createdAt: string;
  field?: string;
  fromValue?: string;
  toValue?: string;
  commentId?: string;
  commentBody?: string;
  source?: 'taskflow' | 'ado';
  adoRev?: number;
}
