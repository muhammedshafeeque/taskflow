import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { handleRazorpayWebhook, handleStripeWebhook } from '../modules/billing/payments.service';
import { handleGithubWebhook } from '../modules/integrations/github/githubWebhook.service';
import { azureDevOpsWebhookHandler } from './webhooks.controller';

const router = Router();

type RawRequest = Request & { rawBody?: Buffer };

// Payment providers call these directly; authenticity comes from the HMAC signature.
router.post(
  '/payments/razorpay',
  asyncHandler(async (req: RawRequest, res: Response) => {
    await handleRazorpayWebhook(req.rawBody, req.header('x-razorpay-signature'));
    res.json({ received: true });
  })
);
router.post(
  '/github',
  asyncHandler(async (req: RawRequest, res: Response) => {
    const data = await handleGithubWebhook(req.rawBody, req.header('x-github-event'), req.header('x-hub-signature-256'));
    res.json({ success: true, data });
  })
);
router.post(
  '/payments/stripe',
  asyncHandler(async (req: RawRequest, res: Response) => {
    await handleStripeWebhook(req.rawBody, req.header('stripe-signature'));
    res.json({ received: true });
  })
);

router.post('/azure-devops/:projectId', azureDevOpsWebhookHandler);

export const webhooksRoutes = router;
