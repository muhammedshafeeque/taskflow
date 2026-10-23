import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { authMiddleware } from '../../middleware/auth.middleware';
import { customerAuthMiddleware } from '../customer-portal/middleware/customerAuth.middleware';
import { ApiError } from '../../utils/ApiError';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/wav',
]);

const ALLOWED_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
  '.txt',
  '.csv',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.zip',
  '.mp4',
  '.webm',
  '.mp3',
  '.wav',
]);

const BLOCKED_EXT = new Set([
  '.html',
  '.htm',
  '.svg',
  '.js',
  '.mjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.xml',
  '.xhtml',
  '.php',
  '.exe',
  '.sh',
  '.bat',
]);

/** Safe for <img> without Authorization header (still no HTML/SVG). */
const PUBLIC_INLINE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

function staffOrCustomerAuth(req: Request, res: Response, next: NextFunction): void {
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

const uploadRoot = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadRoot)) {
  fs.mkdirSync(uploadRoot, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadRoot);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXT.has(ext) && !BLOCKED_EXT.has(ext) ? ext : '';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXT.has(ext) || !ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error('File type not allowed'));
      return;
    }
    cb(null, true);
  },
});

/** Sniff content magic bytes so clients cannot spoof MIME via Content-Type alone. */
function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'image/png';
  }
  if (buf.length >= 6) {
    const sig6 = buf.subarray(0, 6).toString('ascii');
    if (sig6 === 'GIF87a' || sig6 === 'GIF89a') return 'image/gif';
  }
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05)) {
    // ZIP container (docx/xlsx/zip)
    return 'application/zip';
  }
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV'].some((b) => brand.startsWith(b.trim()) || brand.includes(b.trim()))) {
      return 'video/mp4';
    }
  }
  if (
    buf.length >= 4 &&
    buf[0] === 0x1a &&
    buf[1] === 0x45 &&
    buf[2] === 0xdf &&
    buf[3] === 0xa3
  ) {
    return 'video/webm';
  }
  if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'ID3') return 'audio/mpeg';
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return 'audio/wav';
  }
  // text/csv and text/plain — allow if mostly printable
  if (buf.length > 0) {
    const sample = buf.subarray(0, Math.min(buf.length, 512));
    let printable = 0;
    for (const b of sample) {
      if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e)) printable += 1;
    }
    if (printable / sample.length >= 0.9) return 'text/plain';
  }
  return null;
}

const MIME_FAMILY: Record<string, Set<string>> = {
  'image/jpeg': new Set(['image/jpeg']),
  'image/png': new Set(['image/png']),
  'image/gif': new Set(['image/gif']),
  'image/webp': new Set(['image/webp']),
  'application/pdf': new Set(['application/pdf']),
  'application/zip': new Set([
    'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]),
  'video/mp4': new Set(['video/mp4']),
  'video/webm': new Set(['video/webm']),
  'audio/mpeg': new Set(['audio/mpeg']),
  'audio/wav': new Set(['audio/wav']),
  'text/plain': new Set(['text/plain', 'text/csv']),
};

function mimeMatchesSniff(claimed: string, sniffed: string | null): boolean {
  if (!sniffed) return false;
  const family = MIME_FAMILY[sniffed];
  return Boolean(family?.has(claimed));
}

function sendUploadFile(req: Request, res: Response) {
  const filename = path.basename(String(req.params.filename ?? ''));
  if (!filename || filename.includes('..')) {
    res.status(400).json({ success: false, message: 'Invalid filename' });
    return;
  }
  const ext = path.extname(filename).toLowerCase();
  if (BLOCKED_EXT.has(ext) || !ALLOWED_EXT.has(ext)) {
    res.status(403).json({ success: false, message: 'File type blocked' });
    return;
  }
  const full = path.join(uploadRoot, filename);
  if (!full.startsWith(uploadRoot) || !fs.existsSync(full)) {
    res.status(404).json({ success: false, message: 'Not found' });
    return;
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  const inline = PUBLIC_INLINE_EXT.has(ext) || ext === '.pdf' || ext === '.mp4' || ext === '.webm';
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}"`);
  res.sendFile(full);
}

/** Public read for raster images only (needed by <img>); everything else requires auth. */
router.get('/:filename', (req: Request, res: Response, next: NextFunction) => {
  const filename = path.basename(String(req.params.filename ?? ''));
  const ext = path.extname(filename).toLowerCase();
  if (PUBLIC_INLINE_EXT.has(ext)) {
    sendUploadFile(req, res);
    return;
  }
  staffOrCustomerAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    sendUploadFile(req, res);
  });
});

router.post('/', staffOrCustomerAuth, (req: Request, res: Response, next: NextFunction) => {
  upload.single('file')(req, res, (err: unknown) => {
    if (err) {
      res.status(400).json({ success: false, message: err instanceof Error ? err.message : 'Upload failed' });
      return;
    }
    next();
  });
}, (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, message: 'No file uploaded' });
    return;
  }

  const full = path.join(uploadRoot, req.file.filename);
  try {
    const fd = fs.openSync(full, 'r');
    const head = Buffer.alloc(64);
    const n = fs.readSync(fd, head, 0, 64, 0);
    fs.closeSync(fd);
    const sniffed = sniffMime(head.subarray(0, n));
    if (!mimeMatchesSniff(req.file.mimetype, sniffed)) {
      fs.unlinkSync(full);
      res.status(400).json({ success: false, message: 'File content does not match declared type' });
      return;
    }
  } catch {
    try {
      fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
    res.status(400).json({ success: false, message: 'Upload validation failed' });
    return;
  }

  const publicPath = `/api/uploads/${encodeURIComponent(req.file.filename)}`;

  res.status(201).json({
    success: true,
    data: {
      url: publicPath,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    },
  });
});

export const uploadsRoutes = router;
