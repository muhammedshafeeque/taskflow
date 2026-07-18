import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requireAnyPermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as ctrl from './calendar.controller';

const C = TASK_FLOW_PERMISSIONS.TASKFLOW.CALENDAR;

const readAny = [C.DASHBOARD.READ, C.MEETING.LIST, C.DEMO.LIST, C.REVIEW.LIST];
const manage = [C.MEETING.MANAGE, C.DEMO.MANAGE, C.REVIEW.MANAGE];

const router = Router();
router.use(authMiddleware);

router.get('/dashboard', requireAnyPermission(readAny), asyncHandler(ctrl.getDashboard));
router.get('/feed', requireAnyPermission(readAny), asyncHandler(ctrl.getFeed));
router.get('/events', requireAnyPermission(readAny), asyncHandler(ctrl.listEvents));
router.post('/events', requireAnyPermission(manage), asyncHandler(ctrl.createEvent));
router.patch('/events/:id', requireAnyPermission(manage), asyncHandler(ctrl.updateEvent));
router.delete('/events/:id', requireAnyPermission(manage), asyncHandler(ctrl.deleteEvent));

export const calendarRoutes = router;
