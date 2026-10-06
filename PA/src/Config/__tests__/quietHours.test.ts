import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isQuietNow } from '../quietHours';

const base = { enabled: true, timezone: 'UTC', awayMessage: '' };
const at = (hhmm: string) => new Date(`2026-10-06T${hhmm}:00Z`);

describe('quiet hours', () => {
  it('is off when disabled', () => {
    assert.equal(isQuietNow({ ...base, enabled: false, start: '00:00', end: '23:59' }, at('12:00')), false);
  });

  it('handles same-day windows', () => {
    const qh = { ...base, start: '13:00', end: '14:00' };
    assert.equal(isQuietNow(qh, at('12:59')), false);
    assert.equal(isQuietNow(qh, at('13:00')), true);
    assert.equal(isQuietNow(qh, at('14:00')), false);
  });

  it('handles windows that cross midnight', () => {
    const qh = { ...base, start: '22:00', end: '08:00' };
    assert.equal(isQuietNow(qh, at('23:30')), true);
    assert.equal(isQuietNow(qh, at('03:00')), true);
    assert.equal(isQuietNow(qh, at('08:00')), false);
    assert.equal(isQuietNow(qh, at('12:00')), false);
  });

  it('respects the timezone', () => {
    // 17:00 UTC is 22:30 in Asia/Kolkata (UTC+5:30).
    const qh = { ...base, timezone: 'Asia/Kolkata', start: '22:00', end: '08:00' };
    assert.equal(isQuietNow(qh, at('17:00')), true);
    assert.equal(isQuietNow(qh, at('12:00')), false);
  });

  it('ignores malformed times', () => {
    assert.equal(isQuietNow({ ...base, start: '25:00', end: '08:00' }, at('03:00')), false);
  });
});
