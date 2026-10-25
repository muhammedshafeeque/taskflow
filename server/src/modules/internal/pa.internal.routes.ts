import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { authMiddleware } from '../../middleware/auth.middleware';
import { paIngestLimiter } from '../../middleware/rateLimit';
import { asyncHandler } from '../../utils/asyncHandler';
import { isAllowedType, MAX_UPLOAD_BYTES } from '../uploads/fileValidation';
import * as internal from './paInternal.controller';
import * as client from './paClient.controller';

/**
 * /api/internal/pa — private-network API for the first-party WhatsApp PA.
 * Never routed by nginx; authMiddleware accepts only the internal key here
 * (requireInternalCaller rejects user tokens).
 */
const router = Router();
router.use(paIngestLimiter, authMiddleware, internal.requireInternalCaller);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedType(file.originalname, file.mimetype)) {
      cb(new Error('File type not allowed'));
      return;
    }
    cb(null, true);
  },
});

function singleFile(req: Request, res: Response, next: NextFunction): void {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      res.status(400).json({ success: false, message: err instanceof Error ? err.message : 'Upload failed' });
      return;
    }
    next();
  });
}

const clientRouter = Router();
clientRouter.get('/context', asyncHandler(client.getContext));
clientRouter.get('/tickets', asyncHandler(client.listTickets));
clientRouter.post('/tickets', asyncHandler(client.createTicket));
clientRouter.post('/tickets/:ref/comments', asyncHandler(client.commentOnTicket));
clientRouter.get('/issues/by-key', asyncHandler(client.issueByKey));
clientRouter.get('/kb/search', asyncHandler(client.searchKb));
clientRouter.get('/docs', asyncHandler(client.searchDocs));
clientRouter.get('/docs/:id', asyncHandler(client.getDoc));
clientRouter.post('/requests', asyncHandler(client.createRequest));
clientRouter.get('/billing/summary', asyncHandler(client.billingSummary));
clientRouter.post('/files', singleFile, asyncHandler(client.uploadFile));
clientRouter.get('/files/:id', asyncHandler(client.downloadFile));
router.use('/client', clientRouter);

router.get('/health', asyncHandler(internal.health));
router.post('/resolve-chat', internal.requireOwnerActor, asyncHandler(internal.resolveChat));
router.get('/chat-bindings', internal.requireOwnerActor, asyncHandler(internal.listBindings));
router.put('/chat-bindings/:chatId', internal.requireOwnerActor, asyncHandler(internal.upsertBinding));
router.delete('/chat-bindings/:chatId', internal.requireOwnerActor, asyncHandler(internal.deleteBinding));

export const internalPaRoutes = router;
