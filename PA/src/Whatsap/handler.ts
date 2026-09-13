import type { Message } from 'whatsapp-web.js';
import { classifyDmIntentFast } from '../Ai/fastIntentClassifier';
import { generateReply } from '../Ai/reply';
import { getGroupConfig, patchWhatsAppGroup } from '../Admin/groupsAdmin';
import { getBotSettings } from '../Config/botSettings';
import type { ReplyLang } from '../Media/lang';
import { resolveMessageContent } from '../Media/resolveMessageContent';
import {
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
import { resolveSenderMobile } from './resolveSenderMobile';
import { sendReply } from './sendReply';

const busyChats = new Set<string>();
/** Latest pending message while a chat is processing (coalesce). */
const pendingByChat = new Map<string, Message>();

/** Test helper — clear queue state between unit tests. */
export function resetBusyQueueForTests(): void {
  busyChats.clear();
  pendingByChat.clear();
}

export function pendingQueueSizeForTests(): number {
  return pendingByChat.size;
}

export async function handleIncomingMessage(msg: Message) {
  if (msg.fromMe) return;
  if (msg.isStatus) return;
  if (msg.from === 'status@broadcast') return;

  const chatId = msg.from;

  if (busyChats.has(chatId)) {
    pendingByChat.set(chatId, msg);
    console.log('Busy — coalesce pending message', { chatId });
    return;
  }

  busyChats.add(chatId);
  try {
    await processIncomingMessage(msg);
  } finally {
    busyChats.delete(chatId);
    const pending = pendingByChat.get(chatId);
    if (pending) {
      pendingByChat.delete(chatId);
      // Process latest coalesced message without blocking the current stack
      void handleIncomingMessage(pending);
    }
  }
}

async function processIncomingMessage(msg: Message) {
  const chatId = msg.from;
  const isGroup = chatId.endsWith('@g.us');

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
      const addressed = await isBotAddressedInGroup(msg);
      if (!addressed) {
        console.log('Group skip — bot not @mentioned', {
          chatId,
          name: groupDoc.name || null,
          mentionedIds: (msg.mentionedIds ?? []).map((id) =>
            typeof id === 'string'
              ? id
              : String((id as { _serialized?: string })?._serialized || id)
          ),
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
    try {
      const chat = await msg.getChat();
      const name = String(chat.name || '').trim();
      if (name && name !== groupDoc.name) {
        await patchWhatsAppGroup(chatId, { name });
        groupDoc = { ...groupDoc, name };
      }
    } catch {
      // ignore
    }
  }

  const settings = await getBotSettings();
  if (settings.botPaused) {
    console.log('Paused — skip auto-reply (global)', { chatId });
    return;
  }

  if (!isGroup) {
    const convEarly = await getConversation(chatId);
    if (convEarly?.autoReplyPaused) {
      console.log('Paused — skip auto-reply', { chatId });
      return;
    }
  }

  try {
    const resolved = await resolveMessageContent(msg);
    if (!resolved) return;

    const sender = await resolveSenderMobile(msg);
    await touchContactHints(chatId, {
      contactPhone: sender.phone,
      contactName: sender.contactName,
    });

    if (isGroup && groupDoc && isOfficialSupportGroup(groupDoc)) {
      const text =
        resolved.text ||
        (resolved.imageNeedsDescription
          ? resolved.lang === 'ml'
            ? 'ഉപയോക്താവ് ക്യാപ്ഷൻ ഇല്ലാതെ ഒരു ചിത്രം അയച്ചു.'
            : 'User sent an image with no caption.'
          : '');
      if (!text) return;

      let lang: ReplyLang = resolved.lang;
      const conv = await getConversation(chatId);
      if (conv?.lastLang === 'ml' && resolved.source === 'voice') {
        lang = 'ml';
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

    const conv = await getConversation(chatId);
    const lastType = (conv?.lastType as MessageType | undefined) ?? null;
    const hasHistory = (conv?.messages?.length ?? 0) > 0;
    const memoryTurns = conv?.messages?.length ?? 0;

    let lang: ReplyLang = resolved.lang;
    if (conv?.lastLang === 'ml' && resolved.source === 'voice') {
      lang = 'ml';
    }

    const replyOpts = {
      contactPhone: sender.phone,
      contactName: sender.contactName,
      supportProjects,
      isGroup,
    };

    if (resolved.imageNeedsDescription) {
      const { text: reply } = await generateReply(
        chatId,
        lang === 'ml'
          ? 'ഉപയോക്താവ് ക്യാപ്ഷൻ ഇല്ലാതെ ഒരു ചിത്രം അയച്ചു.'
          : 'User sent an image with no caption.',
        'support',
        lang,
        'image_no_caption',
        replyOpts
      );
      if (!reply.trim()) return;
      await sendReply(msg, reply, resolved.source, lang);
      return;
    }

    if (!resolved.text) return;

    const sttUncertain =
      resolved.source === 'voice' &&
      hasHistory &&
      isLowQualityTranscript(resolved.text);

    if (sttUncertain) {
      console.log('Low-quality STT; AI continuity reply', {
        chatId,
        memoryTurns,
        preview: resolved.text.slice(0, 80),
      });
      const { text: reply } = await generateReply(
        chatId,
        resolved.text,
        lastType && lastType !== 'random' ? lastType : 'support',
        lang,
        'stt_uncertain',
        { ...replyOpts, sttUncertain: true }
      );
      if (!reply.trim()) return;
      await sendReply(msg, reply, resolved.source, lang);
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

    const messageType: MessageType = isGroup
      ? analysis.type === 'random'
        ? 'support'
        : analysis.type
      : analysis.type;

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
    console.error('Failed to handle WhatsApp message:', err);
    try {
      if (msg.hasMedia && (msg.type === 'ptt' || msg.type === 'audio')) {
        await sendReply(
          msg,
          'ഐവോറിക്സ് ഹെൽപ്പ് ഡെസ്കിന് ആ വോയ്സ് നോട്ട് പ്രോസസ് ചെയ്യാൻ കഴിഞ്ഞില്ല. ദയവായി വീണ്ടും ശ്രമിക്കൂ.',
          'voice',
          'ml'
        );
      } else if (msg.hasMedia && msg.type === 'image') {
        await msg.reply(
          'Ivorix Help Desk could not process that. Please send a short text or voice note.'
        );
      }
    } catch {
      // ignore
    }
  }
}
