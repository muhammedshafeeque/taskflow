import crypto from 'crypto';
import type { Message } from 'whatsapp-web.js';

/**
 * Direct WhatsApp CDN download + decrypt, used when whatsapp-web.js
 * downloadMedia() breaks (WA Web 2026-09 rejects ptt blobs with
 * "Unexpected mimetype application/octet-stream for media type ptt").
 */

const HKDF_INFO: Record<string, string> = {
  image: 'WhatsApp Image Keys',
  sticker: 'WhatsApp Image Keys',
  video: 'WhatsApp Video Keys',
  gif: 'WhatsApp Video Keys',
  ptv: 'WhatsApp Video Keys',
  ptt: 'WhatsApp Audio Keys',
  audio: 'WhatsApp Audio Keys',
  document: 'WhatsApp Document Keys',
};

const CDN_HOST = 'https://mmg.whatsapp.net';
const MAC_LEN = 10;

export type EncryptedMediaRef = {
  mediaKey: string;
  type: string;
  directPath?: string;
  url?: string;
  mimetype?: string;
};

function b64(v: unknown): string | null {
  if (typeof v === 'string' && v) return v;
  if (v instanceof Uint8Array) return Buffer.from(v).toString('base64');
  if (v && typeof v === 'object') {
    // Uint8Array serialized across puppeteer as {0: n, 1: n, ...}
    const bytes = Object.values(v as Record<string, number>);
    if (bytes.length && bytes.every((n) => typeof n === 'number')) {
      return Buffer.from(bytes).toString('base64');
    }
  }
  return null;
}

/** Pull the encrypted-media fields off the raw message; null when unavailable. */
export function encryptedMediaRef(msg: Message): EncryptedMediaRef | null {
  const raw = (msg.rawData ?? {}) as Record<string, unknown>;
  const mediaKey = b64(raw.mediaKey);
  const directPath = typeof raw.directPath === 'string' ? raw.directPath : undefined;
  const url =
    typeof raw.clientUrl === 'string'
      ? raw.clientUrl
      : typeof raw.deprecatedMms3Url === 'string'
        ? raw.deprecatedMms3Url
        : undefined;
  if (!mediaKey || (!directPath && !url)) return null;
  return {
    mediaKey,
    type: String(raw.type || msg.type),
    directPath,
    url,
    mimetype: typeof raw.mimetype === 'string' ? raw.mimetype : undefined,
  };
}

/** Decrypt a WhatsApp media blob: HKDF-SHA256 → AES-256-CBC, HMAC-SHA256 checked. */
export function decryptMediaBuffer(
  body: Buffer,
  mediaKeyB64: string,
  type: string
): Buffer {
  const info = HKDF_INFO[type];
  if (!info) throw new Error(`No media keys for type "${type}"`);
  const expanded = Buffer.from(
    crypto.hkdfSync(
      'sha256',
      Buffer.from(mediaKeyB64, 'base64'),
      Buffer.alloc(0),
      info,
      112
    )
  );
  const iv = expanded.subarray(0, 16);
  const cipherKey = expanded.subarray(16, 48);
  const macKey = expanded.subarray(48, 80);

  if (body.length <= MAC_LEN) throw new Error('Media body too short');
  const enc = body.subarray(0, -MAC_LEN);
  const mac = crypto
    .createHmac('sha256', macKey)
    .update(Buffer.concat([iv, enc]))
    .digest()
    .subarray(0, MAC_LEN);
  if (!crypto.timingSafeEqual(mac, body.subarray(-MAC_LEN))) {
    throw new Error('Media MAC mismatch');
  }
  const decipher = crypto.createDecipheriv('aes-256-cbc', cipherKey, iv);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

export async function downloadAndDecrypt(
  ref: EncryptedMediaRef,
  fetchImpl: typeof fetch = fetch
): Promise<Buffer> {
  const urls = [
    ref.directPath ? `${CDN_HOST}${ref.directPath}` : null,
    ref.url ?? null,
  ].filter((u): u is string => Boolean(u));

  let lastErr: unknown;
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, {
        headers: { Origin: 'https://web.whatsapp.com' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`CDN responded ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      return decryptMediaBuffer(body, ref.mediaKey, ref.type);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('No media URL');
}
