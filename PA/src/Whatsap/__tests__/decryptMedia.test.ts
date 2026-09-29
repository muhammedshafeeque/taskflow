import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import type { Message } from 'whatsapp-web.js';
import {
  decryptMediaBuffer,
  downloadAndDecrypt,
  encryptedMediaRef,
} from '../../Media/decryptMedia';

/** Encrypt the way WhatsApp does, so decrypt can be checked end to end. */
function encryptLikeWhatsApp(plain: Buffer, info: string) {
  const mediaKey = crypto.randomBytes(32);
  const ex = Buffer.from(
    crypto.hkdfSync('sha256', mediaKey, Buffer.alloc(32), info, 112)
  );
  const iv = ex.subarray(0, 16);
  const c = crypto.createCipheriv('aes-256-cbc', ex.subarray(16, 48), iv);
  const enc = Buffer.concat([c.update(plain), c.final()]);
  const mac = crypto
    .createHmac('sha256', ex.subarray(48, 80))
    .update(Buffer.concat([iv, enc]))
    .digest()
    .subarray(0, 10);
  return { body: Buffer.concat([enc, mac]), mediaKey: mediaKey.toString('base64') };
}

describe('WhatsApp media decrypt', () => {
  const plain = Buffer.from('OggS voice note payload '.repeat(40));

  it('round-trips a voice note', () => {
    const { body, mediaKey } = encryptLikeWhatsApp(plain, 'WhatsApp Audio Keys');
    assert.deepEqual(decryptMediaBuffer(body, mediaKey, 'ptt'), plain);
  });

  it('rejects tampered media', () => {
    const { body, mediaKey } = encryptLikeWhatsApp(plain, 'WhatsApp Audio Keys');
    body[3] ^= 1;
    assert.throws(() => decryptMediaBuffer(body, mediaKey, 'ptt'), /MAC mismatch/);
  });

  it('downloads from the CDN directPath, falling back to the client url', async () => {
    const { body, mediaKey } = encryptLikeWhatsApp(plain, 'WhatsApp Audio Keys');
    const seen: string[] = [];
    const fakeFetch = (async (url: string) => {
      seen.push(url);
      if (url.startsWith('https://mmg.whatsapp.net')) {
        return { ok: false, status: 403 } as Response;
      }
      return { ok: true, arrayBuffer: async () => body } as unknown as Response;
    }) as typeof fetch;

    const out = await downloadAndDecrypt(
      { mediaKey, type: 'ptt', directPath: '/v/t62/abc.enc', url: 'https://mmg.example/abc' },
      fakeFetch
    );
    assert.deepEqual(out, plain);
    assert.deepEqual(seen, ['https://mmg.whatsapp.net/v/t62/abc.enc', 'https://mmg.example/abc']);
  });

  it('reads the media key from raw message data', () => {
    const msg = {
      type: 'ptt',
      rawData: { mediaKey: 'a2V5', directPath: '/v/x', mimetype: 'audio/ogg; codecs=opus', type: 'ptt' },
    } as unknown as Message;
    assert.deepEqual(encryptedMediaRef(msg), {
      mediaKey: 'a2V5',
      type: 'ptt',
      directPath: '/v/x',
      url: undefined,
      mimetype: 'audio/ogg; codecs=opus',
    });
    assert.equal(encryptedMediaRef({ type: 'ptt', rawData: {} } as unknown as Message), null);
  });
});
