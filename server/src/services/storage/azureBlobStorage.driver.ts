import { Readable } from 'stream';
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  type ContainerClient,
} from '@azure/storage-blob';
import type { ByteRange, StorageDriver, StoredObject } from './storage.types';

export type AzureBlobStorageConfig = {
  container: string;
  connectionString?: string;
  accountName?: string;
  accountKey?: string;
  prefix?: string;
};

type ContainerLike = Pick<ContainerClient, 'createIfNotExists' | 'getBlockBlobClient'>;

function containerFromConfig(config: AzureBlobStorageConfig): ContainerClient {
  const service = config.connectionString
    ? BlobServiceClient.fromConnectionString(config.connectionString)
    : new BlobServiceClient(
        `https://${config.accountName}.blob.core.windows.net`,
        new StorageSharedKeyCredential(String(config.accountName), String(config.accountKey))
      );
  return service.getContainerClient(config.container);
}

/** `bytes start-end/total` → total. */
function rangeTotal(header: string | undefined): number | undefined {
  const total = /\/(\d+)\s*$/.exec(header ?? '')?.[1];
  return total ? Number(total) : undefined;
}

export function createAzureBlobStorageDriver(config: AzureBlobStorageConfig, container?: ContainerLike): StorageDriver {
  const client: ContainerLike = container ?? containerFromConfig(config);
  const prefix = config.prefix ?? 'uploads/';
  let ensured: Promise<unknown> | null = null;
  const blob = (key: string) => client.getBlockBlobClient(`${prefix}${key}`);

  return {
    name: 'azure',
    async put(key, body, contentType) {
      ensured ??= client.createIfNotExists();
      await ensured;
      await blob(key).uploadData(body, { blobHTTPHeaders: { blobContentType: contentType } });
    },
    async head(key) {
      try {
        const props = await blob(key).getProperties();
        return { size: props.contentLength ?? 0, contentType: props.contentType };
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 404) return null;
        throw err;
      }
    },
    async get(key, range?: ByteRange): Promise<StoredObject | null> {
      try {
        const count = range ? range.end - range.start + 1 : undefined;
        const res = await blob(key).download(range?.start, count);
        if (!res.readableStreamBody) return null;
        const total = range ? rangeTotal(res.contentRange) : undefined;
        return {
          stream: res.readableStreamBody as Readable,
          size: total ?? res.contentLength,
          contentType: res.contentType,
          ranged: Boolean(range),
        };
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 404) return null;
        throw err;
      }
    },
    async remove(key) {
      await blob(key).deleteIfExists();
    },
    async stageBlock(key, blockId, body) {
      ensured ??= client.createIfNotExists();
      await ensured;
      await blob(key).stageBlock(blockId, body, body.length);
    },
    async commitBlocks(key, blockIds, contentType) {
      ensured ??= client.createIfNotExists();
      await ensured;
      await blob(key).commitBlockList(blockIds, { blobHTTPHeaders: { blobContentType: contentType } });
    },
  };
}
