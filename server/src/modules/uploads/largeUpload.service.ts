import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { ApiError } from '../../utils/ApiError';
import type { StorageDriver } from '../../services/storage';
import { getStorage } from '../../services/storage';
import { isAllowedType, MAX_UPLOAD_BYTES, mimeMatchesSniff, newStorageKey, sniffMime } from './fileValidation';

/** One request stays under nginx's default 1MB body limit. */
export const DEFAULT_CHUNK_BYTES = 768 * 1024;
/** S3 rejects every part but the last when it is under 5 MiB. */
export const MULTIPART_PART_BYTES = 8 * 1024 * 1024;
export const MAX_LARGE_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;
const TTL_MS = 24 * 60 * 60 * 1000;

export function uploadChunkBytes(): number {
  const n = Number(process.env.UPLOAD_CHUNK_BYTES);
  if (!Number.isFinite(n) || n < 64 * 1024 || n > 32 * 1024 * 1024) return DEFAULT_CHUNK_BYTES;
  return Math.floor(n);
}

type S3State = { uploadId: string; parts: { partNumber: number; etag: string }[]; gen: number };
type Session = {
  id: string;
  ownerId: string;
  originalName: string;
  mimeType: string;
  size: number;
  received: number;
  key: string;
  backend: StorageDriver['name'];
  createdAt: number;
  headerB64?: string;
  sniffed?: boolean;
  s3?: S3State;
  azureBlocks?: string[];
};

export type LargeUploadStart = { id: string; chunkSize: number; maxBytes: number };
export type LargeUploadResult = { key: string; url: string; originalName: string; mimeType: string; size: number };

type Deps = {
  partialDir: string;
  getStorage: () => StorageDriver;
  chunkBytes?: number;
  partBytes?: number;
  maxBytes?: number;
  /** Files at or below this size stay on the single-request upload. Tests set 0. */
  directMaxBytes?: number;
  now?: () => number;
};

function assertId(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new ApiError(400, 'Invalid upload');
}

export function parseContentRange(header: string | undefined): { start: number; end: number; total: number } {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header?.trim() ?? '');
  if (!match) throw new ApiError(400, 'Content-Range must be bytes start-end/total');
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total) || end < start || end >= total) {
    throw new ApiError(400, 'Invalid Content-Range');
  }
  return { start, end, total };
}

export function createLargeUploads(deps: Deps) {
  const chunkBytes = deps.chunkBytes ?? uploadChunkBytes();
  const partBytes = deps.partBytes ?? MULTIPART_PART_BYTES;
  const maxBytes = deps.maxBytes ?? MAX_LARGE_UPLOAD_BYTES;
  const directMaxBytes = deps.directMaxBytes ?? MAX_UPLOAD_BYTES;
  const now = deps.now ?? Date.now;
  const tails = new Map<string, Promise<unknown>>();

  const sessionPath = (id: string) => path.join(deps.partialDir, `${id}.json`);
  const localPath = (id: string) => path.join(deps.partialDir, `${id}.bin`);
  const tailPath = (id: string, gen: number) => path.join(deps.partialDir, `${id}.tail.${gen}`);

  async function persist(session: Session) {
    const dest = sessionPath(session.id);
    const tmp = `${dest}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(session));
    await fs.promises.rename(tmp, dest);
  }

  async function load(id: string): Promise<Session | null> {
    try {
      return JSON.parse(await fs.promises.readFile(sessionPath(id), 'utf8')) as Session;
    } catch {
      return null;
    }
  }

  function lock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(id) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    tails.set(id, run.then(() => undefined, () => undefined));
    return run;
  }

  async function fileSize(file: string): Promise<number> {
    try {
      return (await fs.promises.stat(file)).size;
    } catch {
      return 0;
    }
  }

  async function readTail(session: Session): Promise<Buffer> {
    const gen = session.s3?.gen ?? 0;
    try {
      return await fs.promises.readFile(tailPath(session.id, gen));
    } catch {
      return Buffer.alloc(0);
    }
  }

  /** Point the session at `buf` and drop the previous tail file. */
  async function replaceTail(session: Session, buf: Buffer) {
    if (!session.s3) throw new ApiError(500, 'Upload is not a multipart upload');
    const next = session.s3.gen + 1;
    await fs.promises.writeFile(tailPath(session.id, next), buf);
    const prev = session.s3.gen;
    session.s3.gen = next;
    await persist(session);
    await fs.promises.rm(tailPath(session.id, prev), { force: true });
  }

  async function discard(session: Session) {
    const storage = deps.getStorage();
    if (session.s3 && storage.abortMultipart) {
      await storage.abortMultipart(session.key, session.s3.uploadId).catch(() => undefined);
    }
    if (session.backend === 'azure') await storage.remove(session.key).catch(() => undefined);
    await fs.promises.rm(localPath(session.id), { force: true });
    await fs.promises.rm(sessionPath(session.id), { force: true });
    if (session.s3) {
      await fs.promises.rm(tailPath(session.id, session.s3.gen), { force: true });
      await fs.promises.rm(tailPath(session.id, session.s3.gen - 1), { force: true });
    }
  }

  function rememberHeader(session: Session, chunk: Buffer, offset: number) {
    if (session.sniffed || offset > 64) return;
    const have = Buffer.from(session.headerB64 ?? '', 'base64');
    const merged = Buffer.concat([have, chunk]).subarray(0, 64);
    session.headerB64 = merged.toString('base64');
  }

  function checkHeader(session: Session) {
    if (session.sniffed) return;
    const header = Buffer.from(session.headerB64 ?? '', 'base64');
    if (header.length < 64 && session.received < session.size) return;
    if (!mimeMatchesSniff(session.mimeType, sniffMime(header.length ? header : Buffer.alloc(0)))) {
      throw new ApiError(400, 'File content does not match declared type');
    }
    session.sniffed = true;
  }

  async function spillS3(session: Session, storage: StorageDriver) {
    if (!session.s3 || !storage.uploadPart) return;
    let tail = await readTail(session);
    while (tail.length >= partBytes) {
      const part = tail.subarray(0, partBytes);
      const rest = Buffer.from(tail.subarray(partBytes));
      const partNumber = session.s3.parts.length + 1;
      const etag = await storage.uploadPart(session.key, session.s3.uploadId, partNumber, part);
      session.s3.parts.push({ partNumber, etag });
      tail = rest;
      await replaceTail(session, tail);
    }
  }

  async function applyChunk(session: Session, chunk: Buffer) {
    const storage = deps.getStorage();
    if (storage.name !== session.backend) throw new ApiError(409, 'Storage changed while this upload was in progress');
    const offset = session.received;

    if (session.backend === 'local') {
      const dest = localPath(session.id);
      const size = await fileSize(dest);
      if (size === offset) {
        const fh = await fs.promises.open(dest, 'r+');
        try {
          await fh.write(chunk, 0, chunk.length, offset);
        } finally {
          await fh.close();
        }
      } else if (size !== offset + chunk.length) {
        throw new ApiError(409, 'Upload file is out of sync. Start the upload again.');
      }
    } else if (session.backend === 'azure') {
      if (!storage.stageBlock) throw new ApiError(500, 'Azure storage cannot accept a large upload');
      const blockId = Buffer.from(offset.toString(16).padStart(16, '0')).toString('base64');
      await storage.stageBlock(session.key, blockId, chunk);
      session.azureBlocks ??= [];
      if (session.azureBlocks.at(-1) !== blockId) session.azureBlocks.push(blockId);
    }

    const tail = session.backend === 's3' ? Buffer.concat([await readTail(session), chunk]) : null;
    rememberHeader(session, chunk, offset);
    session.received = offset + chunk.length;
    try {
      checkHeader(session);
    } catch (err) {
      await discard(session);
      throw err;
    }

    if (session.backend === 's3') {
      // Persists `received` together with the new tail, so a retry does not append twice.
      await replaceTail(session, tail ?? Buffer.alloc(0));
      await spillS3(session, storage);
      return;
    }
    await persist(session);
  }

  return {
    chunkBytes,
    maxBytes,

    async sweep() {
      let names: string[] = [];
      try {
        names = await fs.promises.readdir(deps.partialDir);
      } catch {
        return;
      }
      const expired = now() - TTL_MS;
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const id = name.slice(0, -5);
        if (!/^[a-f0-9]{32}$/.test(id)) continue;
        const session = await load(id);
        if (session && session.createdAt < expired) await discard(session).catch(() => undefined);
      }
    },

    async start(ownerId: string, input: { originalName: string; mimeType: string; size: number }): Promise<LargeUploadStart> {
      await fs.promises.mkdir(deps.partialDir, { recursive: true });
      await this.sweep();
      const size = input.size;
      if (!Number.isSafeInteger(size) || size <= 0) throw new ApiError(400, 'File is empty');
      if (size > maxBytes) throw new ApiError(413, 'File is too large');
      if (size <= directMaxBytes) throw new ApiError(400, 'Use the regular upload for files of this size');
      if (!isAllowedType(input.originalName, input.mimeType)) throw new ApiError(400, 'File type not allowed');

      const storage = deps.getStorage();
      const id = crypto.randomBytes(16).toString('hex');
      const key = newStorageKey(input.originalName);
      const session: Session = {
        id,
        ownerId,
        originalName: path.basename(input.originalName),
        mimeType: input.mimeType,
        size,
        received: 0,
        key,
        backend: storage.name,
        createdAt: now(),
      };

      if (storage.name === 's3') {
        if (!storage.beginMultipart) throw new ApiError(500, 'S3 storage cannot accept a large upload');
        session.s3 = { uploadId: await storage.beginMultipart(key, input.mimeType), parts: [], gen: 0 };
      } else if (storage.name === 'azure') {
        if (!storage.stageBlock || !storage.commitBlocks) throw new ApiError(500, 'Azure storage cannot accept a large upload');
        session.azureBlocks = [];
      } else if (!storage.adoptFile) {
        throw new ApiError(500, 'Storage cannot accept a large upload');
      } else {
        await fs.promises.writeFile(localPath(id), Buffer.alloc(0));
      }

      await persist(session);
      return { id, chunkSize: chunkBytes, maxBytes };
    },

    async write(ownerId: string, id: string, header: string | undefined, chunk: Buffer): Promise<{ received: number; size: number }> {
      assertId(id);
      return lock(id, async () => {
        const session = await load(id);
        if (!session || session.ownerId !== ownerId) throw new ApiError(404, 'Upload not found');
        const range = parseContentRange(header);
        if (range.total !== session.size) throw new ApiError(400, 'Content-Range total does not match the upload');
        const length = range.end - range.start + 1;
        if (chunk.length !== length) throw new ApiError(400, 'Chunk length does not match Content-Range');
        if (chunk.length > chunkBytes) throw new ApiError(413, 'Chunk is too large');
        if (range.end < session.received) return { received: session.received, size: session.size };
        if (range.start !== session.received) throw new ApiError(409, 'Send the next chunk. This upload is in order.');
        await applyChunk(session, chunk);
        return { received: session.received, size: session.size };
      });
    },

    async complete(ownerId: string, id: string): Promise<LargeUploadResult> {
      assertId(id);
      return lock(id, async () => {
        const session = await load(id);
        if (!session || session.ownerId !== ownerId) throw new ApiError(404, 'Upload not found');
        if (session.received !== session.size) throw new ApiError(400, 'Upload is still missing bytes');
        checkHeader(session);
        const storage = deps.getStorage();
        if (storage.name !== session.backend) throw new ApiError(409, 'Storage changed while this upload was in progress');

        if (session.backend === 'local') {
          if (!storage.adoptFile) throw new ApiError(500, 'Storage cannot accept a large upload');
          await storage.adoptFile(session.key, localPath(session.id), session.mimeType);
        } else if (session.backend === 's3') {
          if (!session.s3 || !storage.uploadPart || !storage.completeMultipart) throw new ApiError(500, 'S3 storage cannot accept a large upload');
          const tail = await readTail(session);
          if (tail.length) {
            const partNumber = session.s3.parts.length + 1;
            const etag = await storage.uploadPart(session.key, session.s3.uploadId, partNumber, tail);
            session.s3.parts.push({ partNumber, etag });
            await replaceTail(session, Buffer.alloc(0));
          }
          if (!session.s3.parts.length) throw new ApiError(400, 'Upload had no data');
          await storage.completeMultipart(session.key, session.s3.uploadId, session.s3.parts);
          await fs.promises.rm(tailPath(session.id, session.s3.gen), { force: true });
        } else if (session.backend === 'azure') {
          if (!storage.commitBlocks) throw new ApiError(500, 'Azure storage cannot accept a large upload');
          await storage.commitBlocks(session.key, session.azureBlocks ?? [], session.mimeType);
        }

        await fs.promises.rm(sessionPath(session.id), { force: true });
        return {
          key: session.key,
          url: `/api/uploads/${encodeURIComponent(session.key)}`,
          originalName: session.originalName,
          mimeType: session.mimeType,
          size: session.size,
        };
      });
    },

    async abort(ownerId: string, id: string): Promise<void> {
      assertId(id);
      await lock(id, async () => {
        const session = await load(id);
        if (!session || session.ownerId !== ownerId) throw new ApiError(404, 'Upload not found');
        await discard(session);
      });
    },
  };
}

let singleton: ReturnType<typeof createLargeUploads> | null = null;

export function largeUploads() {
  singleton ??= createLargeUploads({
    partialDir: path.join(process.cwd(), 'uploads', '.partial'),
    getStorage,
  });
  return singleton;
}
