import type { Readable } from 'stream';

export type StorageDriverName = 'local' | 's3' | 'azure';

export type StoredObject = {
  stream: Readable;
  size?: number;
  contentType?: string;
};

/**
 * Where uploaded files live. Callers (uploads routes, ADO sync, the PA file
 * endpoints) only use this interface, so the backend is a deployment choice.
 * Keys are flat filenames (see uploads/fileValidation.newStorageKey).
 */
export interface StorageDriver {
  readonly name: StorageDriverName;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** null when the object does not exist. */
  get(key: string): Promise<StoredObject | null>;
  remove(key: string): Promise<void>;
}
