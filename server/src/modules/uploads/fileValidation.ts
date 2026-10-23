import crypto from 'crypto';
import path from 'path';

/** Upload type rules shared by /api/uploads and the PA file endpoints. */
export const ALLOWED_MIME = new Set([
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

export const ALLOWED_EXT = new Set([
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

export const BLOCKED_EXT = new Set([
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
export const PUBLIC_INLINE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Sniff content magic bytes so clients cannot spoof MIME via Content-Type alone. */
export function sniffMime(buf: Buffer): string | null {
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

export function mimeMatchesSniff(claimed: string, sniffed: string | null): boolean {
  if (!sniffed) return false;
  const family = MIME_FAMILY[sniffed];
  return Boolean(family?.has(claimed));
}

/** Extension/MIME allowlist check before the bytes are read. */
export function isAllowedType(originalName: string, mimeType: string): boolean {
  const ext = path.extname(originalName).toLowerCase();
  return !BLOCKED_EXT.has(ext) && ALLOWED_EXT.has(ext) && ALLOWED_MIME.has(mimeType);
}

/** Random, extension-preserving storage key (also the public filename). */
export function newStorageKey(originalName: string): string {
  const ext = path.extname(originalName).toLowerCase();
  const safeExt = ALLOWED_EXT.has(ext) && !BLOCKED_EXT.has(ext) ? ext : '';
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExt}`;
}

/** A key we are willing to serve: plain basename with an allowed extension. */
export function isServableKey(key: string): boolean {
  if (!key || key !== path.basename(key) || key.includes('..')) return false;
  const ext = path.extname(key).toLowerCase();
  return !BLOCKED_EXT.has(ext) && ALLOWED_EXT.has(ext);
}
