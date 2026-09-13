import { getGroq } from '../Config/groq';
import { strongChatModel } from './models';
import { assessLeadReady, assessLeadUpdate } from '../Leads/assessLeadReady';
import {
  createAtriumLead,
  handoffThanksMessage,
  updateAtriumLead,
} from '../Leads/createAtriumLead';
import type { MessageType } from '../MessageAnalyzer';
import type { ReplyLang } from '../Media/lang';
import {
  appendTurn,
  attachCrmLead,
  formatLeadForPrompt,
  getConversation,
  isValidAssistantText,
} from '../Memory/conversationMemory';
import type { ConversationDoc } from '../Models/Conversation';
import { greetingIntro } from './greeting';

const DEFAULT_CHAT_MODEL = 'qwen/qwen3.8-27b';

function chatModel(): string {
  return strongChatModel() || DEFAULT_CHAT_MODEL;
}

function baseSystem(
  lang: ReplyLang,
  notes: string,
  supportProjects?: Array<{
    atriumProjectId?: string;
    atriumProjectName?: string;
    atriumProjectKey?: string;
  }>
): string {
  const langRule =
    lang === 'ml'
      ? `Reply ONLY in Malayalam script (no English letters).
Brand: ഐവോറിക്സ് ഹെൽപ്പ് ഡെസ്ക്. Keep it natural for spoken voice.`
      : 'Reply ONLY in clear short English.';

  const labels = (supportProjects || [])
    .map((p) => {
      const name = p.atriumProjectName || p.atriumProjectKey || p.atriumProjectId;
      if (!name) return null;
      return p.atriumProjectKey ? `${name} [${p.atriumProjectKey}]` : name;
    })
    .filter(Boolean) as string[];

  const projectLine =
    labels.length > 0
      ? `\nYou are answering in a WhatsApp *support group* for Atrium project(s): ${labels.join(', ')}. Stay on those projects' support; do not pitch sales or create leads.`
      : supportProjects
        ? '\nYou are answering in a WhatsApp support group. Be helpful and concise; do not create sales leads.'
        : '';

  return `You are Ivorix WhatsApp Help Desk for a software agency (websites, apps, custom digital solutions).
${projectLine}

Conversation notes (this chat only — use naturally, never dump as a list):
${notes}

Rules:
- Output ONLY the reply the customer should hear/read. No labels, no "topic:", no system text.
- Sound like a helpful human agent. Continue prior turns; do not restart with a fresh greeting if history exists.
- Acknowledge what they said, then ask one useful clarifying question if needed.
- Do not invent prices, timelines, or tech commitments.
- ${langRule}
- Max 2 short sentences.`;
}

function extractReply(
  content: string | null | undefined,
  lang: ReplyLang
): string | null {
  if (!content) return null;
  let text = content.trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  text = text.replace(/^[\s\S]*?<\/think>/i, '').trim();

  if (lang === 'ml' && /topic:|platform:|features|Known facts/i.test(text)) {
    const parts = text.split(/(?<=[।.!?\n])/);
    const mlParts = parts.filter(
      (p) => ((p.match(/[\u0D00-\u0D7F]/g) || []).length) >= 10
    );
    text = (mlParts.at(-1) || '').trim();
  }

  if (!isValidAssistantText(text, lang)) return null;
  return text;
}

async function llmReply(
  conv: ConversationDoc | null,
  messageType: MessageType,
  lang: ReplyLang,
  opts?: {
    sttUncertain?: boolean;
    supportProjects?: Array<{
      atriumProjectId?: string;
      atriumProjectName?: string;
      atriumProjectKey?: string;
    }>;
  }
): Promise<string | null> {
  const notes = formatLeadForPrompt(conv?.lead);
  const history = (conv?.messages ?? [])
    .filter((m) =>
      m.role === 'user' ? true : isValidAssistantText(m.content, lang)
    )
    .slice(-10);

  const model = chatModel();

  console.log('LLM reply', {
    model,
    historyTurns: history.length,
    sttUncertain: Boolean(opts?.sttUncertain),
    supportProjects: (opts?.supportProjects || [])
      .map((p) => p.atriumProjectName)
      .filter(Boolean),
  });

  const extra = opts?.sttUncertain
    ? lang === 'ml'
      ? '\nThe latest user voice transcript may be inaccurate — use prior chat notes and ask them to briefly repeat the missing detail.'
      : '\nThe latest voice transcript may be inaccurate — use prior chat notes and ask them to briefly repeat the missing detail.'
    : '';

  const messages = [
    {
      role: 'system' as const,
      content: `${baseSystem(lang, notes, opts?.supportProjects)}\nIntent: ${messageType}.${extra}`,
    },
    ...history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
  ];

  try {
    const completion = await getGroq().chat.completions.create({
      model,
      temperature: 0.35,
      max_tokens: 180,
      messages,
    });

    let reply = extractReply(completion.choices[0]?.message?.content, lang);
    if (reply) return reply;

    const retry = await getGroq().chat.completions.create({
      model,
      temperature: 0.25,
      max_tokens: 140,
      messages: [
        {
          role: 'system',
          content:
            lang === 'ml'
              ? 'നീ ഐവോറിക്സ് വാട്സ്ആപ്പ് ഹെൽപ്പ് ഡെസ്ക് ഏജന്റ് ആണ്. രണ്ട് ചെറിയ മലയാളം വാക്യം മാത്രം. ലേബലുകൾ വേണ്ട.'
              : 'You are Ivorix WhatsApp Help Desk. Two short English sentences only. No labels.',
        },
        ...history.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ],
    });

    return extractReply(retry.choices[0]?.message?.content, lang);
  } catch (err) {
    console.error('Groq reply failed:', err);
    return null;
  }
}

export type GenerateReplyResult = {
  text: string;
  leadCreated?: boolean;
};

/**
 * History-aware replies. First greeting uses fixed Ivorix intro (no LLM).
 * When project details are enough → create CRM lead (keep memory, keep chatting).
 * Later useful details → update the same CRM lead automatically.
 */
export async function generateReply(
  chatId: string,
  userText: string,
  messageType: MessageType,
  lang: ReplyLang,
  _reason: string,
  opts?: {
    sttUncertain?: boolean;
    contactPhone?: string;
    contactName?: string;
    /** Group support context — skips CRM lead create/update. */
    supportProjects?: Array<{
      atriumProjectId?: string;
      atriumProjectName?: string;
      atriumProjectKey?: string;
    }>;
    isGroup?: boolean;
  }
): Promise<GenerateReplyResult> {
  const conv = await getConversation(chatId);

  const hasHistory = (conv?.messages?.length ?? 0) > 0;
  const groupMode = Boolean(opts?.isGroup || opts?.supportProjects);

  // First contact greeting → fixed Ivorix Help Desk intro (DMs only)
  if (messageType === 'greeting' && !hasHistory && !groupMode) {
    const reply = greetingIntro(lang);
    console.log('Greeting intro', { chatId, lang });
    await appendTurn(chatId, userText, reply, {
      lastType: 'greeting',
      lastLang: lang,
    });
    return { text: reply };
  }

  const projectish =
    messageType === 'project_lead' ||
    messageType === 'requirement' ||
    conv?.lastType === 'project_lead' ||
    conv?.lastType === 'requirement';

  // Create lead once when ready; keep memory and continue chat afterward (DMs only)
  if (
    !groupMode &&
    !conv?.crmLeadId &&
    !opts?.sttUncertain &&
    projectish &&
    (conv?.messages?.length ?? 0) >= 4
  ) {
    const assessment = await assessLeadReady(conv, userText);
    if (assessment.ready) {
      const transcript = [
        ...(conv?.messages ?? []).map((m) => `${m.role}: ${m.content}`),
        `user: ${userText}`,
      ].join('\n');

      const created = await createAtriumLead({
        chatId,
        assessment,
        transcript,
        contactPhone: opts?.contactPhone || chatId.replace(/@.*/, ''),
        contactName: opts?.contactName,
      });

      const reply = handoffThanksMessage(lang);
      console.log('Lead created — continuing chat', {
        chatId,
        title: assessment.title,
        localId: created.localId,
        crmLeadId: created.crmLeadId,
        contactPhone: opts?.contactPhone,
      });

      await appendTurn(chatId, userText, reply, {
        lastType: 'requirement',
        lastLang: lang,
      });
      await attachCrmLead(chatId, created.crmLeadId, created.localId);
      return { text: reply, leadCreated: true };
    }
  }

  // Existing lead: merge new useful details into CRM (DMs only)
  if (!groupMode && conv?.crmLeadId && !opts?.sttUncertain && projectish) {
    const update = await assessLeadUpdate(
      conv,
      userText,
      conv.lead?.summary
    );
    if (update.hasUsefulUpdate) {
      const transcript = [
        ...(conv.messages ?? []).map((m) => `${m.role}: ${m.content}`),
        `user: ${userText}`,
      ].join('\n');
      await updateAtriumLead({
        chatId,
        crmLeadId: conv.crmLeadId,
        localLeadId: conv.localLeadId,
        assessment: update,
        transcript,
      });
      console.log('Lead updated from chat', {
        chatId,
        crmLeadId: conv.crmLeadId,
        preview: update.summary.slice(0, 80),
      });
    }
  }

  const typeForLlm =
    messageType === 'greeting' && hasHistory
      ? 'support'
      : messageType === 'random'
        ? 'support'
        : groupMode
          ? 'support'
          : messageType;

  let reply = await llmReply(
    {
      chatId,
      messages: [
        ...(conv?.messages ?? []),
        { role: 'user', content: userText },
      ],
      lead: conv?.lead,
      lastType: conv?.lastType,
      lastLang: conv?.lastLang,
      crmLeadId: conv?.crmLeadId,
    },
    typeForLlm,
    lang,
    opts
  );

  // Last-resort minimal AI-free line only if API fully fails
  if (!reply || !isValidAssistantText(reply, lang)) {
    reply =
      lang === 'ml'
        ? 'മനസ്സിലായി. ഒന്ന് കൂടി വ്യക്തമായി പറയാമോ?'
        : 'Got it. Could you say that a bit more clearly?';
  }

  await appendTurn(chatId, userText, reply, {
    lastType: typeForLlm,
    lastLang: lang,
  });

  return { text: reply };
}

export async function imageNoCaptionReply(
  chatId: string,
  lang: ReplyLang
): Promise<GenerateReplyResult> {
  return generateReply(
    chatId,
    lang === 'ml'
      ? 'ഉപയോക്താവ് ക്യാപ്ഷൻ ഇല്ലാതെ ഒരു ചിത്രം അയച്ചു.'
      : 'User sent an image with no caption.',
    'support',
    lang,
    'image_no_caption'
  );
}
