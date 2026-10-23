import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough, Readable } from 'stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createLocalStorageDriver } from './localStorage.driver';
import { createS3StorageDriver } from './s3Storage.driver';
import { createAzureBlobStorageDriver } from './azureBlobStorage.driver';
import type { StorageDriver } from './storage.types';

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

/** Same behaviour contract for every backend. */
async function roundTrip(driver: StorageDriver) {
  const body = Buffer.from('hello from whatsapp');
  await driver.put('1-abc.txt', body, 'text/plain');
  const got = await driver.get('1-abc.txt');
  expect(got).not.toBeNull();
  expect(await readAll(got!.stream)).toEqual(body);
  expect(await driver.get('missing.txt')).toBeNull();
  await driver.remove('1-abc.txt');
  expect(await driver.get('1-abc.txt')).toBeNull();
}

describe('local storage driver', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-uploads-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('uploads, downloads and deletes', async () => {
    await roundTrip(createLocalStorageDriver(dir));
  });

  it('never escapes its folder', async () => {
    const driver = createLocalStorageDriver(dir);
    await driver.put('../../escape.txt', Buffer.from('x'), 'text/plain');
    expect(fs.existsSync(path.join(dir, 'escape.txt'))).toBe(true);
    expect(fs.existsSync(path.join(dir, '..', '..', 'escape.txt'))).toBe(false);
  });
});

describe('S3 storage driver', () => {
  it('uploads, downloads and deletes through the S3 API', async () => {
    const objects = new Map<string, Buffer>();
    const send = jest.fn(async (cmd: unknown) => {
      if (cmd instanceof PutObjectCommand) {
        objects.set(String(cmd.input.Key), cmd.input.Body as Buffer);
        return {};
      }
      if (cmd instanceof GetObjectCommand) {
        const body = objects.get(String(cmd.input.Key));
        if (!body) throw Object.assign(new Error('nope'), { name: 'NoSuchKey' });
        const stream = new PassThrough();
        stream.end(body);
        return { Body: stream, ContentLength: body.length, ContentType: 'text/plain' };
      }
      if (cmd instanceof DeleteObjectCommand) {
        objects.delete(String(cmd.input.Key));
        return {};
      }
      throw new Error('unexpected command');
    });
    const driver = createS3StorageDriver({ region: 'us-east-1', bucket: 'atrium' }, { send } as never);
    await roundTrip(driver);
    const put = send.mock.calls.find(([c]) => c instanceof PutObjectCommand)?.[0] as PutObjectCommand;
    expect(put.input).toMatchObject({ Bucket: 'atrium', Key: 'uploads/1-abc.txt', ContentType: 'text/plain' });
  });

  it('surfaces real S3 errors instead of hiding them as "not found"', async () => {
    const driver = createS3StorageDriver({ region: 'x', bucket: 'b' }, {
      send: async () => {
        throw Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } });
      },
    } as never);
    await expect(driver.get('k.txt')).rejects.toThrow('denied');
  });
});

describe('Azure Blob storage driver', () => {
  it('uploads, downloads and deletes through the Blob API', async () => {
    const blobs = new Map<string, { body: Buffer; type?: string }>();
    const createIfNotExists = jest.fn(async () => ({}));
    const container = {
      createIfNotExists,
      getBlockBlobClient: (name: string) => ({
        uploadData: async (body: Buffer, opts?: { blobHTTPHeaders?: { blobContentType?: string } }) => {
          blobs.set(name, { body, type: opts?.blobHTTPHeaders?.blobContentType });
        },
        download: async () => {
          const hit = blobs.get(name);
          if (!hit) throw Object.assign(new Error('BlobNotFound'), { statusCode: 404 });
          const stream = new PassThrough();
          stream.end(hit.body);
          return { readableStreamBody: stream, contentLength: hit.body.length, contentType: hit.type };
        },
        deleteIfExists: async () => {
          blobs.delete(name);
        },
      }),
    };
    await roundTrip(createAzureBlobStorageDriver({ container: 'atrium' }, container as never));
    expect(createIfNotExists).toHaveBeenCalledTimes(1);
  });
});
