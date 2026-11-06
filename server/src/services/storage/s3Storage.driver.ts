import { Readable } from 'stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import type { ByteRange, StorageDriver, StoredObject } from './storage.types';

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

/** `bytes start-end/total` → total. */
function rangeTotal(header: string | undefined): number | undefined {
  const total = /\/(\d+)\s*$/.exec(header ?? '')?.[1];
  return total ? Number(total) : undefined;
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
    async head(key) {
      try {
        const out = await s3.send(new HeadObjectCommand({ Bucket: config.bucket, Key: Key(key) }));
        return { size: out.ContentLength ?? 0, contentType: out.ContentType };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async get(key, range?: ByteRange): Promise<StoredObject | null> {
      try {
        const out = await s3.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: Key(key),
            ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
          })
        );
        if (!out.Body) return null;
        const total = range ? rangeTotal(out.ContentRange) : undefined;
        return {
          stream: out.Body as Readable,
          size: total ?? out.ContentLength,
          contentType: out.ContentType,
          ranged: Boolean(range),
        };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: Key(key) }));
    },
    async beginMultipart(key, contentType) {
      const out = await s3.send(
        new CreateMultipartUploadCommand({ Bucket: config.bucket, Key: Key(key), ContentType: contentType })
      );
      if (!out.UploadId) throw new Error('S3 did not return an upload id');
      return out.UploadId;
    },
    async uploadPart(key, uploadId, partNumber, body) {
      const out = await s3.send(
        new UploadPartCommand({
          Bucket: config.bucket,
          Key: Key(key),
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body,
          ContentLength: body.length,
        })
      );
      if (!out.ETag) throw new Error('S3 did not return a part etag');
      return out.ETag;
    },
    async completeMultipart(key, uploadId, parts) {
      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: config.bucket,
          Key: Key(key),
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        })
      );
    },
    async abortMultipart(key, uploadId) {
      await s3.send(new AbortMultipartUploadCommand({ Bucket: config.bucket, Key: Key(key), UploadId: uploadId }));
    },
  };
}
