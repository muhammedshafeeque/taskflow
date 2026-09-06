import { Router } from 'express';
import {
  getBotSettings,
  updateBotSettings,
} from '../Config/botSettings';
import {
  clearConversationMemory,
  getConversation,
  setAutoReplyPaused,
} from '../Memory/conversationMemory';
import { Conversation } from '../Models/Conversation';
import type { SttLanguage } from '../Models/BotSettings';
import { LocalWhatsappLead } from '../Leads/createAtriumLead';
import { getWhatsAppStatus } from '../Whatsap';
import { requireAdminSecret } from './auth';
import {
  listWhatsAppGroups,
  patchWhatsAppGroup,
} from './groupsAdmin';
import { listTaskflowProjects } from './taskflowContext';
import {
  listSupportCases,
  streamSupportEvents,
} from './supportAdmin';
import {
  voiceCommand,
  voiceSpeak,
  voiceTranscribe,
} from './voiceRoutes';

export const adminRouter = Router();

adminRouter.use(requireAdminSecret);

adminRouter.get('/status', async (_req, res) => {
  const settings = await getBotSettings();
  const [conversationCount, pausedCount, leadCount] = await Promise.all([
    Conversation.countDocuments(),
    Conversation.countDocuments({ autoReplyPaused: true }),
    LocalWhatsappLead.countDocuments(),
  ]);
  res.json({
    success: true,
    data: {
      whatsapp: getWhatsAppStatus(),
      settings,
      counts: {
        conversations: conversationCount,
        paused: pausedCount,
        leads: leadCount,
      },
    },
  });
});

adminRouter.get('/settings', async (_req, res) => {
  const settings = await getBotSettings();
  res.json({ success: true, data: settings });
});

adminRouter.patch('/settings', async (req, res) => {
  const body = (req.body ?? {}) as {
    botPaused?: boolean;
    voiceRepliesEnabled?: boolean;
    sttLanguage?: SttLanguage;
  };
  const settings = await updateBotSettings(body);
  res.json({ success: true, data: settings });
});

adminRouter.get('/conversations', async (req, res) => {
  const q = String(req.query.q ?? '')
    .trim()
    .toLowerCase();
  const limit = Math.min(
    200,
    Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50)
  );

  const filter = q
    ? {
        $or: [
          { chatId: { $regex: q, $options: 'i' } },
          { contactPhone: { $regex: q, $options: 'i' } },
          { contactName: { $regex: q, $options: 'i' } },
        ],
      }
    : {};

  const docs = await Conversation.find(filter)
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select(
      'chatId lastLang lastType autoReplyPaused crmLeadId localLeadId contactName contactPhone updatedAt messages leadCreatedAt'
    )
    .lean();

  const data = docs.map((d) => ({
    chatId: d.chatId,
    lastLang: d.lastLang,
    lastType: d.lastType,
    autoReplyPaused: Boolean(d.autoReplyPaused),
    crmLeadId: d.crmLeadId,
    localLeadId: d.localLeadId,
    contactName: d.contactName,
    contactPhone: d.contactPhone,
    messageCount: Array.isArray(d.messages) ? d.messages.length : 0,
    leadCreatedAt: d.leadCreatedAt,
    updatedAt: d.updatedAt,
    preview:
      Array.isArray(d.messages) && d.messages.length
        ? String(d.messages[d.messages.length - 1]?.content ?? '').slice(0, 120)
        : '',
  }));

  res.json({ success: true, data });
});

adminRouter.get('/conversations/:chatId', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const conv = await getConversation(chatId);
  if (!conv) {
    res.status(404).json({ success: false, error: 'Conversation not found' });
    return;
  }
  res.json({ success: true, data: conv });
});

adminRouter.post('/conversations/:chatId/pause', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const data = await setAutoReplyPaused(chatId, true);
  res.json({ success: true, data });
});

adminRouter.post('/conversations/:chatId/resume', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const data = await setAutoReplyPaused(chatId, false);
  res.json({ success: true, data });
});

adminRouter.post('/conversations/:chatId/reset', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const existing = await getConversation(chatId);
  if (!existing) {
    res.status(404).json({ success: false, error: 'Conversation not found' });
    return;
  }
  await clearConversationMemory(chatId);
  const data = await getConversation(chatId);
  res.json({ success: true, data });
});

adminRouter.get('/leads', async (_req, res) => {
  const docs = await LocalWhatsappLead.find()
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.json({ success: true, data: docs });
});

adminRouter.get('/groups', async (_req, res, next) => {
  try {
    const data = await listWhatsAppGroups();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

adminRouter.patch('/groups/:chatId', async (req, res, next) => {
  try {
    const chatId = decodeURIComponent(req.params.chatId);
    const body = (req.body ?? {}) as {
      name?: string;
      autoReplyEnabled?: boolean;
      mentionOnly?: boolean;
      atriumProjects?: Array<{ id: string; name: string; key?: string }> | null;
    };
    const data = await patchWhatsAppGroup(chatId, body);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/atrium/projects', async (_req, res, next) => {
  try {
    const data = await listTaskflowProjects();
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/support/cases', async (req, res, next) => {
  try {
    await listSupportCases(req, res);
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/support/events', async (req, res, next) => {
  try {
    await streamSupportEvents(req, res);
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/voice/transcribe', async (req, res, next) => {
  try {
    await voiceTranscribe(req, res);
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/voice/command', async (req, res, next) => {
  try {
    await voiceCommand(req, res);
  } catch (err) {
    next(err);
  }
});

adminRouter.post('/voice/speak', async (req, res, next) => {
  try {
    await voiceSpeak(req, res);
  } catch (err) {
    next(err);
  }
});