import { env } from '../../config/env';
import { createAzureBlobStorageDriver } from './azureBlobStorage.driver';
import { createLocalStorageDriver } from './localStorage.driver';
import { createS3StorageDriver } from './s3Storage.driver';
import type { StorageDriver, StoredObject } from './storage.types';

export type { StorageDriver, StoredObject, StorageDriverName } from './storage.types';

let active: StorageDriver | null = null;
let localFallback: StorageDriver | null = null;

/** Backend picked from the existing env flags: S3, else Azure Blob, else the local `uploads/` folder. */
function driverFromEnv(): StorageDriver {
  if (env.isS3Enabled) {
    return createS3StorageDriver({
      region: env.s3Region,
      bucket: env.s3Bucket,
      accessKeyId: env.s3AccessKeyId || undefined,
      secretAccessKey: env.s3SecretAccessKey || undefined,
      endpoint: env.s3Endpoint || undefined,
    });
  }
  if (env.isAzureBlobEnabled) {
    return createAzureBlobStorageDriver({
      container: env.azureBlobContainer,
      connectionString: env.azureBlobConnectionString || undefined,
      accountName: env.azureBlobAccountName || undefined,
      accountKey: env.azureBlobAccountKey || undefined,
    });
  }
  return createLocalStorageDriver();
}

export function getStorage(): StorageDriver {
  active ??= driverFromEnv();
  return active;
}

/**
 * Read through the active backend; files uploaded before switching to a cloud
 * backend are still served from local disk.
 */
export async function readStoredObject(key: string): Promise<StoredObject | null> {
  const storage = getStorage();
  const hit = await storage.get(key);
  if (hit || storage.name === 'local') return hit;
  localFallback ??= createLocalStorageDriver();
  return localFallback.get(key);
}

/** Tests: swap the backend (null restores env-based selection). */
export function setStorageForTests(driver: StorageDriver | null): void {
  active = driver;
  localFallback = null;
}
