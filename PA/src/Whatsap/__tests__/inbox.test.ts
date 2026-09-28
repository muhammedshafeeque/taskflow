import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createInbox, createLimiter } from '../inbox';
import { mergeResolvedContents, splitRunsByAuthor } from '../handler';

type Msg = { id: string; chat: string; ts?: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makeInbox(
  overrides: Partial<Parameters<typeof createInbox<Msg>>[0]> = {}
) {
  const batches: Array<{ key: string; ids: string[] }> = [];
  const inbox = createInbox<Msg>({
    keyOf: (m) => m.chat,
    idOf: (m) => m.id,
    timestampOf: (m) => m.ts,
    process: async (key, batch) => {
      batches.push({ key, ids: batch.map((m) => m.id) });
    },
    windowMs: 30,
    maxWaitMs: 200,
    maxConcurrent: 4,
    maxAgeSec: 600,
    ...overrides,
  });
  return { inbox, batches };
}

describe('inbox batching', () => {
  it('merges a burst from one chat into a single batch', async () => {
    const { inbox, batches } = makeInbox();
    inbox.push({ id: 'a', chat: 'c1' });
    await sleep(10);
    inbox.push({ id: 'b', chat: 'c1' });
    inbox.push({ id: 'c', chat: 'c1' });
    await inbox.drain();
    assert.deepEqual(batches, [{ key: 'c1', ids: ['a', 'b', 'c'] }]);
  });

  it('keeps chats separate', async () => {
    const { inbox, batches } = makeInbox();
    inbox.push({ id: 'a', chat: 'c1' });
    inbox.push({ id: 'b', chat: 'c2' });
    await inbox.drain();
    assert.equal(batches.length, 2);
  });

  it('drops duplicate message ids', async () => {
    const { inbox, batches } = makeInbox();
    assert.equal(inbox.push({ id: 'a', chat: 'c1' }), 'accepted');
    assert.equal(inbox.push({ id: 'a', chat: 'c1' }), 'duplicate');
    await inbox.drain();
    assert.deepEqual(batches[0].ids, ['a']);
  });

  it('drops stale backlog', () => {
    const { inbox } = makeInbox();
    const old = Math.floor(Date.now() / 1000) - 3600;
    assert.equal(inbox.push({ id: 'a', chat: 'c1', ts: old }), 'stale');
    assert.equal(inbox.pendingSize(), 0);
  });

  it('caps a continuous burst at maxWaitMs', async () => {
    const { inbox, batches } = makeInbox({ windowMs: 50, maxWaitMs: 80 });
    for (let i = 0; i < 6; i++) {
      inbox.push({ id: `m${i}`, chat: 'c1' });
      await sleep(25);
    }
    await inbox.drain();
    assert.ok(batches.length >= 2, 'burst should be split by maxWait');
    assert.deepEqual(
      batches.flatMap((b) => b.ids),
      ['m0', 'm1', 'm2', 'm3', 'm4', 'm5']
    );
  });

  it('queues messages that arrive while a chat is busy — none are lost', async () => {
    const batches: string[][] = [];
    const inbox = createInbox<Msg>({
      keyOf: (m) => m.chat,
      idOf: (m) => m.id,
      timestampOf: () => undefined,
      process: async (_k, batch) => {
        batches.push(batch.map((m) => m.id));
        await sleep(60);
      },
      windowMs: 10,
      maxWaitMs: 100,
      maxConcurrent: 2,
      maxAgeSec: 0,
    });
    inbox.push({ id: 'a', chat: 'c1' });
    await sleep(25);
    assert.equal(inbox.push({ id: 'b', chat: 'c1' }), 'queued');
    assert.equal(inbox.push({ id: 'c', chat: 'c1' }), 'queued');
    await inbox.drain();
    assert.deepEqual(batches, [['a'], ['b', 'c']]);
  });
});

describe('limiter', () => {
  it('never exceeds max concurrency', async () => {
    const limiter = createLimiter(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        limiter.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await sleep(5);
          active--;
        })
      )
    );
    assert.equal(peak, 2);
    assert.equal(limiter.active, 0);
  });
});

describe('burst merge', () => {
  it('joins text in order and prefers Malayalam when any part is ml', () => {
    const merged = mergeResolvedContents([
      { text: 'hi', source: 'text', lang: 'en' },
      null,
      { text: 'ഒരു ആപ്പ് വേണം', source: 'voice', lang: 'ml' },
    ]);
    assert.deepEqual(merged, {
      text: 'hi\nഒരു ആപ്പ് വേണം',
      source: 'voice',
      lang: 'ml',
    });
  });

  it('flags a bare image only when nothing else has text', () => {
    const bare = { text: '', source: 'image' as const, lang: 'en' as const, imageNeedsDescription: true };
    assert.equal(mergeResolvedContents([bare])?.imageNeedsDescription, true);
    const withText = mergeResolvedContents([
      bare,
      { text: 'login page broken', source: 'text', lang: 'en' },
    ]);
    assert.equal(withText?.imageNeedsDescription, undefined);
    assert.match(withText!.text, /login page broken\n\(Also sent an image/);
  });

  it('returns null for empty batches', () => {
    assert.equal(mergeResolvedContents([null, null]), null);
  });

  it('splits group batches by consecutive author', () => {
    const runs = splitRunsByAuthor([
      { from: 'g', author: 'u1' },
      { from: 'g', author: 'u1' },
      { from: 'g', author: 'u2' },
      { from: 'g', author: 'u1' },
    ]);
    assert.deepEqual(
      runs.map((r) => r.length),
      [2, 1, 1]
    );
  });
});
