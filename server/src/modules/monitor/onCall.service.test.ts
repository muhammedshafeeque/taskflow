import { currentOnCall, onCallIndex } from './onCall.service';
import mongoose from 'mongoose';

describe('on-call rotation', () => {
  const start = new Date('2026-10-05T00:00:00Z');
  it('rotates every N days and wraps around', () => {
    expect(onCallIndex(start, 7, 3, new Date('2026-10-06T00:00:00Z'))).toBe(0);
    expect(onCallIndex(start, 7, 3, new Date('2026-10-12T00:00:00Z'))).toBe(1);
    expect(onCallIndex(start, 7, 3, new Date('2026-10-26T00:00:00Z'))).toBe(0);
    expect(onCallIndex(start, 1, 2, new Date('2026-10-04T12:00:00Z'))).toBe(1);
  });

  it('reports who is on call and until when', () => {
    const a = new mongoose.Types.ObjectId();
    const b = new mongoose.Types.ObjectId();
    const r = currentOnCall({ enabled: true, userIds: [a, b], rotationDays: 7, startsAt: start }, new Date('2026-10-13T00:00:00Z'));
    expect(r.userId).toBe(String(b));
    expect(r.until?.toISOString()).toBe('2026-10-19T00:00:00.000Z');
    expect(currentOnCall({ enabled: false, userIds: [a], rotationDays: 7, startsAt: start }).userId).toBeNull();
  });
});
