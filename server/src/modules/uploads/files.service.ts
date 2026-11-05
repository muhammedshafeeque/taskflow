import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
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

/** Single `bytes=` range only (all players use that); anything else serves the whole file. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!match || (!match[1] && !match[2])) return null;
  const last = size - 1;
  const range = match[1]
    ? { start: Number(match[1]), end: match[2] ? Math.min(Number(match[2]), last) : last }
    : { start: Math.max(size - Number(match[2]), 0), end: last };
  return range.start > range.end || size === 0 ? 'unsatisfiable' : range;
}

/** Works for every storage driver; seeks cost a read from the start, fine at the upload size cap. */
async function* sliceStream(source: Readable, start: number, end: number): AsyncGenerator<Buffer> {
  let position = 0;
  for await (const value of source) {
    const chunk = value as Buffer;
    const from = Math.max(start - position, 0);
    const to = Math.min(end + 1 - position, chunk.length);
    if (from < to) yield chunk.subarray(from, to);
    position += chunk.length;
    if (position > end) return;
  }
}

/** Stream a stored file with safe headers, honouring Range (needed to seek, and by Safari). Throws 400/403/404. */
export async function sendStoredFile(res: Response, key: string, downloadName?: string, rangeHeader?: string): Promise<void> {
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

  const range = obj.size !== undefined ? parseRange(rangeHeader, obj.size) : null;
  if (range === 'unsatisfiable') {
    obj.stream.destroy();
    res.status(416).setHeader('Content-Range', `bytes */${obj.size}`).end();
    return;
  }
  if (obj.size !== undefined) res.setHeader('Accept-Ranges', 'bytes');
  if (range) {
    res.status(206);
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${obj.size}`);
    res.setHeader('Content-Length', String(range.end - range.start + 1));
  } else if (obj.size !== undefined) {
    res.setHeader('Content-Length', String(obj.size));
  }
  const body = range ? Readable.from(sliceStream(obj.stream, range.start, range.end)) : obj.stream;
  try {
    await pipeline(body, res);
  } catch (err) {
    // Players drop the connection whenever they seek or pause; that isn't a failure.
    if ((err as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') throw err;
  }
}
