import * as auditLogService from './auditLog.service';

/** In-flight fire-and-forget writes — awaited before test teardown / shutdown. */
const pending = new Set<Promise<unknown>>();

function isClosedClientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string; constructor?: { name?: string } }).name
    ?? (err as { constructor?: { name?: string } }).constructor?.name
    ?? '';
  const msg = String((err as { message?: string }).message ?? '');
  return (
    name === 'MongoClientClosedError' ||
    msg.includes('client was closed') ||
    msg.includes('topology was destroyed') ||
    msg.includes('connection closed')
  );
}

export function logAudit(input: auditLogService.CreateAuditLogInput): void {
  const p = auditLogService.create(input).catch((err) => {
    // Teardown / process exit often closes Mongo while an audit is still flushing.
    if (isClosedClientError(err)) return;
    console.error('[AuditLog] Failed to write audit log:', err);
  });
  pending.add(p);
  void p.finally(() => pending.delete(p));
}

/** Wait for outstanding audit writes (integration-test teardown). */
export async function flushAuditLogs(): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
  }
}
