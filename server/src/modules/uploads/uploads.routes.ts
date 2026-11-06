import express, { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../../middleware/auth.middleware';
import { hasInternalKey } from '../../middleware/internalAuth';
import { customerAuthMiddleware } from '../customer-portal/middleware/customerAuth.middleware';
import { ApiError } from '../../utils/ApiError';
import { asyncHandler } from '../../utils/asyncHandler';
import { isAllowedType, MAX_UPLOAD_BYTES, PUBLIC_INLINE_EXT } from './fileValidation';
import { saveUpload, sendStoredFile } from './files.service';
import { clearUploadSession, hasUploadSession, setUploadSession } from './uploadSession';
import { largeUploads } from './largeUpload.service';

function staffOrCustomerAuth(req: Request, res: Response, next: NextFunction): void {
  // The PA authenticates with the internal key (handled inside authMiddleware).
  if (hasInternalKey(req)) {
    void authMiddleware(req, res, next);
    return;
  }
  // Authorization header only — never accept JWT via ?token= (logs/Referer leak).
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
  if (!token) {
    next(new ApiError(401, 'Authentication required'));
    return;
  }
  const decoded = jwt.decode(token) as { userType?: string } | null;
  if (decoded?.userType === 'customer') {
    void customerAuthMiddleware(req, res, next);
    return;
  }
  void authMiddleware(req, res, next);
}

function actorId(req: Request): string {
  return req.user?.id || req.customerUser?.id || '';
}

const router = Router();

const rawChunkBody = express.raw({ type: 'application/octet-stream', limit: 32 * 1024 * 1024 });
function rawChunk(req: Request, res: Response, next: NextFunction) {
  rawChunkBody(req, res, (err: unknown) => {
    if ((err as { type?: string } | undefined)?.type === 'entity.too.large') {
      next(new ApiError(413, 'Chunk is too large'));
      return;
    }
    next(err);
  });
}

/** Files above 50 MB. Each chunk stays small enough for a default 1 MB nginx limit. */
router.post(
  '/large',
  staffOrCustomerAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { originalName?: string; mimeType?: string; size?: number };
    const data = await largeUploads().start(actorId(req), {
      originalName: String(body.originalName ?? ''),
      mimeType: String(body.mimeType ?? ''),
      size: Number(body.size),
    });
    res.status(201).json({ success: true, data });
  })
);

router.put(
  '/large/:id',
  staffOrCustomerAuth,
  rawChunk,
  asyncHandler(async (req: Request, res: Response) => {
    const chunk = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const data = await largeUploads().write(actorId(req), String(req.params.id), req.header('content-range'), chunk);
    res.json({ success: true, data });
  })
);

router.post(
  '/large/:id/complete',
  staffOrCustomerAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const saved = await largeUploads().complete(actorId(req), String(req.params.id));
    res.status(201).json({
      success: true,
      data: { url: saved.url, originalName: saved.originalName, mimeType: saved.mimeType, size: saved.size },
    });
  })
);

router.delete(
  '/large/:id',
  staffOrCustomerAuth,
  asyncHandler(async (req: Request, res: Response) => {
    await largeUploads().abort(actorId(req), String(req.params.id));
    res.status(204).end();
  })
);


// Buffered so the bytes can be sniffed before they reach any storage backend.
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

/** Lets this browser load uploads through <video> and plain links; see uploadSession.ts. */
router.post('/session', staffOrCustomerAuth, (req: Request, res: Response) => {
  setUploadSession(req, res);
  res.status(204).end();
});

router.delete('/session', (req: Request, res: Response) => {
  clearUploadSession(req, res);
  res.status(204).end();
});

/** Public read for raster images only (needed by <img>); everything else requires auth. */
router.get('/:filename', (req: Request, res: Response, next: NextFunction) => {
  const filename = path.basename(String(req.params.filename ?? ''));
  const serve = () => sendStoredFile(res, filename, undefined, req.headers.range).catch(next);
  if (PUBLIC_INLINE_EXT.has(path.extname(filename).toLowerCase()) || hasUploadSession(req)) {
    void serve();
    return;
  }
  staffOrCustomerAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    void serve();
  });
});

router.post(
  '/',
  staffOrCustomerAuth,
  (req: Request, res: Response, next: NextFunction) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ success: false, message: err instanceof Error ? err.message : 'Upload failed' });
        return;
      }
      next();
    });
  },
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ success: false, message: 'No file uploaded' });
      return;
    }
    const saved = await saveUpload({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
    });
    res.status(201).json({
      success: true,
      data: { url: saved.url, originalName: saved.originalName, mimeType: saved.mimeType, size: saved.size },
    });
  })
);

export const uploadsRoutes = router;
