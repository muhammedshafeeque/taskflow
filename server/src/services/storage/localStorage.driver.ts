import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import type { ByteRange, StorageDriver, StoredObject } from './storage.types';

/** Files on the API's own disk (`uploads/`, a docker volume in production). */
export function createLocalStorageDriver(root = path.join(process.cwd(), 'uploads')): StorageDriver {
  const base = path.resolve(root);
  const resolve = (key: string) => {
    const full = path.resolve(base, path.basename(key));
    if (!full.startsWith(base + path.sep)) throw new Error('Invalid storage key');
    return full;
  };

  async function statFile(key: string) {
    try {
      const stat = await fs.promises.stat(resolve(key));
      if (!stat.isFile()) return null;
      return stat;
    } catch {
      return null;
    }
  }

  return {
    name: 'local',
    async put(key, body) {
      await fs.promises.mkdir(base, { recursive: true });
      await fs.promises.writeFile(resolve(key), body);
    },
    async head(key) {
      const stat = await statFile(key);
      return stat ? { size: stat.size } : null;
    },
    async get(key, range?: ByteRange): Promise<StoredObject | null> {
      const stat = await statFile(key);
      if (!stat) return null;
      const stream = fs.createReadStream(resolve(key), range ? { start: range.start, end: range.end } : undefined);
      return { stream, size: stat.size, ranged: Boolean(range) };
    },
    async remove(key) {
      await fs.promises.rm(resolve(key), { force: true });
    },
    async adoptFile(key, absolutePath) {
      await fs.promises.mkdir(base, { recursive: true });
      const dest = resolve(key);
      try {
        await fs.promises.rename(absolutePath, dest);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
        await pipeline(fs.createReadStream(absolutePath), fs.createWriteStream(dest));
        await fs.promises.unlink(absolutePath);
      }
    },
  };
}
