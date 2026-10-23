import crypto from 'crypto';

const TICKET_TTL_MS = 5 * 60 * 1000;

function b64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/** Short-lived SSE ticket bound to PA_ADMIN_SECRET (not the secret itself). */
export function issueAdminSseTicket(secret: string): {
  ticket: string;
  expiresIn: number;
} {
  const exp = Date.now() + TICKET_TTL_MS;
  const payload = Buffer.from(String(exp), 'utf8');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest();
  return {
    ticket: `sse.${b64url(payload)}.${b64url(sig)}`,
    expiresIn: Math.floor(TICKET_TTL_MS / 1000),
  };
}

export function verifyAdminSseTicket(
  ticket: string,
  secret: string
): boolean {
  if (!ticket.startsWith('sse.')) return false;
  const parts = ticket.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = fromB64url(parts[1]);
    const sig = fromB64url(parts[2]);
    const expected = crypto.createHmac('sha256', secret).update(payload).digest();
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(sig, expected)
    ) {
      return false;
    }
    const exp = Number(payload.toString('utf8'));
    return Number.isFinite(exp) && Date.now() <= exp;
  } catch {
    return false;
  }
}
