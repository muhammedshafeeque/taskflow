import { Router, type Request, type Response, type NextFunction } from 'express';
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

const router = Router();

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

/** Public read for raster images only (needed by <img>); everything else requires auth. */
router.get('/:filename', (req: Request, res: Response, next: NextFunction) => {
  const filename = path.basename(String(req.params.filename ?? ''));
  const serve = () => sendStoredFile(res, filename).catch(next);
  if (PUBLIC_INLINE_EXT.has(path.extname(filename).toLowerCase())) {
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
