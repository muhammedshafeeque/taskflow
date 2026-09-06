import { getGroq } from '../Config/groq';
import {
  getBotSettings,
  updateBotSettings,
} from '../Config/botSettings';
import { LocalWhatsappLead } from '../Leads/createAtriumLead';
import { setAutoReplyPaused } from '../Memory/conversationMemory';
import { Conversation } from '../Models/Conversation';
import type { SttLanguage } from '../Models/BotSettings';
import {
  fetchTaskflowSnapshot,
  formatSnapshotForPrompt,
} from './taskflowContext';

const DEFAULT_CHAT_MODEL = 'qwen/qwen3.8-27b';

export type VoiceCommandResult = {
  action: string;
  reply: string;
  data?: Record<string, unknown>;
};

type OpsIntent = {
  action:
    | 'pause_bot'
    | 'resume_bot'
    | 'pause_chat'
    | 'resume_chat'
    | 'resume_all_chats'
    | 'voice_replies_on'
    | 'voice_replies_off'
    | 'set_stt'
    | 'none';
  chatQuery?: string;
  sttLanguage?: SttLanguage;
};

/** Short rolling memory for control-center voice conversation. */
const voiceHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
const MAX_HISTORY = 12;

function pushHistory(role: 'user' | 'assistant', content: string) {
  voiceHistory.push({ role, content: content.slice(0, 800) });
  while (voiceHistory.length > MAX_HISTORY) voiceHistory.shift();
}

/**
 * Only very explicit ops phrases — never match bare words like "english" or "status".
 */
function matchExplicitOps(text: string): OpsIntent {
  const lower = text.toLowerCase().trim();

  if (
    /^(pause|stop)\s+(the\s+)?(bot|auto.?replies?)\b/.test(lower) ||
    /\bpause\s+(the\s+)?bot\b/.test(lower) ||
    /\bstop\s+all\s+auto.?replies?\b/.test(lower)
  ) {
    return { action: 'pause_bot' };
  }
  if (
    /^(resume|start|enable)\s+(the\s+)?(bot|auto.?replies?)\b/.test(lower) ||
    /\bresume\s+(the\s+)?bot\b/.test(lower)
  ) {
    return { action: 'resume_bot' };
  }
  if (/\bresume\s+all\s+(chats|conversations)\b/.test(lower)) {
    return { action: 'resume_all_chats' };
  }
  if (/\bpause\s+(chat|conversation)\b/.test(lower)) {
    return { action: 'pause_chat', chatQuery: text };
  }
  if (/\bresume\s+(chat|conversation)\b/.test(lower)) {
    return { action: 'resume_chat', chatQuery: text };
  }
  if (
    /\b(turn\s+off|disable)\s+(whatsapp\s+)?voice\s+replies?\b/.test(lower) ||
    /\bvoice\s+replies?\s+off\b/.test(lower)
  ) {
    return { action: 'voice_replies_off' };
  }
  if (
    /\b(turn\s+on|enable)\s+(whatsapp\s+)?voice\s+replies?\b/.test(lower) ||
    /\bvoice\s+replies?\s+on\b/.test(lower)
  ) {
    return { action: 'voice_replies_on' };
  }
  if (
    /\bset\s+(stt|speech|whisper)\s+(to\s+)?(malayalam|ml)\b/.test(lower) ||
    /\bstt\s+(language\s+)?(to\s+)?malayalam\b/.test(lower)
  ) {
    return { action: 'set_stt', sttLanguage: 'ml' };
  }
  if (
    /\bset\s+(stt|speech|whisper)\s+(to\s+)?(english|en)\b/.test(lower) ||
    /\bstt\s+(language\s+)?(to\s+)?english\b/.test(lower)
  ) {
    return { action: 'set_stt', sttLanguage: 'en' };
  }
  if (/\bset\s+(stt|speech)\s+(to\s+)?auto\b/.test(lower)) {
    return { action: 'set_stt', sttLanguage: 'auto' };
  }

  return { action: 'none' };
}

async function findChatByQuery(
  q: string
): Promise<{ chatId: string; label: string } | null> {
  const query = q.trim();
  if (!query) return null;
  const docs = await Conversation.find({
    $or: [
      { chatId: { $regex: query, $options: 'i' } },
      { contactPhone: { $regex: query, $options: 'i' } },
      { contactName: { $regex: query, $options: 'i' } },
    ],
  })
    .limit(5)
    .lean();
  if (!docs.length) return null;
  const d = docs[0];
  return {
    chatId: d.chatId,
    label: d.contactName || d.contactPhone || d.chatId,
  };
}

async function runExplicitOps(intent: OpsIntent): Promise<VoiceCommandResult | null> {
  switch (intent.action) {
    case 'pause_bot': {
      await updateBotSettings({ botPaused: true });
      return { action: 'pause_bot', reply: 'Okay. All WhatsApp auto-replies are paused.' };
    }
    case 'resume_bot': {
      await updateBotSettings({ botPaused: false });
      return { action: 'resume_bot', reply: 'Okay. Auto-replies are resumed.' };
    }
    case 'pause_chat': {
      const hit = await findChatByQuery(intent.chatQuery || '');
      if (!hit) {
        return {
          action: 'pause_chat',
          reply: 'I could not find that chat. Try a phone number or contact name.',
        };
      }
      await setAutoReplyPaused(hit.chatId, true);
      return {
        action: 'pause_chat',
        reply: `Paused auto-reply for ${hit.label}.`,
        data: { chatId: hit.chatId },
      };
    }
    case 'resume_chat': {
      const hit = await findChatByQuery(intent.chatQuery || '');
      if (!hit) {
        return {
          action: 'resume_chat',
          reply: 'I could not find that chat to resume.',
        };
      }
      await setAutoReplyPaused(hit.chatId, false);
      return {
        action: 'resume_chat',
        reply: `Resumed auto-reply for ${hit.label}.`,
        data: { chatId: hit.chatId },
      };
    }
    case 'resume_all_chats': {
      const result = await Conversation.updateMany(
        { autoReplyPaused: true },
        { $set: { autoReplyPaused: false, updatedAt: new Date() } }
      );
      return {
        action: 'resume_all_chats',
        reply: `Resumed ${result.modifiedCount} paused chats.`,
        data: { count: result.modifiedCount },
      };
    }
    case 'voice_replies_on': {
      await updateBotSettings({ voiceRepliesEnabled: true });
      return {
        action: 'voice_replies_on',
        reply: 'WhatsApp voice replies are enabled.',
      };
    }
    case 'voice_replies_off': {
      await updateBotSettings({ voiceRepliesEnabled: false });
      return {
        action: 'voice_replies_off',
        reply: 'WhatsApp voice replies are off. Replies will be text only.',
      };
    }
    case 'set_stt': {
      const lang = intent.sttLanguage || 'ml';
      await updateBotSettings({ sttLanguage: lang });
      const label =
        lang === 'ml' ? 'Malayalam' : lang === 'en' ? 'English' : 'auto-detect';
      return {
        action: 'set_stt',
        reply: `WhatsApp speech recognition set to ${label}.`,
        data: { sttLanguage: lang },
      };
    }
    default:
      return null;
  }
}

async function buildBusinessContext(): Promise<string> {
  const settings = await getBotSettings();
  const [chats, paused, leads, recentConvs, recentLeads, snap] =
    await Promise.all([
      Conversation.countDocuments(),
      Conversation.countDocuments({ autoReplyPaused: true }),
      LocalWhatsappLead.countDocuments(),
      Conversation.find().sort({ updatedAt: -1 }).limit(6).lean(),
      LocalWhatsappLead.find().sort({ createdAt: -1 }).limit(6).lean(),
      fetchTaskflowSnapshot(),
    ]);

  return formatSnapshotForPrompt(snap, {
    botPaused: settings.botPaused,
    voiceRepliesEnabled: settings.voiceRepliesEnabled,
    sttLanguage: settings.sttLanguage,
    chats,
    pausedChats: paused,
    whatsappLeads: leads,
    recentChats: recentConvs.map(
      (d) => d.contactName || d.contactPhone || d.chatId.slice(0, 18)
    ),
    recentLeadTitles: recentLeads.map((l) => l.title || l.companyName || 'lead'),
  });
}

async function conversationalReply(userText: string): Promise<VoiceCommandResult> {
  const context = await buildBusinessContext();
  const model =
    process.env.GROQ_CHAT_MODEL?.trim() ||
    process.env.GROQ_MODEL?.trim() ||
    DEFAULT_CHAT_MODEL;

  const system = `You are Ivorix, a warm, capable human-like executive personal assistant for the business owner.
You work inside the Ivorix Control Center and help run the business on Atrium/Taskflow (projects, CRM) and the WhatsApp PA bot.

Style:
- Speak like a trusted human PA: clear, concise, natural. 1–3 short sentences unless they ask for detail.
- No markdown, no bullet dumps, no code fences — this is read aloud.
- If they greet you or ask if you can hear them, answer warmly and offer help.
- Use the live business context below. Prefer facts from context over guessing.
- If Atrium data is missing, say what you can do with WhatsApp/PA data and that TASKFLOW_API_TOKEN unlocks live projects/CRM.
- You may suggest WhatsApp ops (pause bot, list leads) in plain language; do not invent project names that are not in context.

Live context:
${context}`;

  try {
    const completion = await getGroq().chat.completions.create({
      model,
      temperature: 0.45,
      max_tokens: 350,
      messages: [
        { role: 'system', content: system },
        ...voiceHistory.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user', content: userText },
      ],
    });
    let reply = (completion.choices[0]?.message?.content ?? '').trim();
    reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    reply = reply.replace(/^```[\s\S]*?```$/g, '').trim();
    if (!reply) {
      reply =
        "I'm here. Ask me about your projects, leads, WhatsApp chats, or say pause the bot.";
    }
    // Keep spoken answers reasonably short
    if (reply.length > 600) reply = `${reply.slice(0, 580).trim()}…`;
    return { action: 'assistant', reply, data: { model } };
  } catch (err) {
    console.error('conversationalReply failed:', err);
    return {
      action: 'assistant_error',
      reply:
        "I'm having trouble thinking right now. Please try again in a moment.",
    };
  }
}

/**
 * Control-center voice entry: explicit WhatsApp ops OR conversational AI PA.
 */
export async function runVoiceCommand(text: string): Promise<VoiceCommandResult> {
  const cleaned = text.trim();
  if (!cleaned) {
    return {
      action: 'unknown',
      reply: "I didn't catch that. Say it again, or ask about projects, leads, or the WhatsApp bot.",
    };
  }

  pushHistory('user', cleaned);

  const ops = matchExplicitOps(cleaned);
  const opsResult = await runExplicitOps(ops);
  if (opsResult) {
    pushHistory('assistant', opsResult.reply);
    return opsResult;
  }

  const result = await conversationalReply(cleaned);
  pushHistory('assistant', result.reply);
  return result;
}
