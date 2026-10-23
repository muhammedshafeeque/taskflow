import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  internalSecretFilePath,
  isValidInternalKey,
  loadOrCreateInternalSecret,
  resetInternalSecretCacheForTests,
} from './internalSecret';

describe('internal secret (zero-config boot)', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atrium-internal-'));
    env = { ATRIUM_INTERNAL_SECRET_FILE: path.join(dir, 'nested', 'secret') };
    resetInternalSecretCacheForTests();
  });

  afterEach(() => {
    resetInternalSecretCacheForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('generates a 256-bit key on first boot, private to the owner', () => {
    const secret = loadOrCreateInternalSecret(env);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const file = String(env.ATRIUM_INTERNAL_SECRET_FILE);
    expect(fs.readFileSync(file, 'utf8')).toBe(secret);
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    // No temp files left behind.
    expect(fs.readdirSync(path.dirname(file))).toEqual(['secret']);
  });

  it('reuses the key on the next boot (and across server/PA processes)', () => {
    const first = loadOrCreateInternalSecret(env);
    resetInternalSecretCacheForTests();
    expect(loadOrCreateInternalSecret(env)).toBe(first);
  });

  it('adopts a key another process already wrote', () => {
    const file = String(env.ATRIUM_INTERNAL_SECRET_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'a'.repeat(64));
    expect(loadOrCreateInternalSecret(env)).toBe('a'.repeat(64));
  });

  it('prefers an explicit ATRIUM_INTERNAL_SECRET and rejects short ones', () => {
    expect(loadOrCreateInternalSecret({ ...env, ATRIUM_INTERNAL_SECRET: 'b'.repeat(40) })).toBe('b'.repeat(40));
    expect(fs.existsSync(String(env.ATRIUM_INTERNAL_SECRET_FILE))).toBe(false);
    resetInternalSecretCacheForTests();
    expect(() => loadOrCreateInternalSecret({ ATRIUM_INTERNAL_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('defaults to <repo>/.atrium-internal/secret for local dev', () => {
    expect(internalSecretFilePath({})).toBe(path.resolve(__dirname, '..', '..', '..', '.atrium-internal', 'secret'));
  });

  it('compares keys in constant time and rejects anything else', () => {
    const secret = loadOrCreateInternalSecret(env);
    expect(isValidInternalKey(secret)).toBe(true);
    expect(isValidInternalKey(`${secret}x`)).toBe(false);
    expect(isValidInternalKey('')).toBe(false);
    expect(isValidInternalKey(undefined)).toBe(false);
  });
});
