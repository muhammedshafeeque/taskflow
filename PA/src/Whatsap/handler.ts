import type { Chat, Message } from 'whatsapp-web.js';
import { classifyDmIntentFast } from '../Ai/fastIntentClassifier';
import { generateReply } from '../Ai/reply';
import { getGroupConfig, patchWhatsAppGroup } from '../Admin/groupsAdmin';
import { getBotSettings } from '../Config/botSettings';
import type { ReplyLang } from '../Media/lang';
import {
  resolveMessageContent,
  type ResolvedContent,
} from '../Media/resolveMessageContent';
import {
  appendMessages,
  setAutoReplyPaused,
  getConversation,
  isLowQualityTranscript,
  touchContactHints,
} from '../Memory/conversationMemory';
import { type MessageType } from '../MessageAnalyzer';
import {
  normalizeGroupProjects,
  type WhatsappGroupDoc,
} from '../Models/WhatsappGroup';
import { isOfficialSupportGroup } from '../Support/supportGroup';
import { runSupportPipeline } from '../Support/pipeline';
import { isBotAddressedInGroup } from './groupMention';
import { createInbox } from './inbox';
import { startPresence } from './presence';
import { resolveSenderMobile } from './resolveSenderMobile';
import { sendReply } from './sendReply';
import { pushToDevices } from '../Push/expoPush';
import { isQuietNow } from '../Config/quietHours';
import { detectHandover, handoverReply } from '../Ai/handoverDetector';
import { OPT_IN_RX, OPT_OUT_RX } from './optOut';
import { Conversation } from '../Models/Conversation';
import { whatsapp } from './client';

/** Message types the bot can understand; everything else (stickers, system notices, reactions) is dropped before any I/O. */
const HANDLED_TYPES = new Set(['chat', 'ptt', 'audio', 'image', 'video']);
const VOICE_TYPES = new Set(['ptt', 'audio']);

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const inbox = createInbox<Message>({
  keyOf: (m) => m.from,
  idOf: (m) => m.id?._serialized || '',
  timestampOf: (m) => m.timestamp,
  process: (_chatId, batch) => processBatch(batch),
  windowMs: envInt('BOT_BATCH_WINDOW_MS', 1200),
  maxWaitMs: envInt('BOT_BATCH_MAX_WAIT_MS', 4000),
  maxConcurrent: envInt('BOT_MAX_CONCURRENT_CHATS', 4),
  maxAgeSec: envInt('BOT_MAX_MESSAGE_AGE_SEC', 600),
});

/** Test helper — clear queue state between unit tests. */
export function resetBusyQueueForTests(): void {
  inbox.reset();
}

export function pendingQueueSizeForTests(): number {
  return inbox.pendingSize();
}

/** Wait for queued/in-flight chats to finish (graceful shutdown). */
export function drainInbox(): Promise<void> {
  return inbox.drain();
}

export function handleIncomingMessage(msg: Message): void {
  if (msg.fromMe) return;
  if (msg.isStatus) return;
  if (msg.from === 'status@broadcast') return;
  if (!HANDLED_TYPES.has(msg.type)) return;

  const result = inbox.push(msg);
  if (result === 'queued') {
    console.log('Busy — queued for next batch', { chatId: msg.from });
  } else if (result === 'stale') {
    console.log('Skip stale message', { chatId: msg.from, ts: msg.timestamp });
  }
}

/** Split a chat batch into consecutive runs by sender (groups have many authors). */
export function splitRunsByAuthor<T extends { author?: string; from: string }>(
  batch: T[]
): T[][] {
  const runs: T[][] = [];
  for (const m of batch) {
    const last = runs.at(-1);
    const who = m.author || m.from;
    if (last && (last[0].author || last[0].from) === who) last.push(m);
    else runs.push([m]);
  }
  return runs;
}

/**
 * Merge a burst ("hi" / "need an app" / voice note) into one turn so the
 * bot answers once with full context instead of replying to fragments.
 */
export function mergeResolvedContents(
  items: Array<ResolvedContent | null | undefined>
): ResolvedContent | null {
  const list = items.filter(Boolean) as ResolvedContent[];
  if (!list.length) return null;

  const withText = list.filter((r) => r.text.trim());
  const hasBareImage = list.some((r) => r.imageNeedsDescription);
  if (!withText.length) {
    return hasBareImage
      ? { text: '', source: 'image', lang: list.at(-1)!.lang, imageNeedsDescription: true }
      : null;
  }

  const lang: ReplyLang = withText.some((r) => r.lang === 'ml') ? 'ml' : 'en';
  let text = withText.map((r) => r.text.trim()).join('\n');
  if (hasBareImage) {
    text +=
      lang === 'ml'
        ? '\n(ക്യാപ്ഷൻ ഇല്ലാത്ത ഒരു ചിത്രവും അയച്ചു.)'
        : '\n(Also sent an image without a caption.)';
  }
  return {
    text,
    source: withText.some((r) => r.source === 'voice')
      ? 'voice'
      : withText.at(-1)!.source,
    lang,
  };
}

/**
 * The bot stays silent when it can't process or understand a message;
 * a human answers those manually.
 */
const MANUAL_REASON_LABEL: Record<string, string> = {
  image_without_caption: 'Sent an image without a caption',
  voice_not_understood: "Voice note the bot couldn't understand",
  empty_content: 'Sent something the bot cannot read',
  nothing_to_process: 'Sent something the bot cannot read',
};

function leaveForManualReply(chatId: string, reason: string, detail?: string) {
  console.warn('No auto-reply — left for manual reply', {
    chatId,
    reason,
    ...(detail ? { detail: detail.slice(0, 200) } : {}),
  });
  // DMs only: someone has to answer this by hand, so tell the operator.
  if (!chatId.endsWith('@g.us')) {
    void pushToDevices('chat', {
      title: `✋ Needs a manual reply · ${chatId.replace(/@.*/, '')}`,
      body: MANUAL_REASON_LABEL[reason] ?? reason,
      data: { chatId },
    });
  }
}

async function processBatch(batch: Message[]): Promise<void> {
  for (const run of splitRunsByAuthor(batch)) {
    await processIncomingMessages(run);
  }
}

async function isAnyAddressed(msgs: Message[]): Promise<boolean> {
  // Newest first — the @mention usually lands on the last message.
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (await isBotAddressedInGroup(msgs[i])) return true;
  }
  return false;
}

async function resolveAll(msgs: Message[]): Promise<ResolvedContent | null> {
  // Parallel: voice notes in a burst are transcribed concurrently.
  const settled = await Promise.allSettled(msgs.map(resolveMessageContent));
  const ok = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
  const failed = settled.find(
    (s): s is PromiseRejectedResult => s.status === 'rejected'
  );
  if (failed && !ok.some(Boolean)) throw failed.reason;
  if (failed) console.warn('Partial batch resolve failure', failed.reason);
  return mergeResolvedContents(ok);
}

/** Away message once per quiet window (12h guard) so customers aren't spammed. */
async function sendAwayMessageOnce(chatId: string, message: string | undefined): Promise<void> {
  const text = message?.trim();
  if (!text) return;
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000);
  const claimed = await Conversation.findOneAndUpdate(
    { chatId, $or: [{ awayNotifiedAt: null }, { awayNotifiedAt: { $lt: cutoff } }] },
    { $set: { awayNotifiedAt: new Date() } }
  ).lean();
  if (!claimed) return;
  try {
    await whatsapp.sendMessage(chatId, text);
    await appendMessages(chatId, [{ role: 'assistant', content: text, at: new Date(), by: 'bot' }]);
  } catch (err) {
    console.warn('away message failed', err);
  }
}

/** Store messages that arrive while auto-reply is off and alert the operator's phone. */
async function recordWhilePaused(
  chatId: string,
  msgs: Message[],
  humanTakeover: boolean,
  contactName?: string
): Promise<void> {
  try {
    const resolved = await resolveAll(msgs).catch(() => null);
    const text =
      resolved?.text?.trim() ||
      msgs
        .map((m) => String(m.body || '').trim() || `[${m.type}]`)
        .join('\n');
    await appendMessages(chatId, [{ role: 'user', content: text, at: new Date() }]);
    if (humanTakeover) {
      await pushToDevices('chat', {
        title: `💬 ${contactName || chatId.replace(/@.*/, '')}`,
        body: text.slice(0, 180),
        data: { chatId },
      });
    }
  } catch (err) {
    console.warn('recordWhilePaused failed', err);
  }
}

async function processIncomingMessages(msgs: Message[]) {
  // Reply to the newest message of the burst.
  const msg = msgs[msgs.length - 1];
  const chatId = msg.from;
  const isGroup = chatId.endsWith('@g.us');

  if (msgs.length > 1) {
    console.log('Batched burst', { chatId, count: msgs.length });
  }

  let groupDoc: WhatsappGroupDoc | null = null;
  let supportProjects:
    | Array<{
        atriumProjectId?: string;
        atriumProjectName?: string;
        atriumProjectKey?: string;
      }>
    | undefined;

  if (isGroup) {
    groupDoc = await getGroupConfig(chatId);
    if (!groupDoc?.autoReplyEnabled) {
      console.log('Group skip — auto-reply off or not configured', {
        chatId,
        name: groupDoc?.name || null,
      });
      return;
    }

    const official = isOfficialSupportGroup(groupDoc);
    if (!official && groupDoc.mentionOnly !== false) {
      if (!(await isAnyAddressed(msgs))) {
        console.log('Group skip — bot not @mentioned', {
          chatId,
          name: groupDoc.name || null,
          bodyPreview: String(msg.body || '').slice(0, 80),
        });
        return;
      }
    }

    supportProjects = normalizeGroupProjects(groupDoc).map((p) => ({
      atriumProjectId: p.id,
      atriumProjectName: p.name,
      atriumProjectKey: p.key,
    }));
  }

  const [settings, conv] = await Promise.all([
    getBotSettings(),
    getConversation(chatId),
  ]);
  if (!isGroup && !settings.botPaused && !conv?.autoReplyPaused && isQuietNow(settings.quietHours)) {
    console.log('Quiet hours — skip auto-reply', { chatId });
    await recordWhilePaused(chatId, msgs, false, conv?.contactName);
    await sendAwayMessageOnce(chatId, settings.quietHours?.awayMessage);
    return;
  }
  if (settings.botPaused || (!isGroup && conv?.autoReplyPaused)) {
    console.log(settings.botPaused ? 'Paused — skip auto-reply (global)' : 'Paused — skip auto-reply', { chatId });
    // Keep the transcript complete so a human can take over from the control apps.
    if (!isGroup) await recordWhilePaused(chatId, msgs, Boolean(conv?.autoReplyPaused), conv?.contactName);
    return;
  }

  const chat: Chat | null = await msg.getChat().catch(() => null);
  if (isGroup && groupDoc && chat) {
    const name = String(chat.name || '').trim();
    if (name && name !== groupDoc.name) {
      groupDoc = { ...groupDoc, name };
      void patchWhatsAppGroup(chatId, { name }).catch(() => undefined);
    }
  }

  const willSpeak =
    settings.voiceRepliesEnabled && msgs.some((m) => VOICE_TYPES.has(m.type));
  const stopPresence = startPresence(chat, willSpeak ? 'recording' : 'typing');

  try {
    const [resolved, sender] = await Promise.all([
      resolveAll(msgs),
      resolveSenderMobile(msg),
    ]);
    if (!resolved) {
      leaveForManualReply(chatId, 'nothing_to_process');
      return;
    }

    if (
      sender.phone !== conv?.contactPhone ||
      (sender.contactName && sender.contactName !== conv?.contactName)
    ) {
      void touchContactHints(chatId, {
        contactPhone: sender.phone,
        contactName: sender.contactName,
      }).catch((err) => console.warn('touchContactHints failed', err));
    }

    let lang: ReplyLang = resolved.lang;
    if (conv?.lastLang === 'ml' && resolved.source === 'voice') {
      lang = 'ml';
    }

    if (isGroup && groupDoc && isOfficialSupportGroup(groupDoc)) {
      const text = resolved.text;
      if (!text) {
        leaveForManualReply(chatId, 'image_without_caption');
        return;
      }

      console.log('Support pipeline', {
        chatId,
        name: groupDoc.name,
        projects: normalizeGroupProjects(groupDoc).map((p) => p.name),
        preview: text.slice(0, 80),
      });

      await runSupportPipeline({
        msg,
        group: groupDoc,
        text,
        lang,
        source: resolved.source,
        sender: {
          phone: sender.phone,
          contactName: sender.contactName,
        },
      });
      return;
    }

    const lastType = (conv?.lastType as MessageType | undefined) ?? null;
    const hasHistory = (conv?.messages?.length ?? 0) > 0;
    const memoryTurns = conv?.messages?.length ?? 0;

    const replyOpts = {
      contactPhone: sender.phone,
      contactName: sender.contactName,
      supportProjects,
      isGroup,
      conv,
    };

    if (!resolved.text) {
      leaveForManualReply(
        chatId,
        resolved.imageNeedsDescription ? 'image_without_caption' : 'empty_content'
      );
      return;
    }

    if (
      resolved.source === 'voice' &&
      isLowQualityTranscript(resolved.text)
    ) {
      leaveForManualReply(chatId, 'voice_not_understood', resolved.text);
      return;
    }

    if (!isGroup && (OPT_OUT_RX.test(resolved.text) || OPT_IN_RX.test(resolved.text))) {
      const optOut = OPT_OUT_RX.test(resolved.text);
      await Conversation.updateOne(
        { chatId },
        { $set: { optedOut: optOut, optedOutAt: optOut ? new Date() : null } }
      );
      const ack = optOut
        ? "You've been unsubscribed from updates. You can still message us any time. Reply START to subscribe again."
        : "You're subscribed to updates again. Reply STOP any time to opt out.";
      await appendMessages(chatId, [
        { role: 'user', content: resolved.text, at: new Date() },
        { role: 'assistant', content: ack, at: new Date(), by: 'bot' },
      ]);
      await sendReply(msg, ack, 'text', lang).catch(() => undefined);
      return;
    }

    const handover = isGroup ? null : detectHandover(resolved.text);
    if (handover) {
      console.log('Handover to human', { chatId, reason: handover });
      const holding = handoverReply(lang);
      await setAutoReplyPaused(chatId, true);
      await appendMessages(chatId, [
        { role: 'user', content: resolved.text, at: new Date() },
        { role: 'assistant', content: holding, at: new Date(), by: 'bot' },
      ]);
      await sendReply(msg, holding, 'text', lang).catch((err) =>
        console.warn('handover holding reply failed', err)
      );
      await pushToDevices('chat', {
        title: `🙋 ${handover === 'frustrated' ? 'Upset customer' : 'Customer wants a person'} · ${
          sender.contactName || sender.phone || chatId.replace(/@.*/, '')
        }`,
        body: resolved.text.slice(0, 180),
        data: { chatId },
        critical: handover === 'frustrated',
      });
      return;
    }

    let analysis = await classifyDmIntentFast(resolved.text, {
      lastType,
      hasHistory,
    });

    // Groups: force non-random toward support like before
    if (isGroup && analysis.type === 'random') {
      analysis = { ...analysis, type: 'support', shouldReply: true };
    }

    if (!analysis.shouldReply && !isGroup) {
      console.log('Ignored message', {
        chatId,
        source: resolved.source,
        lang,
        type: analysis.type,
        reason: analysis.reason,
        lastType,
        memoryTurns,
      });
      return;
    }

    const messageType: MessageType = analysis.type;

    console.log('Replying', {
      chatId,
      isGroup,
      author: msg.author ?? null,
      source: resolved.source,
      lang,
      type: messageType,
      reason: analysis.reason,
      lastType,
      memoryTurns,
      batched: msgs.length,
      contactPhone: sender.phone,
      supportProjects: (supportProjects || [])
        .map((p) => p.atriumProjectName)
        .filter(Boolean),
    });

    const { text: reply, leadCreated } = await generateReply(
      chatId,
      resolved.text,
      messageType,
      lang,
      analysis.reason,
      replyOpts
    );
    if (!reply.trim()) return;
    await sendReply(msg, reply, resolved.source, lang, {
      alsoSendText: Boolean(leadCreated),
    });
  } catch (err) {
    leaveForManualReply(
      chatId,
      'processing_failed',
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    await stopPresence();
  }
}
