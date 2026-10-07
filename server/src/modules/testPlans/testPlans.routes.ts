import express, { Router, type Request, type Response } from 'express';
import { importJUnit } from './junitImport';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireProjectPermission } from '../../middleware/requireProjectPermission';
import { asyncHandler } from '../../utils/asyncHandler';
import * as testPlansController from './testPlans.controller';
import { PROJECT_PERMISSIONS } from '../../shared/constants/permissions';

const router = Router({ mergeParams: true });

router.use(authMiddleware);

router.get('/', requireProjectPermission(PROJECT_PERMISSIONS.TEST_MANAGEMENT.SUITE.READ), asyncHandler(testPlansController.listTestPlans as Parameters<typeof asyncHandler>[0]));
router.post('/', requireProjectPermission(PROJECT_PERMISSIONS.TEST_MANAGEMENT.SUITE.UPDATE), asyncHandler(testPlansController.createTestPlan as Parameters<typeof asyncHandler>[0]));
router.patch('/:planId', requireProjectPermission(PROJECT_PERMISSIONS.TEST_MANAGEMENT.SUITE.UPDATE), asyncHandler(testPlansController.updateTestPlan as Parameters<typeof asyncHandler>[0]));
router.delete('/:planId', requireProjectPermission(PROJECT_PERMISSIONS.TEST_MANAGEMENT.SUITE.UPDATE), asyncHandler(testPlansController.deleteTestPlan as Parameters<typeof asyncHandler>[0]));
router.get('/:planId/cycles', requireProjectPermission(PROJECT_PERMISSIONS.TEST_MANAGEMENT.SUITE.READ), asyncHandler(testPlansController.listTestCycles as Parameters<typeof asyncHandler>[0]));
router.post('/:planId/cycles', requireProjectPermission(PROJECT_PERMISSIONS.TEST_MANAGEMENT.SUITE.UPDATE), asyncHandler(testPlansController.createTestCycle as Parameters<typeof asyncHandler>[0]));
router.patch('/:planId/cycles/:cycleId', requireProjectPermission(PROJECT_PERMISSIONS.TEST_MANAGEMENT.SUITE.UPDATE), asyncHandler(testPlansController.updateTestCycle as Parameters<typeof asyncHandler>[0]));
router.delete('/:planId/cycles/:cycleId', requireProjectPermission(PROJECT_PERMISSIONS.TEST_MANAGEMENT.SUITE.UPDATE), asyncHandler(testPlansController.deleteTestCycle as Parameters<typeof asyncHandler>[0]));
router.get('/:planId/cycles/:cycleId/runs', requireProjectPermission(PROJECT_PERMISSIONS.TEST_MANAGEMENT.SUITE.READ), asyncHandler(testPlansController.getCycleRuns as Parameters<typeof asyncHandler>[0]));
router.patch('/:planId/cycles/:cycleId/runs/:testCaseId', requireProjectPermission(PROJECT_PERMISSIONS.TEST_MANAGEMENT.SUITE.UPDATE), asyncHandler(testPlansController.updateRunStatus as Parameters<typeof asyncHandler>[0]));

/**
 * CI upload: send the JUnit XML as the raw body (Content-Type: application/xml
 * or text/xml) or as JSON { xml }. Authenticate with an API token (atr_…).
 *   curl -X POST -H "Authorization: Bearer atr_…" -H "Content-Type: application/xml" \
 *     --data-binary @junit.xml "$API/projects/<id>/test-plans/<planId>/cycles/<cycleId>/junit"
 */
router.post(
  '/:planId/cycles/:cycleId/junit',
  express.text({ type: ['application/xml', 'text/xml', 'text/plain'], limit: '10mb' }),
  requireProjectPermission(PROJECT_PERMISSIONS.TEST_MANAGEMENT.SUITE.UPDATE),
  asyncHandler(async (req: Request, res: Response) => {
    const xml = typeof req.body === 'string' ? req.body : String(req.body?.xml ?? '');
    const summary = await importJUnit(req.params.id, req.params.planId, req.params.cycleId, xml, {
      createMissing: req.query.createMissing !== 'false',
      actorId: req.user?.id,
    });
    res.json({ success: true, data: summary });
  })
);

export const testPlansRoutes = router;
