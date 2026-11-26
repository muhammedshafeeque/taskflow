/**
 * Each module that uses the approval engine registers one adapter: how to read the record
 * (title, amount, who asked) and, for "decision" types, what to do when the chain finishes.
 *
 * - decision: the chain *is* the approval (leave, expenses, purchase orders). Approve/reject buttons
 *   in the module act on the chain, and the final outcome is written back to the record.
 * - gate: the module's own action (send an invoice or quote, finalize payroll) is held until the
 *   chain approves. The first attempt submits the request.
 */
import type { ApprovalRecordType } from './approval.models';

export interface ApprovalRecordInfo {
  title: string;
  amount: number;
  currency?: string;
  /** Who is asking. Gate types fall back to the person who triggered the action. */
  requesterUserId?: string | null;
  link: string;
}

export interface ApprovalAdapter {
  type: ApprovalRecordType;
  label: string;
  mode: 'decision' | 'gate';
  /** What the amount means, for the policy editor ("Total", "Days"…). */
  amountLabel: string;
  load(orgId: string, recordId: string): Promise<ApprovalRecordInfo | null>;
  onApproved?(orgId: string, recordId: string, actorUserId: string): Promise<void>;
  onRejected?(orgId: string, recordId: string, actorUserId: string, note?: string): Promise<void>;
}

const adapters = new Map<ApprovalRecordType, ApprovalAdapter>();

export function registerApprovalAdapter(adapter: ApprovalAdapter): void {
  adapters.set(adapter.type, adapter);
}

let loaded: Promise<unknown> | null = null;

/** Adapters import module services, which import the engine; loading them lazily avoids an import cycle. */
export async function getApprovalAdapter(type: ApprovalRecordType): Promise<ApprovalAdapter | undefined> {
  if (!adapters.has(type)) {
    loaded ??= import('./approvalAdapters');
    await loaded;
  }
  return adapters.get(type);
}

export async function listApprovalAdapters(): Promise<ApprovalAdapter[]> {
  loaded ??= import('./approvalAdapters');
  await loaded;
  return [...adapters.values()];
}
