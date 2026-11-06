import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import { createLocalStorageDriver } from '../../services/storage/localStorage.driver';
import type { MultipartPart, StorageDriver } from '../../services/storage/storage.types';
import { createLargeUploads } from './largeUpload.service';

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

function text(n: number) {
  return Buffer.from('a'.repeat(n));
}

describe('large uploads', () => {
  let partial: string;
  let stored: string;

  beforeEach(() => {
    partial = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-partial-'));
    stored = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-stored-'));
  });
  afterEach(() => {
    fs.rmSync(partial, { recursive: true, force: true });
    fs.rmSync(stored, { recursive: true, force: true });
  });

  it('writes a local file in order and ignores a retried chunk', async () => {
    const uploads = createLargeUploads({
      partialDir: partial,
      getStorage: () => createLocalStorageDriver(stored),
      chunkBytes: 30,
      directMaxBytes: 0,
    });
    const body = text(80);
    const started = await uploads.start('user-1', { originalName: 'notes.txt', mimeType: 'text/plain', size: body.length });
    await uploads.write('user-1', started.id, `bytes 0-29/${body.length}`, body.subarray(0, 30));
    await uploads.write('user-1', started.id, `bytes 0-29/${body.length}`, body.subarray(0, 30));
    await uploads.write('user-1', started.id, `bytes 30-59/${body.length}`, body.subarray(30, 60));
    await uploads.write('user-1', started.id, `bytes 60-79/${body.length}`, body.subarray(60));
    const saved = await uploads.complete('user-1', started.id);
    const got = await createLocalStorageDriver(stored).get(saved.key);
    expect(got).not.toBeNull();
    expect(await readAll(got!.stream)).toEqual(body);
    expect(saved.size).toBe(body.length);
    expect(saved.url).toContain('/api/uploads/');
  });

  it('refuses a chunk from someone else and a gap', async () => {
    const uploads = createLargeUploads({
      partialDir: partial,
      getStorage: () => createLocalStorageDriver(stored),
      chunkBytes: 64,
      directMaxBytes: 0,
    });
    const body = text(80);
    const started = await uploads.start('user-1', { originalName: 'notes.txt', mimeType: 'text/plain', size: body.length });
    await expect(uploads.write('user-2', started.id, `bytes 0-63/${body.length}`, body.subarray(0, 64))).rejects.toThrow('Upload not found');
    await uploads.write('user-1', started.id, `bytes 0-63/${body.length}`, body.subarray(0, 64));
    await expect(uploads.write('user-1', started.id, `bytes 70-79/${body.length}`, body.subarray(70))).rejects.toThrow('in order');
  });

  it('stops a file whose bytes are not the type it claims', async () => {
    const uploads = createLargeUploads({
      partialDir: partial,
      getStorage: () => createLocalStorageDriver(stored),
      chunkBytes: 80,
      directMaxBytes: 0,
    });
    const body = Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.alloc(76, 0)]);
    const started = await uploads.start('user-1', { originalName: 'notes.txt', mimeType: 'text/plain', size: body.length });
    await expect(uploads.write('user-1', started.id, `bytes 0-79/${body.length}`, body)).rejects.toThrow('does not match');
    await expect(uploads.complete('user-1', started.id)).rejects.toThrow('Upload not found');
  });

  it('sends S3 parts without keeping the whole file', async () => {
    const parts: Buffer[] = [];
    let completed: MultipartPart[] = [];
    const storage: StorageDriver = {
      name: 's3',
      async put() {},
      async get() {
        return null;
      },
      async remove() {},
      async beginMultipart() {
        return 'up-1';
      },
      async uploadPart(_key, _id, partNumber, body) {
        parts.push(Buffer.from(body));
        return `"etag-${partNumber}"`;
      },
      async completeMultipart(_key, _id, list) {
        completed = list;
      },
      async abortMultipart() {},
    };
    const uploads = createLargeUploads({
      partialDir: partial,
      getStorage: () => storage,
      chunkBytes: 6,
      partBytes: 8,
      directMaxBytes: 0,
    });
    const body = text(20);
    const started = await uploads.start('user-1', { originalName: 'notes.txt', mimeType: 'text/plain', size: body.length });
    for (let offset = 0; offset < body.length; offset += 6) {
      const end = Math.min(offset + 6, body.length) - 1;
      await uploads.write('user-1', started.id, `bytes ${offset}-${end}/${body.length}`, body.subarray(offset, end + 1));
    }
    await uploads.complete('user-1', started.id);
    expect(Buffer.concat(parts)).toEqual(body);
    expect(completed.map((p) => p.partNumber)).toEqual([1, 2, 3]);
    expect(parts.map((p) => p.length)).toEqual([8, 8, 4]);
  });

  it('rejects a file past the cap', async () => {
    const uploads = createLargeUploads({
      partialDir: partial,
      getStorage: () => createLocalStorageDriver(stored),
      maxBytes: 100,
      directMaxBytes: 0,
    });
    await expect(uploads.start('user-1', { originalName: 'notes.txt', mimeType: 'text/plain', size: 101 })).rejects.toThrow('too large');
  });
});
