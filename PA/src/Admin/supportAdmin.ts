import type { Request, Response } from 'express';
import { SupportConversation } from '../Models/SupportConversation';
import { AgentActivity } from '../Models/AgentActivity';
import {
  getRecentSupportEvents,
  subscribeSupportEvents,
  type SupportEvent,
} from '../Support/events';

export async function listSupportCases(_req: Request, res: Response) {
  const cases = await SupportConversation.find()
    .sort({ updatedAt: -1 })
    .limit(80)
    .lean();

  const activities = await AgentActivity.find({
    conversationId: { $in: cases.map((c) => c._id) },
  })
    .sort({ createdAt: -1 })
    .limit(120)
    .lean();

  const latestByConv = new Map<string, (typeof activities)[0]>();
  for (const a of activities) {
    const key = String(a.conversationId || '');
    if (key && !latestByConv.has(key)) latestByConv.set(key, a);
  }

  res.json({
    success: true,
    data: {
      cases: cases.map((c) => {
        const latest = latestByConv.get(String(c._id));
        return {
          id: String(c._id),
          groupId: c.groupId,
          groupName: c.groupName,
          projectIds: c.projectIds,
          status: c.status,
          ticketIds: c.ticketIds,
          lastQaStatus: c.lastQaStatus,
          lastPriority: c.lastPriority,
          updatedAt: c.updatedAt,
          latestAgent: latest?.agentType,
          latestAgentStatus: latest?.status,
        };
      }),
      events: getRecentSupportEvents(40),
    },
  });
}

export async function streamSupportEvents(req: Request, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event: SupportEvent) => {
    res.write(`event: support\ndata: ${JSON.stringify(event)}\n\n`);
  };

  for (const e of getRecentSupportEvents(30)) {
    send(e);
  }

  const unsubscribe = subscribeSupportEvents(send);
  const heartbeat = setInterval(() => {
    res.write(`: ping\n\n`);
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
