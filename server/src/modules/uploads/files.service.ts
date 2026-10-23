import path from 'path';
import type { Response } from 'express';
import { ApiError } from '../../utils/ApiError';
import { getStorage, readStoredObject } from '../../services/storage';
import {
  isAllowedType,
  isServableKey,
  MAX_UPLOAD_BYTES,
  mimeMatchesSniff,
  newStorageKey,
  PUBLIC_INLINE_EXT,
  sniffMime,
} from './fileValidation';

export type SavedUpload = {
  key: string;
  url: string;
  originalName: string;
  mimeType: string;
  size: number;
};

export function uploadUrl(key: string): string {
  return `/api/uploads/${encodeURIComponent(key)}`;
}

/** Validate (allowlist + magic bytes) and store through the active backend. */
export async function saveUpload(file: { buffer: Buffer; originalName: string; mimeType: string }): Promise<SavedUpload> {
  const { buffer, originalName, mimeType } = file;
  if (!buffer?.length) throw new ApiError(400, 'No file uploaded');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new ApiError(400, 'File too large');
  if (!isAllowedType(originalName, mimeType)) throw new ApiError(400, 'File type not allowed');
  if (!mimeMatchesSniff(mimeType, sniffMime(buffer.subarray(0, 64)))) {
    throw new ApiError(400, 'File content does not match declared type');
  }
  const key = newStorageKey(originalName);
  await getStorage().put(key, buffer, mimeType);
  return { key, url: uploadUrl(key), originalName, mimeType, size: buffer.length };
}

/** Stream a stored file with safe headers. Throws 400/403/404. */
export async function sendStoredFile(res: Response, key: string, downloadName?: string): Promise<void> {
  if (!key || key.includes('..') || key !== path.basename(key)) throw new ApiError(400, 'Invalid filename');
  if (!isServableKey(key)) throw new ApiError(403, 'File type blocked');
  const obj = await readStoredObject(key);
  if (!obj) throw new ApiError(404, 'Not found');
  const ext = path.extname(key).toLowerCase();
  const inline = PUBLIC_INLINE_EXT.has(ext) || ext === '.pdf' || ext === '.mp4' || ext === '.webm';
  const name = (downloadName || key).replace(/["\r\n]/g, '');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name}"`);
  res.type(obj.contentType || ext);
  if (obj.size !== undefined) res.setHeader('Content-Length', String(obj.size));
  await new Promise<void>((resolve, reject) => {
    obj.stream.on('error', reject);
    res.on('finish', resolve);
    obj.stream.pipe(res);
  });
}
