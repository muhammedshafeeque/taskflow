import * as auditLogService from './auditLog.service';

export function logAudit(input: auditLogService.CreateAuditLogInput): void {
  auditLogService.create(input).catch((err) => {
    console.error('[AuditLog] Failed to write audit log:', err);
  });
}
