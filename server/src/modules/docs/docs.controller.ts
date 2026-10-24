import { Request, Response } from 'express';
import { makeActor } from './docs.access';
import * as spaces from './docSpaces.service';
import * as pages from './docPages.service';

function actor(req: Request) {
  return makeActor(req.user?.id, req.activeOrganizationId, req.user?.permissions);
}

function q(req: Request) {
  return req.query as Record<string, string | undefined>;
}

function versionParam(req: Request) {
  return Number.parseInt(req.params.version, 10);
}

export async function getMe(req: Request, res: Response) {
  const a = actor(req);
  res.json({ success: true, data: { canCreateSpace: a.canCreateSpace, isDocsAdmin: a.isDocsAdmin } });
}

export async function overview(req: Request, res: Response) {
  res.json({ success: true, data: await pages.overview(actor(req)) });
}

export async function search(req: Request, res: Response) {
  const query = q(req);
  res.json({ success: true, data: await pages.search(actor(req), { ...query, limit: Number(query.limit) || undefined }) });
}

export async function links(req: Request, res: Response) {
  res.json({ success: true, data: await pages.links(actor(req), q(req)) });
}

export async function lookupIssues(req: Request, res: Response) {
  res.json({ success: true, data: await pages.lookupIssues(actor(req), q(req)) });
}

export async function options(req: Request, res: Response) {
  res.json({ success: true, data: await pages.options(actor(req)) });
}

// Spaces

export async function listSpaces(req: Request, res: Response) {
  const query = q(req);
  const data = await spaces.listSpaces(actor(req), { includeArchived: query.archived === 'true', projectId: query.projectId });
  res.json({ success: true, data });
}

export async function getSpace(req: Request, res: Response) {
  res.json({ success: true, data: await spaces.getSpace(actor(req), req.params.key) });
}

export async function createSpace(req: Request, res: Response) {
  res.status(201).json({ success: true, data: await spaces.createSpace(actor(req), req.body ?? {}) });
}

export async function updateSpace(req: Request, res: Response) {
  res.json({ success: true, data: await spaces.updateSpace(actor(req), req.params.key, req.body ?? {}) });
}

export async function deleteSpace(req: Request, res: Response) {
  res.json({ success: true, data: await spaces.deleteSpace(actor(req), req.params.key) });
}

export async function starSpace(req: Request, res: Response) {
  res.json({ success: true, data: await spaces.toggleSpaceStar(actor(req), req.params.key, req.body?.starred !== false) });
}

export async function spaceTree(req: Request, res: Response) {
  res.json({ success: true, data: await pages.spaceTree(actor(req), req.params.key) });
}

export async function spaceTrash(req: Request, res: Response) {
  res.json({ success: true, data: await pages.listTrash(actor(req), req.params.key) });
}

// Pages

export async function createPage(req: Request, res: Response) {
  res.status(201).json({ success: true, data: await pages.createPage(actor(req), req.body ?? {}) });
}

export async function getPage(req: Request, res: Response) {
  res.json({ success: true, data: await pages.getPage(actor(req), req.params.id) });
}

export async function updatePage(req: Request, res: Response) {
  res.json({ success: true, data: await pages.updatePage(actor(req), req.params.id, req.body ?? {}) });
}

export async function deletePage(req: Request, res: Response) {
  const a = actor(req);
  const data = q(req).permanent === 'true' ? await pages.purgePage(a, req.params.id) : await pages.trashPage(a, req.params.id);
  res.json({ success: true, data });
}

export async function restorePage(req: Request, res: Response) {
  res.json({ success: true, data: await pages.restorePage(actor(req), req.params.id) });
}

export async function movePage(req: Request, res: Response) {
  res.json({ success: true, data: await pages.movePage(actor(req), req.params.id, req.body ?? {}) });
}

export async function starPage(req: Request, res: Response) {
  res.json({ success: true, data: await pages.togglePageStar(actor(req), req.params.id, req.body?.starred !== false) });
}

export async function listVersions(req: Request, res: Response) {
  res.json({ success: true, data: await pages.listVersions(actor(req), req.params.id) });
}

export async function getVersion(req: Request, res: Response) {
  res.json({ success: true, data: await pages.getVersion(actor(req), req.params.id, versionParam(req)) });
}

export async function restoreVersion(req: Request, res: Response) {
  res.json({ success: true, data: await pages.restoreVersion(actor(req), req.params.id, versionParam(req)) });
}

// Comments

export async function listComments(req: Request, res: Response) {
  res.json({ success: true, data: await pages.listComments(actor(req), req.params.id) });
}

export async function addComment(req: Request, res: Response) {
  res.status(201).json({ success: true, data: await pages.addComment(actor(req), req.params.id, req.body ?? {}) });
}

export async function updateComment(req: Request, res: Response) {
  res.json({ success: true, data: await pages.updateComment(actor(req), req.params.id, req.params.commentId, req.body ?? {}) });
}

export async function deleteComment(req: Request, res: Response) {
  res.json({ success: true, data: await pages.deleteComment(actor(req), req.params.id, req.params.commentId) });
}
