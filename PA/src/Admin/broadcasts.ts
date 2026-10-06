import { Router } from 'express';
import { Broadcast, MessageTemplate, type BroadcastAudience } from '../Models/Broadcast';
import { Conversation } from '../Models/Conversation';
import { LocalWhatsappLead } from '../Leads/createAtriumLead';
import { appendMessages } from '../Memory/conversationMemory';
import { getWhatsAppStatus, sendWhatsAppText } from '../Whatsap';
import { pushToDevices } from '../Push/expoPush';

/**
 * Broadcasts go out through the linked WhatsApp Web session, which WhatsApp
 * rate-limits and may ban for bulk sending. So: DMs only, opted-out chats are
 * always skipped, a hard recipient cap, and a slow, jittered send pace.
 */
const INTERVAL_MS = Math.max(4, Number(process.env.BROADCAST_INTERVAL_SEC) || 8) * 1000;
const MAX_RECIPIENTS = Math.max(1, Number(process.env.BROADCAST_MAX_RECIPIENTS) || 200);
const OPT_OUT_FOOTER = '\n\nReply STOP to opt out.';


function render(message: string, name?: string): string {
  return message.replace(/\{\{\s*name\s*\}\}/gi, name?.split(/\s+/)[0] || 'there');
}

export async function resolveAudience(a: BroadcastAudience): Promise<{ chatIds: string[]; optedOut: number }> {
  const filter: Record<string, unknown> = { chatId: { $regex: '@(c\\.us|lid)$' } };
  if (a.chatIds?.length) {
    filter.chatId = { $in: a.chatIds.filter((c) => /@(c\.us|lid)$/.test(c)) };
  } else {
    const days = Math.min(Math.max(1, a.activeWithinDays ?? 30), 365);
    filter.updatedAt = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
    if (a.lang) filter.lastLang = a.lang;
    if (a.leadsOnly) {
      const leadChats = await LocalWhatsappLead.distinct('chatId');
      filter.chatId = { $in: leadChats.filter((c: string) => /@(c\.us|lid)$/.test(c)) };
    }
  }
  const rows = await Conversation.find(filter).select('chatId optedOut').lean();
  const optedOut = rows.filter((r) => r.optedOut).length;
  const chatIds = rows.filter((r) => !r.optedOut).map((r) => r.chatId as string);
  return { chatIds, optedOut };
}

let runner: Promise<void> | null = null;

async function runBroadcast(id: string): Promise<void> {
  const b = await Broadcast.findById(id);
  if (!b || b.status !== 'sending') return;
  const done = new Set([...b.sent, ...b.failed.map((f) => f.chatId as string)]);
  const queue = b.recipients.filter((c) => !done.has(c));

  for (const chatId of queue) {
    const fresh = await Broadcast.findById(id).select('status').lean();
    if (!fresh || fresh.status !== 'sending') return; // paused or cancelled
    if (!getWhatsAppStatus().ready) {
      await Broadcast.updateOne({ _id: id }, { $set: { status: 'paused' } });
      void pushToDevices('whatsapp', { title: `⏸ Broadcast paused: ${b.name}`, body: 'WhatsApp disconnected — resume once it is back.' });
      return;
    }
    const conv = await Conversation.findOne({ chatId }).select('optedOut contactName').lean();
    if (conv?.optedOut) {
      await Broadcast.updateOne({ _id: id }, { $inc: { skippedOptOut: 1 }, $push: { failed: { chatId, error: 'opted out' } } });
      continue;
    }
    const text = render(b.message, conv?.contactName as string | undefined) + OPT_OUT_FOOTER;
    try {
      await sendWhatsAppText(chatId, text);
      await appendMessages(chatId, [{ role: 'assistant', content: text, at: new Date(), by: 'human' }]);
      await Broadcast.updateOne({ _id: id }, { $push: { sent: chatId } });
    } catch (err) {
      await Broadcast.updateOne(
        { _id: id },
        { $push: { failed: { chatId, error: err instanceof Error ? err.message : 'send failed' } } }
      );
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS + Math.floor(Math.random() * INTERVAL_MS * 0.5)));
  }

  const final = await Broadcast.findOneAndUpdate(
    { _id: id, status: 'sending' },
    { $set: { status: 'done', finishedAt: new Date() } },
    { new: true }
  ).lean();
  if (final) {
    void pushToDevices('chat', {
      title: `📣 Broadcast sent: ${final.name}`,
      body: `${final.sent.length} delivered · ${final.failed.length} failed/skipped`,
    });
  }
}

/** Sends one broadcast at a time; picks the next queued one when finished. */
function kick(): void {
  if (runner) return;
  runner = (async () => {
    for (;;) {
      const next = await Broadcast.findOne({ status: 'sending' }).sort({ startedAt: 1 }).select('_id').lean();
      if (!next) break;
      await runBroadcast(String(next._id));
      const still = await Broadcast.findById(next._id).select('status').lean();
      if (still?.status === 'sending') break; // safety: avoid a hot loop
    }
  })()
    .catch((err) => console.error('broadcast runner failed', err))
    .finally(() => {
      runner = null;
    });
}

/** Resume broadcasts that were mid-send when the server restarted. */
export function resumeBroadcasts(): void {
  setTimeout(kick, 30_000);
}

export const broadcastRouter = Router();

broadcastRouter.get('/templates', async (_req, res) => {
  res.json({ success: true, data: await MessageTemplate.find().sort({ name: 1 }).lean() });
});

broadcastRouter.post('/templates', async (req, res) => {
  const { name, body, usage } = (req.body ?? {}) as { name?: string; body?: string; usage?: string };
  if (!name?.trim() || !body?.trim()) {
    res.status(400).json({ success: false, error: 'name and body are required' });
    return;
  }
  const doc = await MessageTemplate.create({
    name: name.trim().slice(0, 80),
    body: body.trim().slice(0, 4000),
    usage: usage === 'reply' || usage === 'broadcast' ? usage : 'both',
  });
  res.json({ success: true, data: doc });
});

broadcastRouter.delete('/templates/:id', async (req, res) => {
  await MessageTemplate.deleteOne({ _id: req.params.id });
  res.json({ success: true, data: { ok: true } });
});

broadcastRouter.post('/broadcasts/preview', async (req, res) => {
  const audience = ((req.body ?? {}).audience ?? {}) as BroadcastAudience;
  const { chatIds, optedOut } = await resolveAudience(audience);
  res.json({
    success: true,
    data: { count: Math.min(chatIds.length, MAX_RECIPIENTS), matched: chatIds.length, optedOut, cap: MAX_RECIPIENTS },
  });
});

broadcastRouter.get('/broadcasts', async (_req, res) => {
  const rows = await Broadcast.find().sort({ createdAt: -1 }).limit(50).lean();
  res.json({
    success: true,
    data: rows.map((b) => ({
      _id: b._id,
      name: b.name,
      message: b.message,
      audience: b.audience,
      status: b.status,
      total: b.recipients.length,
      sent: b.sent.length,
      failed: b.failed.length,
      skippedOptOut: b.skippedOptOut,
      createdAt: b.createdAt,
      startedAt: b.startedAt,
      finishedAt: b.finishedAt,
    })),
  });
});

broadcastRouter.post('/broadcasts', async (req, res) => {
  const { name, message, audience } = (req.body ?? {}) as { name?: string; message?: string; audience?: BroadcastAudience };
  if (!name?.trim() || !message?.trim()) {
    res.status(400).json({ success: false, error: 'name and message are required' });
    return;
  }
  const doc = await Broadcast.create({
    name: name.trim().slice(0, 120),
    message: message.trim().slice(0, 3500),
    audience: audience ?? {},
  });
  res.json({ success: true, data: doc });
});

broadcastRouter.post('/broadcasts/:id/send', async (req, res) => {
  const b = await Broadcast.findById(req.params.id);
  if (!b) {
    res.status(404).json({ success: false, error: 'Broadcast not found' });
    return;
  }
  if (b.status === 'done' || b.status === 'cancelled' || b.status === 'sending') {
    res.status(409).json({ success: false, error: `Broadcast is ${b.status}` });
    return;
  }
  if (!getWhatsAppStatus().ready) {
    res.status(503).json({ success: false, error: 'WhatsApp is not connected' });
    return;
  }
  if (b.status === 'draft') {
    const { chatIds } = await resolveAudience((b.audience ?? {}) as BroadcastAudience);
    if (!chatIds.length) {
      res.status(400).json({ success: false, error: 'No recipients match this audience' });
      return;
    }
    b.recipients = chatIds.slice(0, MAX_RECIPIENTS);
    b.startedAt = new Date();
  }
  b.status = 'sending';
  await b.save();
  kick();
  res.json({ success: true, data: { _id: b._id, status: b.status, total: b.recipients.length } });
});

broadcastRouter.post('/broadcasts/:id/pause', async (req, res) => {
  await Broadcast.updateOne({ _id: req.params.id, status: 'sending' }, { $set: { status: 'paused' } });
  res.json({ success: true, data: await Broadcast.findById(req.params.id).select('status').lean() });
});

broadcastRouter.post('/broadcasts/:id/cancel', async (req, res) => {
  await Broadcast.updateOne(
    { _id: req.params.id, status: { $in: ['draft', 'sending', 'paused'] } },
    { $set: { status: 'cancelled', finishedAt: new Date() } }
  );
  res.json({ success: true, data: await Broadcast.findById(req.params.id).select('status').lean() });
});
