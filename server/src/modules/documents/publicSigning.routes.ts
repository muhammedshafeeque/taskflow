import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { getSigningView, submitSignature } from './documentSigning.service';

/** Unauthenticated: the signer's personal link token is the credential. */
const router = Router();

router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: await getSigningView(req.params.token) });
  })
);

router.post(
  '/:token',
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { action?: string; signatureName?: string; reason?: string };
    const data = await submitSignature(
      req.params.token,
      { action: body.action === 'decline' ? 'decline' : 'sign', signatureName: body.signatureName, reason: body.reason },
      { ip: req.ip, userAgent: req.get('user-agent') ?? undefined }
    );
    res.json({ success: true, data });
  })
);

export const publicSigningRoutes = router;
