import { base32Decode, base32Encode, hotp, verifyTotp } from './totp';

describe('totp', () => {
  // RFC 4226 test vector: secret "12345678901234567890"
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('round-trips base32', () => {
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });
  it('matches RFC 4226 HOTP vectors', () => {
    expect(hotp(secret, 0)).toBe('755224');
    expect(hotp(secret, 1)).toBe('287082');
    expect(hotp(secret, 9)).toBe('520489');
  });
  it('verifies within the drift window only', () => {
    const now = 59_000; // counter 1
    expect(verifyTotp(secret, hotp(secret, 1), now)).toBe(true);
    expect(verifyTotp(secret, hotp(secret, 2), now)).toBe(true);
    expect(verifyTotp(secret, hotp(secret, 4), now)).toBe(false);
    expect(verifyTotp(secret, 'abc', now)).toBe(false);
  });
});
