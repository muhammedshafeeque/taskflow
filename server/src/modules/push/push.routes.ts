import { Router, Request, Response } from 'express';
import { env } from '../../config/env';

const router = Router();

router.get('/vapid-public-key', (_req: Request, res: Response) => {
  res.json({ success: true, data: { vapidPublicKey: env.vapidPublicKey || '' } });
});

export const pushRoutes = router;
