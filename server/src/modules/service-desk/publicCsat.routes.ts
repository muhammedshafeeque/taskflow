import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { submitCustomerCsat } from './desk.service';

/** Unauthenticated rating link from the "how did we do?" email (signed, 30-day token). */
export const publicCsatRoutes = Router();
publicCsatRoutes.post(
  '/:token',
  asyncHandler(async (req, res) => {
    const data = await submitCustomerCsat(req.params.token, Number(req.body?.score), req.body?.comment ? String(req.body.comment) : undefined);
    res.json({ success: true, data });
  })
);
