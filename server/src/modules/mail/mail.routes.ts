import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { requirePermission } from '../../middleware/requirePermission';
import { asyncHandler } from '../../utils/asyncHandler';
import { TASK_FLOW_PERMISSIONS } from '../../shared/constants/permissions';
import * as mail from './mail.controller';

const M = TASK_FLOW_PERMISSIONS.TASKFLOW.MAIL;
const router = Router();

router.use(authMiddleware);

router.get('/mailboxes', requirePermission(M.MAILBOX.READ), asyncHandler(mail.listMailboxes));
router.post('/mailboxes', requirePermission(M.MAILBOX.MANAGE), asyncHandler(mail.createMailbox));
router.post('/mailboxes/:id/sync', requirePermission(M.MAILBOX.MANAGE), asyncHandler(mail.syncMailboxNow));

router.get('/messages', requirePermission(M.MESSAGE.READ), asyncHandler(mail.listMessages));
router.get('/messages/:id', requirePermission(M.MESSAGE.READ), asyncHandler(mail.getMessage));
router.post('/messages/:id/link', requirePermission(M.MESSAGE.READ), asyncHandler(mail.linkMessage));
router.post('/send', requirePermission(M.MAILBOX.SEND), asyncHandler(mail.sendMail));

export const mailRoutes = router;
