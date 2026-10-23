import fs from 'fs';
import path from 'path';
import type { StorageDriver, StoredObject } from './storage.types';

/** Files on the API's own disk (`uploads/`, a docker volume in production). */
export function createLocalStorageDriver(root = path.join(process.cwd(), 'uploads')): StorageDriver {
  const base = path.resolve(root);
  const resolve = (key: string) => {
    const full = path.resolve(base, path.basename(key));
    if (!full.startsWith(base + path.sep)) throw new Error('Invalid storage key');
    return full;
  };

  return {
    name: 'local',
    async put(key, body) {
      await fs.promises.mkdir(base, { recursive: true });
      await fs.promises.writeFile(resolve(key), body);
    },
    async get(key): Promise<StoredObject | null> {
      const full = resolve(key);
      try {
        const stat = await fs.promises.stat(full);
        if (!stat.isFile()) return null;
        return { stream: fs.createReadStream(full), size: stat.size };
      } catch {
        return null;
      }
    },
    async remove(key) {
      await fs.promises.rm(resolve(key), { force: true });
    },
  };
}
