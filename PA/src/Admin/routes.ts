import { Router } from 'express';
import {
  getBotSettings,
  updateBotSettings,
} from '../Config/botSettings';
import {
  appendMessages,
  clearConversationMemory,
  getConversation,
  setAutoReplyPaused,
} from '../Memory/conversationMemory';
import { Conversation } from '../Models/Conversation';
import { LocalWhatsappLead } from '../Leads/createAtriumLead';
import {
  getWhatsAppQr,
  getWhatsAppStatus,
  reconnectWhatsApp,
  sendWhatsAppText,
} from '../Whatsap';
import { requireAdminSecret } from './auth';
import { buildChatAnalytics } from './analytics';
import { broadcastRouter } from './broadcasts';
import {
  listCustomerOrgsForAdmin,
  listWhatsAppGroups,
  patchWhatsAppGroup,
} from './groupsAdmin';
import { listTaskflowProjects } from './taskflowContext';
import {
  listSupportCases,
  streamSupportEvents,
} from './supportAdmin';
import {
  approveCustomerRequest,
  getCustomerRequest,
  listCustomerRequests,
  listServiceTickets,
  rejectCustomerRequest,
  updateServiceTicket,
} from './serviceRequests';
import {
  voiceCommand,
  voiceSpeak,
  voiceTranscribe,
} from './voiceRoutes';
import { agentAdminRouter } from '../Agent/adminRoutes';
import { monitorAdminRouter, pushAdminRouter } from './monitorAdmin';

export const adminRouter = Router();

adminRouter.use(requireAdminSecret);
adminRouter.use('/agent', agentAdminRouter);
adminRouter.use('/monitor', monitorAdminRouter);
adminRouter.use('/push', pushAdminRouter);
adminRouter.use('/', broadcastRouter);

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

adminRouter.get('/whatsapp/status', (_req, res) => {
  res.json({ success: true, data: getWhatsAppStatus() });
});

// Fire-and-forget: a restart can take a minute (Chromium boot + WA Web load),
// so respond immediately and let clients poll /whatsapp/status.
adminRouter.post('/whatsapp/reconnect', (_req, res) => {
  void reconnectWhatsApp().catch(() => undefined);
  res.status(202).json({ success: true, data: getWhatsAppStatus() });
});

adminRouter.get('/whatsapp/qr', async (_req, res, next) => {
  try {
    const qr = await getWhatsAppQr();
    res.json({ success: true, data: { qr, status: getWhatsAppStatus() } });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/analytics', async (req, res, next) => {
  try {
    const days = parseInt(String(req.query.days ?? '30'), 10) || 30;
    res.json({ success: true, data: await buildChatAnalytics(days) });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/settings', async (_req, res) => {
  const settings = await getBotSettings();
  res.json({ success: true, data: settings });
});

adminRouter.patch('/settings', async (req, res) => {
  const body = (req.body ?? {}) as Parameters<typeof updateBotSettings>[0];
  try {
    const settings = await updateBotSettings(body);
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Invalid settings',
    });
  }
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

/**
 * Human takeover: send a message as the business from the control apps.
 * Pauses auto-reply for the chat by default so the bot doesn't talk over you.
 */
adminRouter.post('/conversations/:chatId/send', async (req, res) => {
  const chatId = decodeURIComponent(req.params.chatId);
  const body = (req.body ?? {}) as { text?: string; pauseBot?: boolean };
  const text = String(body.text ?? '').trim();
  if (!text) {
    res.status(400).json({ success: false, error: 'Message text is required' });
    return;
  }
  if (text.length > 4000) {
    res.status(400).json({ success: false, error: 'Message is too long (max 4000 characters)' });
    return;
  }
  if (!/@(c\.us|g\.us|lid)$/.test(chatId)) {
    res.status(400).json({ success: false, error: 'Invalid chat id' });
    return;
  }
  try {
    await sendWhatsAppText(chatId, text);
  } catch (err) {
    res.status(503).json({
      success: false,
      error: err instanceof Error ? err.message : 'Send failed',
    });
    return;
  }
  if (body.pauseBot !== false) await setAutoReplyPaused(chatId, true);
  const data = await appendMessages(chatId, [
    { role: 'assistant', content: text, at: new Date(), by: 'human' },
  ]);
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
    const body = (req.body ?? {}) as Record<string, unknown>;
    const data = await patchWhatsAppGroup(chatId, body as Parameters<typeof patchWhatsAppGroup>[1]);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/customer-orgs', async (_req, res, next) => {
  try {
    const data = await listCustomerOrgsForAdmin();
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

adminRouter.get('/service-requests', async (req, res) => {
  try {
    const data = await listCustomerRequests({
      status: req.query.status ? String(req.query.status) : undefined,
      pendingOnly: String(req.query.pendingOnly || '') === '1',
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to list requests',
    });
  }
});

adminRouter.get('/service-requests/:id', async (req, res) => {
  try {
    const data = await getCustomerRequest(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to load request',
    });
  }
});

adminRouter.post('/service-requests/:id/approve', async (req, res) => {
  try {
    const body = req.body || {};
    const data = await approveCustomerRequest(req.params.id, {
      workClassification: body.workClassification,
      note: body.note,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Approve failed',
    });
  }
});

adminRouter.post('/service-requests/:id/reject', async (req, res) => {
  try {
    const body = req.body || {};
    const data = await rejectCustomerRequest(req.params.id, {
      reason: body.reason,
      note: body.note,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Reject failed',
    });
  }
});

adminRouter.get('/service-tickets', async (req, res) => {
  try {
    const data = await listServiceTickets({
      status: req.query.status ? String(req.query.status) : undefined,
      queue: req.query.queue ? String(req.query.queue) : undefined,
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Failed to list tickets',
    });
  }
});

adminRouter.patch('/service-tickets/:id', async (req, res) => {
  try {
    const data = await updateServiceTicket(req.params.id, req.body || {});
    res.json({ success: true, data });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Ticket update failed',
    });
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