import { LocalWhatsappLead } from '../Leads/createAtriumLead';
import { Conversation, type ConversationMessage } from '../Models/Conversation';

const DAY = 24 * 60 * 60 * 1000;

export type ChatAnalytics = {
  days: number;
  totals: {
    activeChats: number;
    inbound: number;
    botReplies: number;
    humanReplies: number;
    leads: number;
    leadsInCrm: number;
    pausedChats: number;
  };
  /** Oldest → newest, one entry per day. */
  daily: Array<{ date: string; inbound: number; botReplies: number; humanReplies: number; leads: number }>;
  responseTimeSec: { median: number | null; p90: number | null; samples: number };
  languages: Record<string, number>;
  messageTypes: Record<string, number>;
  /** Share of chats with ≥1 human reply in the window. */
  humanTakeoverRate: number;
  leadConversionRate: number;
  note: string;
};

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

/**
 * Bot activity over the last `days`. Conversations keep only their most recent
 * messages, so very busy chats undercount older traffic — good for trends, not billing.
 */
export async function buildChatAnalytics(days = 30): Promise<ChatAnalytics> {
  const span = Math.min(Math.max(1, Math.floor(days)), 90);
  const since = new Date(Date.now() - span * DAY);
  const startDay = new Date(since);
  startDay.setUTCHours(0, 0, 0, 0);

  const [convs, leads, pausedChats] = await Promise.all([
    Conversation.find({ updatedAt: { $gte: since } })
      .select('messages lastLang lastType')
      .lean(),
    LocalWhatsappLead.find({ createdAt: { $gte: since } })
      .select('createdAt crmLeadId')
      .lean(),
    Conversation.countDocuments({ autoReplyPaused: true }),
  ]);

  const daily = new Map<string, ChatAnalytics['daily'][number]>();
  for (let t = startDay.getTime(); t <= Date.now(); t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10);
    daily.set(date, { date, inbound: 0, botReplies: 0, humanReplies: 0, leads: 0 });
  }

  let inbound = 0;
  let botReplies = 0;
  let humanReplies = 0;
  let chatsWithHuman = 0;
  let activeChats = 0;
  const responseTimes: number[] = [];
  const languages: Record<string, number> = {};
  const messageTypes: Record<string, number> = {};

  for (const c of convs) {
    const msgs = ((c.messages ?? []) as ConversationMessage[]).filter((m) => m.at && new Date(m.at) >= since);
    if (!msgs.length) continue;
    activeChats++;
    if (c.lastLang) languages[c.lastLang] = (languages[c.lastLang] ?? 0) + 1;
    if (c.lastType) messageTypes[c.lastType] = (messageTypes[c.lastType] ?? 0) + 1;

    let hadHuman = false;
    let pendingUserAt: number | null = null;
    for (const m of msgs) {
      const at = new Date(m.at as Date);
      const bucket = daily.get(at.toISOString().slice(0, 10));
      if (m.role === 'user') {
        inbound++;
        if (bucket) bucket.inbound++;
        pendingUserAt ??= at.getTime();
      } else {
        const human = m.by === 'human';
        if (human) {
          humanReplies++;
          hadHuman = true;
          if (bucket) bucket.humanReplies++;
        } else {
          botReplies++;
          if (bucket) bucket.botReplies++;
        }
        if (pendingUserAt !== null) {
          const sec = (at.getTime() - pendingUserAt) / 1000;
          // Ignore gaps over a day — that's a resumed thread, not a response.
          if (sec >= 0 && sec < 86_400) responseTimes.push(sec);
          pendingUserAt = null;
        }
      }
    }
    if (hadHuman) chatsWithHuman++;
  }

  for (const l of leads) {
    const bucket = daily.get(new Date(l.createdAt as Date).toISOString().slice(0, 10));
    if (bucket) bucket.leads++;
  }

  responseTimes.sort((a, b) => a - b);
  const leadsInCrm = leads.filter((l) => Boolean(l.crmLeadId)).length;

  return {
    days: span,
    totals: {
      activeChats,
      inbound,
      botReplies,
      humanReplies,
      leads: leads.length,
      leadsInCrm,
      pausedChats,
    },
    daily: [...daily.values()],
    responseTimeSec: {
      median: percentile(responseTimes, 50),
      p90: percentile(responseTimes, 90),
      samples: responseTimes.length,
    },
    languages,
    messageTypes,
    humanTakeoverRate: activeChats ? chatsWithHuman / activeChats : 0,
    leadConversionRate: activeChats ? leads.length / activeChats : 0,
    note: 'Based on the most recent messages kept per chat; very busy chats may be undercounted.',
  };
}
