import { EventEmitter } from 'events';

export type AgentJobEvent = {
  id: string;
  jobId: string;
  type: 'log' | 'status' | 'done';
  at: string;
  line?: string;
  status?: string;
  summary?: string;
};

const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emitAgentJobEvent(
  partial: Omit<AgentJobEvent, 'id' | 'at'> & { at?: string }
): AgentJobEvent {
  const event: AgentJobEvent = {
    ...partial,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: partial.at || new Date().toISOString(),
  };
  bus.emit(`job:${partial.jobId}`, event);
  bus.emit('agent', event);
  return event;
}

export function subscribeAgentJob(
  jobId: string,
  listener: (e: AgentJobEvent) => void
): () => void {
  const key = `job:${jobId}`;
  bus.on(key, listener);
  return () => bus.off(key, listener);
}
