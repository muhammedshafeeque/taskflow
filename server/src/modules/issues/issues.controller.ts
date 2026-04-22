import { Request, Response } from 'express';
import type { AuthPayload } from '../../types/express';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import {
  createIssueSchema,
  updateIssueSchema,
  issueIdParamSchema,
  listIssuesQuerySchema,
  searchIssuesQuerySchema,
  searchGlobalQuerySchema,
  jqlQuerySchema,
  byKeyQuerySchema,
  createIssueLinkSchema,
  deleteIssueLinkParamSchema,
  bulkUpdateSchema,
  bulkDeleteSchema,
  backlogOrderSchema,
  exportIssuesQuerySchema,
} from './issue.validation';
import * as issuesService from './issues.service';
import * as issueLinksService from './issueLinks.service';
import * as issueHistoryService from './issueHistory.service';
import * as watchersService from '../watchers/watchers.service';
import { ApiError } from '../../utils/ApiError';
import { logAudit } from '../auditLogs/logAudit';
import * as analyticsService from '../analytics/analytics.service';

export async function createIssue(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const reporterId = req.user?.id;
  if (!reporterId) throw new ApiError(401, 'Unauthorized');
  const issue = await issuesService.create(req.body, reporterId);
  const issueObj = issue as { _id?: string; key?: string; project?: { _id?: unknown } };
  const projectId = issueObj.project && typeof issueObj.project === 'object' ? String(issueObj.project._id) : undefined;
  logAudit({
    userId: reporterId,
    action: 'create',
    resourceType: 'issue',
    resourceId: issueObj._id ? String(issueObj._id) : undefined,
    projectId,
    meta: { key: issueObj.key, title: (issue as { title?: string }).title },
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress,
  });
  analyticsService.logEvent(reporterId, 'issue_create', 'issue', projectId).catch(() => {});
  res.status(201).json({ success: true, data: issue });
}

export async function getIssues(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  const page = parseInt(String(req.query.page), 10) || 1;
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 20, 100);
  const filters = issuesService.queryToFilters(req.query as import('./issue.validation').ListIssuesQuery);
  const result = await issuesService.findAll(filters, { page, limit }, userId);
  res.status(200).json({ success: true, data: result });
}

export async function getQuickFilterCounts(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const project = req.query.project ? String(req.query.project) : undefined;
  const data = await issuesService.getQuickFilterCounts(userId, project);
  res.status(200).json({ success: true, data });
}

export async function exportIssuesExcel(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const query = req.query as import('./issue.validation').ListIssuesQuery & { jql?: string };
  const filters = issuesService.queryToFilters(query);
  const result = query.jql?.trim()
    ? await issuesService.findByJql({ jql: query.jql, userId, page: 1, limit: 10000 })
    : await issuesService.findAll(filters, { page: 1, limit: 10000 }, userId);
  const data = result.data as Array<{
    _id: string;
    key?: string;
    title?: string;
    type?: string;
    status?: string;
    priority?: string;
    assignee?: { name?: string };
    reporter?: { name?: string };
    sprint?: { name?: string };
    storyPoints?: number;
    startDate?: string;
    dueDate?: string;
    createdAt?: string;
    updatedAt?: string;
  }>;

  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Issues', { views: [{ state: 'frozen', ySplit: 1 }] });

  const headers = [
    'Key',
    'Title',
    'Type',
    'Status',
    'Priority',
    'Assignee',
    'Reporter',
    'Sprint',
    'Story Points',
    'Start Date',
    'Due Date',
    'Created',
    'Updated',
  ];
  sheet.addRow(headers);
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  for (const row of data) {
    const key = row.key ?? String(row._id).slice(-8);
    sheet.addRow([
      key,
      row.title ?? '',
      row.type ?? '',
      row.status ?? '',
      row.priority ?? '',
      row.assignee?.name ?? '',
      row.reporter?.name ?? '',
      row.sprint?.name ?? '',
      row.storyPoints ?? '',
      row.startDate ? new Date(row.startDate).toISOString().split('T')[0] : '',
      row.dueDate ? new Date(row.dueDate).toISOString().split('T')[0] : '',
      row.createdAt ?? '',
      row.updatedAt ?? '',
    ]);
  }

  sheet.columns = [
    { width: 14 },
    { width: 40 },
    { width: 12 },
    { width: 14 },
    { width: 12 },
    { width: 18 },
    { width: 18 },
    { width: 16 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 22 },
    { width: 22 },
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  const projectPart = filters.project ? (Array.isArray(filters.project) ? filters.project.join('-') : filters.project) : 'all';
  const filename = `issues_${projectPart}_${new Date().toISOString().split('T')[0]}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(Buffer.from(buffer));
}

export const exportIssuesHandler = [
  validate(exportIssuesQuerySchema.shape.query, 'query'),
  asyncHandler(exportIssuesExcel),
];

export async function getIssueById(req: Request, res: Response): Promise<void> {
  const issue = await issuesService.findById(req.params.id);
  if (!issue) throw new ApiError(404, 'Issue not found');
  res.status(200).json({ success: true, data: issue });
}

export async function getIssueByKey(req: Request, res: Response): Promise<void> {
  const { project, key } = req.query as { project: string; key: string };
  const issue = await issuesService.findByProjectAndKey(project, key);
  if (!issue) throw new ApiError(404, 'Issue not found');
  res.status(200).json({ success: true, data: issue });
}

export async function searchIssues(req: Request, res: Response): Promise<void> {
  const { project, q, page, limit } = req.query as { project: string; q?: string; page?: string; limit?: string };
  const result = await issuesService.search({
    projectId: project,
    q: q ?? '',
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 10,
  });
  res.status(200).json({ success: true, data: result });
}

export async function searchIssuesGlobal(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const { q, page, limit, excludeIssueId } = req.query as { q?: string; page?: string; limit?: string; excludeIssueId?: string };
  const result = await issuesService.searchGlobal({
    userId,
    q: q ?? '',
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 10,
    excludeIssueId,
  });
  res.status(200).json({ success: true, data: result });
}

export async function searchByJql(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const { jql, page, limit } = req.query as { jql?: string; page?: string; limit?: string };
  const result = await issuesService.findByJql({
    jql: jql ?? '',
    userId,
    page: page ? parseInt(page, 10) : 1,
    limit: limit ? parseInt(limit, 10) : 20,
  });
  res.status(200).json({ success: true, data: result });
}

export const searchGlobalQueryHandler = [
  validate(searchGlobalQuerySchema.shape.query, 'query'),
  asyncHandler(searchIssuesGlobal),
];

export async function updateIssue(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const authorId = req.user?.id;
  const issue = await issuesService.update(req.params.id, req.body, authorId);
  if (!issue) throw new ApiError(404, 'Issue not found');
  const issueObj = issue as { key?: string; title?: string; project?: { _id?: string; key?: string } };
  const issueKey = issueObj.key ?? (issueObj.project ? `${(issueObj.project as { key?: string }).key}-?` : '?');
  const projectId = issueObj.project?._id ? String(issueObj.project._id) : undefined;
  watchersService.notifyWatchers(req.params.id, authorId ?? '', {
    type: 'issue_updated',
    title: `Issue ${issueKey} updated`,
    body: (issueObj as { title?: string }).title ?? '',
    meta: { issueId: req.params.id, issueKey, projectId },
  }).catch(() => {});
  logAudit({
    userId: authorId ?? '',
    action: 'update',
    resourceType: 'issue',
    resourceId: req.params.id,
    projectId,
    meta: { key: issueKey, title: (issueObj as { title?: string }).title },
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress,
  });
  analyticsService.logEvent(authorId ?? '', 'issue_update', 'issue', projectId).catch(() => {});
  res.status(200).json({ success: true, data: issue });
}

export async function getIssueLinks(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const links = await issueLinksService.findByIssue(req.params.id, userId);
  res.status(200).json({ success: true, data: links });
}

export async function addIssueLink(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const { targetIssueId, linkType } = req.body as { targetIssueId: string; linkType: string };
  const doc = await issueLinksService.create(req.params.id, targetIssueId, linkType as import('./issueLink.model').IssueLinkType, userId);
  res.status(201).json({ success: true, data: doc });
}

export async function deleteIssueLink(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const deleted = await issueLinksService.remove(req.params.linkId, req.params.id, userId);
  if (!deleted) throw new ApiError(404, 'Link not found');
  res.status(200).json({ success: true, data: { message: 'Link removed' } });
}

export const addIssueLinkHandler = [
  validate(createIssueLinkSchema.shape.params, 'params'),
  validate(createIssueLinkSchema.shape.body, 'body'),
  asyncHandler(addIssueLink),
];

export const deleteIssueLinkHandler = [
  validate(deleteIssueLinkParamSchema.shape.params, 'params'),
  asyncHandler(deleteIssueLink),
];

export async function watchIssue(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  await watchersService.watch(req.params.id, userId);
  res.status(200).json({ success: true, data: { message: 'Watching' } });
}

export async function unwatchIssue(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const removed = await watchersService.unwatch(req.params.id, userId);
  if (!removed) throw new ApiError(404, 'Not watching');
  res.status(200).json({ success: true, data: { message: 'Unwatched' } });
}

export async function getWatchers(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const list = await watchersService.getWatchers(req.params.id, userId);
  res.status(200).json({ success: true, data: list });
}

export async function getWatchingStatus(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const watching = await watchersService.isWatching(req.params.id, userId);
  res.status(200).json({ success: true, data: { watching } });
}

export async function getWatchingStatusBatch(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const idsParam = req.query.ids;
  const issueIds = typeof idsParam === 'string'
    ? idsParam.split(',').map((s) => s.trim()).filter(Boolean)
    : Array.isArray(idsParam)
      ? idsParam.flatMap((s) => String(s).split(',').map((x) => x.trim()).filter(Boolean))
      : [];
  const result = await watchersService.getWatchingStatusBatch(issueIds, userId);
  res.status(200).json({ success: true, data: result });
}

export async function getSubtasks(req: Request, res: Response): Promise<void> {
  const children = await issuesService.findChildren(req.params.id);
  res.status(200).json({ success: true, data: children });
}

export async function getIssueHistory(req: Request, res: Response): Promise<void> {
  const issue = await issuesService.findById(req.params.id);
  if (!issue) throw new ApiError(404, 'Issue not found');
  const page = parseInt(String(req.query.page), 10) || 1;
  const limit = Math.min(parseInt(String(req.query.limit), 10) || 50, 100);
  const result = await issueHistoryService.findByIssue(req.params.id, { page, limit });
  res.status(200).json({ success: true, data: result });
}

export async function deleteIssue(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  const issue = await issuesService.findById(req.params.id);
  const deleted = await issuesService.remove(req.params.id);
  if (!deleted) throw new ApiError(404, 'Issue not found');
  const issueObj = issue as { key?: string; project?: { _id?: unknown } } | null;
  const projectId = issueObj?.project && typeof issueObj.project === 'object' ? String(issueObj.project._id) : undefined;
  if (userId) {
    logAudit({
      userId,
      action: 'delete',
      resourceType: 'issue',
      resourceId: req.params.id,
      projectId,
      meta: { key: issueObj?.key },
      ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress,
    });
  }
  res.status(200).json({ success: true, data: { message: 'Issue deleted' } });
}

export async function bulkUpdateIssues(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const { issueIds, updates } = req.body as { issueIds: string[]; updates: Record<string, unknown> };
  const result = await issuesService.bulkUpdate(issueIds, updates as import('./issues.service').BulkUpdateInput, userId);
  if (result.errors.length > 0) {
    res.status(400).json({ success: false, message: result.errors.join('; '), data: result });
    return;
  }
  res.status(200).json({ success: true, data: result });
}

export async function bulkDeleteIssues(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const { issueIds } = req.body as { issueIds: string[] };
  const result = await issuesService.bulkDelete(issueIds, userId);
  if (result.errors.length > 0) {
    res.status(400).json({ success: false, message: result.errors.join('; '), data: result });
    return;
  }
  res.status(200).json({ success: true, data: result });
}

export async function updateBacklogOrderHandler(req: Request & { user?: AuthPayload }, res: Response): Promise<void> {
  const userId = req.user?.id;
  if (!userId) throw new ApiError(401, 'Unauthorized');
  const { issueIds } = req.body as { issueIds: string[] };
  const result = await issuesService.updateBacklogOrder(issueIds, userId);
  if (result.errors.length > 0) {
    res.status(400).json({ success: false, message: result.errors.join('; '), data: result });
    return;
  }
  res.status(200).json({ success: true, data: result });
}

export const bulkUpdateHandler = [
  validate(bulkUpdateSchema.shape.body, 'body'),
  asyncHandler(bulkUpdateIssues),
];

export const bulkDeleteHandler = [
  validate(bulkDeleteSchema.shape.body, 'body'),
  asyncHandler(bulkDeleteIssues),
];

export const backlogOrderHandler = [
  validate(backlogOrderSchema.shape.body, 'body'),
  asyncHandler(updateBacklogOrderHandler),
];

export const createIssueHandler = [
  validate(createIssueSchema.shape.body, 'body'),
  asyncHandler(createIssue),
];

export const updateIssueHandler = [
  validate(updateIssueSchema.shape.params, 'params'),
  validate(updateIssueSchema.shape.body, 'body'),
  asyncHandler(updateIssue),
];

export const issueIdParamHandler = [
  validate(issueIdParamSchema.shape.params, 'params'),
];

export const searchIssuesQueryHandler = [
  validate(searchIssuesQuerySchema.shape.query, 'query'),
];

export const jqlQueryHandler = [
  validate(jqlQuerySchema.shape.query, 'query'),
];

export const byKeyQueryHandler = [
  validate(byKeyQuerySchema.shape.query, 'query'),
];

export const listIssuesQueryHandler = [
  validate(listIssuesQuerySchema.shape.query, 'query'),
];
