import { Router } from 'express';
import { azureDevOpsWebhookHandler } from './webhooks.controller';

const router = Router();

router.post('/azure-devops/:projectId', azureDevOpsWebhookHandler);

export const webhooksRoutes = router;
