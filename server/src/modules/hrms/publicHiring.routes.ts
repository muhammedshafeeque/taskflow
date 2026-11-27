import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import * as offers from './offers.service';

/** No sign-in (AUT-37): a candidate's offer link, and a company's careers page. */
export const publicOfferRoutes = Router();
publicOfferRoutes.get('/:token', asyncHandler(async (req, res) => res.json({ success: true, data: await offers.publicOffer(req.params.token) })));
publicOfferRoutes.post('/:token/respond', asyncHandler(async (req, res) => res.json({ success: true, data: await offers.respondToOffer(req.params.token, req.body ?? {}) })));

export const publicCareersRoutes = Router();
publicCareersRoutes.get('/:slug', asyncHandler(async (req, res) => res.json({ success: true, data: await offers.careersPage(req.params.slug) })));
publicCareersRoutes.get('/:slug/jobs/:jobId', asyncHandler(async (req, res) => res.json({ success: true, data: await offers.careersJob(req.params.slug, req.params.jobId) })));
publicCareersRoutes.post('/:slug/jobs/:jobId/apply', asyncHandler(async (req, res) => res.json({ success: true, data: await offers.applyToJob(req.params.slug, req.params.jobId, req.body ?? {}) })));
