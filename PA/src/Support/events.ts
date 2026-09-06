import { EventEmitter } from 'events';

export type SupportEventType =
  | 'NEW_ISSUE_DETECTED'
  | 'ISSUE_SENT_TO_QA'
  | 'QA_VERIFICATION_STARTED'
  | 'QA_VERIFICATION_COMPLETED'
  | 'TICKET_CREATED'
  | 'TICKET_UPDATED'
  | 'DUPLICATE_ISSUE_FOUND'
  | 'ISSUE_RESOLVED'
  | 'SUPPORT_REPLY_SENT';

export type SupportEvent = {
  id: string;
  type: SupportEventType;
  at: string;
  groupId?: string;
  groupName?: string;
  projectId?: string;
  projectName?: string;
  ticketId?: string;
  priority?: string;
  summary?: string;
  qaStatus?: string;
  agent?: string;
  payload?: Record<string, unknown>;
};

const MAX_BUFFER = 200;
const bus = new EventEmitter();
bus.setMaxListeners(50);
const ring: SupportEvent[] = [];

export function emitSupportEvent(
  partial: Omit<SupportEvent, 'id' | 'at'> & { at?: string }
): SupportEvent {
  const event: SupportEvent = {
    ...partial,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: partial.at || new Date().toISOString(),
  };
  ring.push(event);
  if (ring.length > MAX_BUFFER) ring.splice(0, ring.length - MAX_BUFFER);
  bus.emit('support', event);
  console.log('Support event', event.type, {
    groupId: event.groupId,
    ticketId: event.ticketId,
    summary: event.summary?.slice(0, 80),
  });
  return event;
}

export function getRecentSupportEvents(limit = 50): SupportEvent[] {
  return ring.slice(-limit);
}

export function subscribeSupportEvents(
  listener: (e: SupportEvent) => void
): () => void {
  bus.on('support', listener);
  return () => bus.off('support', listener);
}
