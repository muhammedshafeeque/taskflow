import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as svc from './designationTemplates.service';

const D = TASK_FLOW_PERMISSIONS.PROJECT.DESIGNATION;
type R = Request & { activeOrganizationId?: string };
const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ success: true, data });

/** Company-wide project designation templates (Projects → Designation templates). */
export const designationTemplatesRoutes = Router();
const r = designationTemplatesRoutes;
r.use(authMiddleware);
// Readers include anyone who creates projects, so the create form can offer them.
r.get('/', requireAnyPermission([D.LIST, D.READ, D.CREATE, D.UPDATE, TASK_FLOW_PERMISSIONS.PROJECT.PROJECT.CREATE]), asyncHandler(async (req: R, res) => ok(res, await svc.listTemplates(req.activeOrganizationId, req.query.active === '1'))));
r.post('/', requireAnyPermission([D.CREATE]), asyncHandler(async (req: R, res) => ok(res, await svc.saveTemplate(req.activeOrganizationId, req.body ?? {}), 201)));
r.patch('/:id', requireAnyPermission([D.UPDATE]), asyncHandler(async (req: R, res) => ok(res, await svc.saveTemplate(req.activeOrganizationId, req.body ?? {}, req.params.id))));
r.delete('/:id', requireAnyPermission([D.DELETE]), asyncHandler(async (req: R, res) => ok(res, await svc.deleteTemplate(req.activeOrganizationId, req.params.id))));
