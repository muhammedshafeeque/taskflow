import type Groq from 'groq-sdk';
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
import {
  ATRIUM_ENDPOINT_CATALOG,
  ATRIUM_TOOLS,
  runAtriumTool,
  type AtriumToolCallLog,
} from './atriumTools';
import { brandName } from '../Config/brand';

const DEFAULT_CHAT_MODEL = 'qwen/qwen3.8-27b';
/** Max model↔tool round trips per question. */
const MAX_TOOL_ROUNDS = 6;

/** 'voice' = spoken control-center replies; 'chat' = mobile text chat (longer, light formatting). */
export type AssistantMode = 'voice' | 'chat';

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
  const query = q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

async function conversationalReply(
  userText: string,
  mode: AssistantMode
): Promise<VoiceCommandResult> {
  const context = await buildBusinessContext();
  const model =
    process.env.GROQ_CHAT_MODEL?.trim() ||
    process.env.GROQ_MODEL?.trim() ||
    DEFAULT_CHAT_MODEL;

  const style =
    mode === 'chat'
      ? `- This is a text chat on the owner's phone. Be concise but complete: lead with the answer, then key facts.
- Plain text with short "- " lists is fine; no tables, no code fences. Include issue keys / names so they can find things.`
      : `- Speak like a trusted human PA: clear, concise, natural. 1–3 short sentences unless they ask for detail.
- No markdown, no bullet dumps, no code fences — this is read aloud.`;

  const system = `You are ${brandName()}'s assistant, a warm, capable human-like executive personal assistant for the business owner.
You work inside the PA Control Center and help run the business on Atrium/Taskflow (projects, issues, sprints, CRM, service desk, calendar, monitor, HRMS) and the WhatsApp PA bot.

You have FULL live access to Atrium through tools:
- atrium_get: read any Atrium data. Always fetch real data before answering questions about projects, issues, people, leads, tickets, errors, etc. Never guess or invent names, numbers or ids.
- atrium_write: create/update records, ONLY when the owner explicitly asks in their latest message. Resolve ids with atrium_get first, then confirm what you changed (with the issue key / name).
- Drill down: list with filters → detail by id. Use /search or /issues/search-global when you only have a name or phrase. Use project ids from the context below.
- If a tool returns 401/403/503, explain that Atrium access needs TASKFLOW_API_TOKEN (or TASKFLOW_EMAIL + TASKFLOW_PASSWORD) with enough permissions in PA/.env.

Style:
${style}
- If they greet you or ask if you can hear them, answer warmly and offer help.
- You may suggest WhatsApp ops (pause bot, list leads) in plain language.

Today: ${new Date().toISOString().slice(0, 10)}

${ATRIUM_ENDPOINT_CATALOG}

Live context:
${context}`;

  type Msg = Groq.Chat.Completions.ChatCompletionMessageParam;
  const messages: Msg[] = [
    { role: 'system', content: system },
    ...voiceHistory.map((m) => ({ role: m.role, content: m.content }) as Msg),
    { role: 'user', content: userText },
  ];
  const calls: AtriumToolCallLog[] = [];

  try {
    let reply = '';
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const completion = await getGroq().chat.completions.create({
        model,
        temperature: 0.3,
        max_tokens: mode === 'chat' ? 1200 : 400,
        messages,
        // Last round: force a text answer from what was gathered.
        ...(round < MAX_TOOL_ROUNDS ? { tools: ATRIUM_TOOLS, tool_choice: 'auto' as const } : {}),
      });
      const msg = completion.choices[0]?.message;
      const toolCalls = msg?.tool_calls ?? [];
      if (!toolCalls.length) {
        reply = (msg?.content ?? '').trim();
        break;
      }
      messages.push({ role: 'assistant', content: msg?.content ?? '', tool_calls: toolCalls });
      const results = await Promise.all(
        toolCalls.map((tc) => runAtriumTool(tc.function.name, tc.function.arguments, calls))
      );
      toolCalls.forEach((tc, i) =>
        messages.push({ role: 'tool', tool_call_id: tc.id, content: results[i] })
      );
    }

    reply = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    reply = reply.replace(/^```[\s\S]*?```$/g, '').trim();
    if (!reply) {
      reply =
        "I'm here. Ask me about your projects, issues, leads, tickets, WhatsApp chats, or say pause the bot.";
    }
    const cap = mode === 'chat' ? 4000 : 600;
    if (reply.length > cap) reply = `${reply.slice(0, cap - 20).trim()}…`;

    const wrote = calls.some((c) => c.tool === 'atrium_write' && c.status < 300);
    return {
      action: wrote ? 'atrium_update' : 'assistant',
      reply,
      data: { model, atriumCalls: calls },
    };
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
export async function runVoiceCommand(
  text: string,
  mode: AssistantMode = 'voice'
): Promise<VoiceCommandResult> {
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

  const result = await conversationalReply(cleaned, mode);
  pushHistory('assistant', result.reply);
  return result;
}
