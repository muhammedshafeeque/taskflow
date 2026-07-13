import { Router } from 'express';
import {
  getAdoIntegrationHandler,
  putAdoIntegrationHandler,
  postTestAdoIntegrationHandler,
  postRunAdoSyncHandler,
} from './adoIntegration.controller';

const router = Router({ mergeParams: true });

router.get('/', ...getAdoIntegrationHandler);
router.put('/', ...putAdoIntegrationHandler);
router.post('/test', ...postTestAdoIntegrationHandler);
router.post('/sync', ...postRunAdoSyncHandler);

export const adoIntegrationRoutes = router;
