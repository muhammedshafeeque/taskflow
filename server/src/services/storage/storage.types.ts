import type { Readable } from 'stream';

export type StorageDriverName = 'local' | 's3' | 'azure';

export type ByteRange = { start: number; end: number };

export type ObjectStat = { size: number; contentType?: string };

export type StoredObject = {
  stream: Readable;
  /** Full object size, including when `stream` is only a byte range. */
  size?: number;
  contentType?: string;
  /** True when `stream` already begins at the requested range. */
  ranged?: boolean;
};

export type MultipartPart = { partNumber: number; etag: string };

/**
 * Where uploaded files live. Callers (uploads routes, ADO sync, the PA file
 * endpoints) only use this interface, so the backend is a deployment choice.
 * Keys are flat filenames (see uploads/fileValidation.newStorageKey).
 */
export interface StorageDriver {
  readonly name: StorageDriverName;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** null when the object does not exist. Pass `range` to seek without reading earlier bytes. */
  get(key: string, range?: ByteRange): Promise<StoredObject | null>;
  /** Size without opening the body. null when the object does not exist. */
  head?(key: string): Promise<ObjectStat | null>;
  remove(key: string): Promise<void>;
  /** Move a finished file into storage without reading it into memory. */
  adoptFile?(key: string, absolutePath: string, contentType: string): Promise<void>;
  beginMultipart?(key: string, contentType: string): Promise<string>;
  uploadPart?(key: string, uploadId: string, partNumber: number, body: Buffer): Promise<string>;
  completeMultipart?(key: string, uploadId: string, parts: MultipartPart[]): Promise<void>;
  abortMultipart?(key: string, uploadId: string): Promise<void>;
  stageBlock?(key: string, blockId: string, body: Buffer): Promise<void>;
  commitBlocks?(key: string, blockIds: string[], contentType: string): Promise<void>;
}
