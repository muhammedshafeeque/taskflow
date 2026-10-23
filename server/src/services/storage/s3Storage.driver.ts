import { Readable } from 'stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { StorageDriver, StoredObject } from './storage.types';

export type S3StorageConfig = {
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  /** S3-compatible endpoint (MinIO, R2, …); enables path-style addressing. */
  endpoint?: string;
  prefix?: string;
};

type S3Like = Pick<S3Client, 'send'>;

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
}

export function createS3StorageDriver(config: S3StorageConfig, client?: S3Like): StorageDriver {
  const s3: S3Like =
    client ??
    new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
      ...(config.accessKeyId && config.secretAccessKey
        ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
        : {}),
    });
  const prefix = config.prefix ?? 'uploads/';
  const Key = (key: string) => `${prefix}${key}`;

  return {
    name: 's3',
    async put(key, body, contentType) {
      await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: Key(key), Body: body, ContentType: contentType }));
    },
    async get(key): Promise<StoredObject | null> {
      try {
        const out = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: Key(key) }));
        if (!out.Body) return null;
        return {
          stream: out.Body as Readable,
          size: out.ContentLength,
          contentType: out.ContentType,
        };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: Key(key) }));
    },
  };
}
