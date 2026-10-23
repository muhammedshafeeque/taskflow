import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Shared secret for first-party internal services (the WhatsApp PA) calling the
 * API over the private network. Zero-config: the first of server / PA to boot
 * generates it; the other reads the same file.
 *
 *   ATRIUM_INTERNAL_SECRET       explicit value (e.g. from a secrets manager)
 *   ATRIUM_INTERNAL_SECRET_FILE  file path (docker-compose: shared volume)
 *   default                      <repo>/.atrium-internal/secret (local dev)
 *
 * PA/src/Config/internalSecret.ts mirrors this file — keep the two in sync.
 */
export const INTERNAL_KEY_HEADER = 'x-atrium-internal-key';

const MIN_LENGTH = 32;

let cached: string | null = null;

export function internalSecretFilePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.ATRIUM_INTERNAL_SECRET_FILE?.trim();
  if (configured) return path.resolve(configured);
  // src/config or dist/config → server → repo root
  return path.resolve(__dirname, '..', '..', '..', '.atrium-internal', 'secret');
}

function readSecretFile(file: string): string | null {
  try {
    const value = fs.readFileSync(file, 'utf8').trim();
    return value.length >= MIN_LENGTH ? value : null;
  } catch {
    return null;
  }
}

/**
 * Create the secret file atomically: write a temp file, then hard-link it into
 * place. link() fails with EEXIST if another process won the race, so readers
 * never see a half-written file.
 */
function createSecretFile(file: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const value = crypto.randomBytes(32).toString('hex');
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, value, { mode: 0o600 });
  try {
    fs.linkSync(tmp, file);
    return value;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    const existing = readSecretFile(file);
    if (!existing) throw new Error(`[internal-secret] ${file} exists but is empty or too short`);
    return existing;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function loadOrCreateInternalSecret(env: NodeJS.ProcessEnv = process.env): string {
  if (cached) return cached;
  const explicit = env.ATRIUM_INTERNAL_SECRET?.trim();
  if (explicit) {
    if (explicit.length < MIN_LENGTH) {
      throw new Error(`[internal-secret] ATRIUM_INTERNAL_SECRET must be at least ${MIN_LENGTH} characters`);
    }
    cached = explicit;
    return cached;
  }
  const file = internalSecretFilePath(env);
  cached = readSecretFile(file) ?? createSecretFile(file);
  return cached;
}

/** Test helper. */
export function resetInternalSecretCacheForTests(): void {
  cached = null;
}

export function isValidInternalKey(provided: unknown): boolean {
  if (typeof provided !== 'string' || !provided) return false;
  const expected = Buffer.from(loadOrCreateInternalSecret());
  const actual = Buffer.from(provided.trim());
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
