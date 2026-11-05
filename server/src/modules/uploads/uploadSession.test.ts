import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Readable } from 'stream';
import { env } from '../../config/env';
import { setStorageForTests } from '../../services/storage';
import { sendStoredFile } from './files.service';
import { clearUploadSession, hasUploadSession, setUploadSession } from './uploadSession';

const BODY = Buffer.from('0123456789');

const app = express();
app.post('/session', (req, res) => {
  setUploadSession(req, res);
  res.status(204).end();
});
app.delete('/session', (req, res) => {
  clearUploadSession(req, res);
  res.status(204).end();
});
app.get('/check', (req, res) => {
  res.json({ allowed: hasUploadSession(req) });
});
app.get('/file/:key', (req, res, next) => {
  sendStoredFile(res, req.params.key, undefined, req.headers.range).catch(next);
});

describe('upload session cookie', () => {
  it('is HttpOnly, limited to uploads, and grants access', async () => {
    const res = await request(app).post('/session');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/uploads/);
    expect(cookie).toMatch(/SameSite=Lax/i);
    const check = await request(app).get('/check').set('Cookie', cookie.split(';')[0]);
    expect(check.body.allowed).toBe(true);
  });

  it('marks the cookie Secure behind an https proxy', async () => {
    const res = await request(app).post('/session').set('X-Forwarded-Proto', 'https');
    expect(String(res.headers['set-cookie'])).toMatch(/Secure/i);
  });

  it('cannot be used as an access token', async () => {
    const res = await request(app).post('/session');
    const value = /upload_session=([^;]+)/.exec(String(res.headers['set-cookie']))![1];
    expect(() => jwt.verify(value, env.jwtSecret)).toThrow();
  });

  it('rejects missing, forged, and access-token cookies', async () => {
    expect((await request(app).get('/check')).body.allowed).toBe(false);
    const forged = await request(app).get('/check').set('Cookie', 'upload_session=abc');
    expect(forged.body.allowed).toBe(false);
    const accessToken = jwt.sign({ sub: 'u1' }, env.jwtSecret);
    const reused = await request(app).get('/check').set('Cookie', `upload_session=${accessToken}`);
    expect(reused.body.allowed).toBe(false);
  });

  it('expires the cookie on sign-out', async () => {
    const res = await request(app).delete('/session');
    expect(String(res.headers['set-cookie'])).toMatch(/upload_session=;.*Expires=Thu, 01 Jan 1970/i);
  });
});

describe('sendStoredFile ranges', () => {
  beforeEach(() => {
    setStorageForTests({
      name: 's3',
      put: async () => {},
      remove: async () => {},
      get: async () => ({
        // Small chunks so ranges have to cross chunk boundaries.
        stream: Readable.from([BODY.subarray(0, 3), BODY.subarray(3, 7), BODY.subarray(7)]),
        size: BODY.length,
        contentType: 'video/mp4',
      }),
    });
  });
  afterEach(() => setStorageForTests(null));

  const get = (range?: string) => {
    const r = request(app).get('/file/clip.mp4').buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    return range ? r.set('Range', range) : r;
  };

  it('serves the whole file and advertises range support', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.body.toString()).toBe('0123456789');
  });

  it.each([
    ['bytes=2-5', '2345', 'bytes 2-5/10'],
    ['bytes=0-1', '01', 'bytes 0-1/10'],
    ['bytes=7-', '789', 'bytes 7-9/10'],
    ['bytes=-3', '789', 'bytes 7-9/10'],
    ['bytes=8-99', '89', 'bytes 8-9/10'],
  ])('serves %s across chunks', async (range, expected, contentRange) => {
    const res = await get(range);
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(contentRange);
    expect(res.headers['content-length']).toBe(String(expected.length));
    expect(res.body.toString()).toBe(expected);
  });

  it('answers 416 past the end of the file', async () => {
    const res = await get('bytes=50-60');
    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */10');
  });

  it('ignores multi-range requests and serves the whole file', async () => {
    const res = await get('bytes=0-1,4-5');
    expect(res.status).toBe(200);
    expect(res.body.toString()).toBe('0123456789');
  });
});
