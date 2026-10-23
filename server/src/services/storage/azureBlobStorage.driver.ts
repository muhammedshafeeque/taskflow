import { Readable } from 'stream';
import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  type ContainerClient,
} from '@azure/storage-blob';
import type { StorageDriver, StoredObject } from './storage.types';

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
    async get(key): Promise<StoredObject | null> {
      try {
        const res = await blob(key).download();
        if (!res.readableStreamBody) return null;
        return {
          stream: res.readableStreamBody as Readable,
          size: res.contentLength,
          contentType: res.contentType,
        };
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 404) return null;
        throw err;
      }
    },
    async remove(key) {
      await blob(key).deleteIfExists();
    },
  };
}
