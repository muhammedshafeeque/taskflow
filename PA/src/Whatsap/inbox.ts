/**
 * Per-chat inbox: dedupes events, drops stale backlog, debounces message
 * bursts into one batch, serializes work per chat and caps global concurrency.
 */

export type InboxPushResult = 'accepted' | 'queued' | 'duplicate' | 'stale';

export type InboxOptions<T> = {
  keyOf: (item: T) => string;
  idOf: (item: T) => string;
  /** Unix seconds; 0/undefined disables the stale check for that item. */
  timestampOf: (item: T) => number | undefined;
  process: (key: string, batch: T[]) => Promise<void>;
  /** Quiet period after the last message before a batch is flushed. */
  windowMs: number;
  /** Upper bound a batch can be held open by a continuous burst. */
  maxWaitMs: number;
  maxConcurrent: number;
  /** Ignore messages older than this (0 = never). */
  maxAgeSec: number;
  now?: () => number;
};

type Slot<T> = {
  items: T[];
  timer?: NodeJS.Timeout;
  firstAt: number;
  lastAt: number;
  busy: boolean;
};

const SEEN_CAP = 5000;

export function createLimiter(max: number) {
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    async run<R>(fn: () => Promise<R>): Promise<R> {
      if (active >= max) {
        // Slot is handed over directly by the releasing task
        await new Promise<void>((resolve) => waiters.push(resolve));
      } else {
        active++;
      }
      try {
        return await fn();
      } finally {
        const next = waiters.shift();
        if (next) next();
        else active--;
      }
    },
    get active() {
      return active;
    },
    get waiting() {
      return waiters.length;
    },
  };
}

export function createInbox<T>(opts: InboxOptions<T>) {
  const now = opts.now ?? Date.now;
  const slots = new Map<string, Slot<T>>();
  const seen = new Map<string, true>();
  const limiter = createLimiter(Math.max(1, opts.maxConcurrent));
  const inFlight = new Set<Promise<void>>();

  function remember(id: string): boolean {
    if (seen.has(id)) return false;
    seen.set(id, true);
    if (seen.size > SEEN_CAP) {
      const oldest = seen.keys().next().value;
      if (oldest !== undefined) seen.delete(oldest);
    }
    return true;
  }

  function schedule(key: string, slot: Slot<T>) {
    if (slot.timer) clearTimeout(slot.timer);
    const due = Math.min(
      slot.lastAt + opts.windowMs,
      slot.firstAt + opts.maxWaitMs
    );
    const wait = Math.max(0, due - now());
    slot.timer = setTimeout(() => {
      slot.timer = undefined;
      const p = flush(key);
      inFlight.add(p);
      void p.finally(() => inFlight.delete(p));
    }, wait);
  }

  async function flush(key: string): Promise<void> {
    const slot = slots.get(key);
    if (!slot || slot.busy || !slot.items.length) return;
    slot.busy = true;
    const batch = slot.items.splice(0);
    slot.firstAt = 0;
    slot.lastAt = 0;
    try {
      await limiter.run(() => opts.process(key, batch));
    } catch (err) {
      console.error('Inbox batch failed', { key, size: batch.length }, err);
    } finally {
      slot.busy = false;
      if (slot.items.length) schedule(key, slot);
      else slots.delete(key);
    }
  }

  return {
    push(item: T): InboxPushResult {
      const id = opts.idOf(item);
      if (id && !remember(id)) return 'duplicate';

      const ts = opts.timestampOf(item);
      if (opts.maxAgeSec > 0 && ts && now() / 1000 - ts > opts.maxAgeSec) {
        return 'stale';
      }

      const key = opts.keyOf(item);
      let slot = slots.get(key);
      if (!slot) {
        slot = { items: [], firstAt: 0, lastAt: 0, busy: false };
        slots.set(key, slot);
      }
      const t = now();
      slot.items.push(item);
      if (!slot.firstAt) slot.firstAt = t;
      slot.lastAt = t;

      // While busy, items wait; the running batch reschedules them on finish.
      if (slot.busy) return 'queued';
      schedule(key, slot);
      return 'accepted';
    },

    pendingSize(): number {
      let n = 0;
      for (const s of slots.values()) n += s.items.length;
      return n;
    },

    /** Resolve once every scheduled and running batch has finished. */
    async drain(): Promise<void> {
      while (inFlight.size || [...slots.values()].some((s) => s.timer)) {
        if (inFlight.size) await Promise.all([...inFlight]);
        else await new Promise((r) => setTimeout(r, 5));
      }
    },

    reset(): void {
      for (const s of slots.values()) if (s.timer) clearTimeout(s.timer);
      slots.clear();
      seen.clear();
    },
  };
}
