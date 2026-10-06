import type { MessageType } from '../MessageAnalyzer';
import type { ReplyLang } from '../Media/lang';
import {
  Conversation,
  type ConversationDoc,
  type ConversationMessage,
  type LeadMemory,
} from '../Models/Conversation';

const MAX_MESSAGES = 30;

export async function getConversation(
  chatId: string
): Promise<ConversationDoc | null> {
  const doc = await Conversation.findOne({ chatId }).lean();
  return doc as ConversationDoc | null;
}

export async function isHandedOff(chatId: string): Promise<boolean> {
  // Legacy field — no longer blocks replies; lead linking keeps chat open.
  void chatId;
  return false;
}

export async function resetConversation(chatId: string): Promise<void> {
  await Conversation.deleteOne({ chatId });
}

/** Clear transcript/lead notes; keep pause flag and CRM link. */
export async function clearConversationMemory(chatId: string): Promise<void> {
  await Conversation.findOneAndUpdate(
    { chatId },
    {
      $set: {
        messages: [],
        lead: {},
        updatedAt: new Date(),
      },
    }
  );
}

export async function setAutoReplyPaused(
  chatId: string,
  paused: boolean
): Promise<ConversationDoc | null> {
  const doc = await Conversation.findOneAndUpdate(
    { chatId },
    {
      $set: {
        autoReplyPaused: paused,
        updatedAt: new Date(),
      },
      $setOnInsert: { chatId, messages: [], lead: {} },
    },
    { upsert: true, returnDocument: 'after' }
  ).lean();
  return doc as ConversationDoc | null;
}

/**
 * Append messages without generating a reply — used for messages that arrive
 * while the bot is paused and for replies a human sends from the control apps,
 * so the transcript (and the AI's context once resumed) stays complete.
 */
export async function appendMessages(
  chatId: string,
  messages: ConversationMessage[]
): Promise<ConversationDoc | null> {
  if (!messages.length) return getConversation(chatId);
  const doc = await Conversation.findOneAndUpdate(
    { chatId },
    {
      $push: { messages: { $each: messages, $slice: -MAX_MESSAGES } },
      $set: { updatedAt: new Date() },
      $setOnInsert: { chatId, lead: {} },
    },
    { upsert: true, returnDocument: 'after' }
  ).lean();
  return doc as ConversationDoc | null;
}

export async function touchContactHints(
  chatId: string,
  hints: { contactName?: string; contactPhone?: string }
): Promise<void> {
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  if (hints.contactName) $set.contactName = hints.contactName;
  if (hints.contactPhone) $set.contactPhone = hints.contactPhone;
  await Conversation.findOneAndUpdate(
    { chatId },
    { $set, $setOnInsert: { chatId } },
    { upsert: true }
  );
}

/** Link CRM lead id on conversation; keep full chat memory and keep bot active. */
export async function attachCrmLead(
  chatId: string,
  crmLeadId?: string,
  localLeadId?: string
): Promise<void> {
  await Conversation.findOneAndUpdate(
    { chatId },
    {
      $set: {
        crmLeadId: crmLeadId || undefined,
        localLeadId: localLeadId || undefined,
        leadCreatedAt: new Date(),
        handedOff: false,
        updatedAt: new Date(),
      },
      $setOnInsert: { chatId },
    },
    { upsert: true, returnDocument: 'after' }
  );
}

/** @deprecated use attachCrmLead — kept for callers that still import the old name */
export async function markHandedOff(
  chatId: string,
  crmLeadId?: string
): Promise<void> {
  await attachCrmLead(chatId, crmLeadId);
}

function nextLead(
  existing: LeadMemory | undefined,
  userText: string
): LeadMemory {
  const prev = existing?.summary?.trim();
  const latest = userText.trim().slice(0, 240);
  return {
    summary: prev ? `${prev}\n• ${latest}`.slice(-500) : latest,
    platform: existing?.platform ?? 'unknown',
    featuresNoted: existing?.featuresNoted ?? [],
    openQuestions: existing?.openQuestions ?? [],
    topic: existing?.topic,
  };
}

export function isValidAssistantText(
  text: string,
  lang: ReplyLang
): boolean {
  const t = text.trim();
  if (t.length < 4 || t.length > 500) return false;
  if (
    /topic:|platform:|featuresNoted|openQuestions|Per-chat memory|Message type:|Rules:|lead memory|Known facts/i.test(
      t
    )
  ) {
    return false;
  }
  if ((t.match(/:/g) || []).length >= 3) return false;
  if (lang === 'ml') {
    const ml = (t.match(/[\u0D00-\u0D7F]/g) || []).length;
    if (ml < 8) return false;
  }
  return true;
}

export async function appendTurn(
  chatId: string,
  userText: string,
  assistantText: string,
  meta: { lastType: MessageType; lastLang: ReplyLang }
): Promise<ConversationDoc> {
  const existing = await getConversation(chatId);
  const lead = nextLead(existing?.lead, userText);

  const cleanedPrior = (existing?.messages ?? []).filter((m) => {
    if (m.role !== 'assistant') return true;
    return isValidAssistantText(m.content, meta.lastLang);
  });

  let messages = [
    ...cleanedPrior,
    { role: 'user' as const, content: userText, at: new Date() },
    { role: 'assistant' as const, content: assistantText, at: new Date() },
  ];
  if (messages.length > MAX_MESSAGES) {
    messages = messages.slice(-MAX_MESSAGES);
  }

  const doc = await Conversation.findOneAndUpdate(
    { chatId },
    {
      $set: {
        messages,
        lead,
        lastType: meta.lastType,
        lastLang: meta.lastLang,
        updatedAt: new Date(),
        handedOff: false,
      },
      $setOnInsert: { chatId },
    },
    { upsert: true, returnDocument: 'after' }
  ).lean();

  return doc as ConversationDoc;
}

export function formatLeadForPrompt(lead: LeadMemory | undefined): string {
  if (!lead?.summary?.trim()) return 'No prior notes yet.';
  return lead.summary.trim();
}

export function isLowQualityTranscript(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return true;
  const malayalam = /[\u0D00-\u0D7F]/.test(t);
  if (malayalam) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return true;
  const weird = words.filter(
    (w) => /(.)\1{3,}/i.test(w) || /^[A-Z]{4,}$/.test(w)
  );
  if (weird.length >= Math.ceil(words.length / 2)) return true;
  const gibber = words.filter(
    (w) =>
      /^[A-Za-z]{6,}$/.test(w) &&
      !/ing$|tion$|ment$|app|feature|project|website|mobile|billing|wholesale|vegetable|business|handling|enquiry|inquiry/i.test(
        w
      )
  );
  return gibber.length >= 3 && gibber.length >= words.length * 0.4;
}
