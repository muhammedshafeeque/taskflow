/**
 * The record types that use the shared approval engine. Loaded lazily by approvalRegistry.
 */
import mongoose from 'mongoose';
import { toOrgOid } from '../crm/crmWorkspace';
import { registerApprovalAdapter } from './approvalRegistry';
import { AccountExpense } from '../accounts/models/accountExpense.model';
import { applyExpenseChainOutcome } from '../accounts/accounts.service';
import { PurchaseOrder } from '../procurement/models/purchaseOrder.model';
import { applyPoChainOutcome } from '../procurement/procurement.service';
import { HrmsLeaveRequest } from '../hrms/models/hrmsLeaveRequest.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { applyLeaveDecision } from '../hrms/hrms.service';
import { HrmsPayrollRun } from '../hrms/models/hrmsPayroll.model';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import { CrmQuote } from '../crm/models/crmQuote.model';

const valid = (id: string) => mongoose.Types.ObjectId.isValid(id);
const str = (v: unknown) => (v == null ? null : String(v));

registerApprovalAdapter({
  type: 'expense',
  label: 'Expense claims',
  mode: 'decision',
  amountLabel: 'Amount',
  async load(orgId, id) {
    if (!valid(id)) return null;
    const x = await AccountExpense.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) }).lean();
    if (!x) return null;
    return { title: `Expense ${x.reference}: ${x.description}`, amount: x.amount, currency: x.currency, requesterUserId: str(x.submittedBy), link: '/accounts/expenses' };
  },
  onApproved: (orgId, id, userId) => applyExpenseChainOutcome(orgId, id, 'approved', userId),
  onRejected: (orgId, id, userId) => applyExpenseChainOutcome(orgId, id, 'rejected', userId),
});

registerApprovalAdapter({
  type: 'purchase_order',
  label: 'Purchase orders',
  mode: 'decision',
  amountLabel: 'Total',
  async load(orgId, id) {
    if (!valid(id)) return null;
    const po = await PurchaseOrder.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) }).lean();
    if (!po) return null;
    return { title: `${po.poNumber}: ${po.title}`, amount: po.total, currency: po.currency, requesterUserId: str(po.requestedBy), link: '/procurement/pos' };
  },
  onApproved: (orgId, id, userId) => applyPoChainOutcome(orgId, id, 'approved', userId),
  onRejected: (orgId, id, userId) => applyPoChainOutcome(orgId, id, 'rejected', userId),
});

registerApprovalAdapter({
  type: 'leave',
  label: 'Leave requests',
  mode: 'decision',
  amountLabel: 'Days',
  async load(orgId, id) {
    if (!valid(id)) return null;
    const leave = await HrmsLeaveRequest.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) }).lean();
    if (!leave) return null;
    const emp = await HrmsEmployee.findById(leave.employeeId).select('name userId').lean();
    return {
      title: `Leave: ${emp?.name ?? 'Employee'}, ${leave.days} day(s) from ${new Date(leave.startDate).toDateString()}`,
      amount: leave.days,
      requesterUserId: str(emp?.userId),
      link: '/hrms/leave',
    };
  },
  onApproved: async (orgId, id, userId) => {
    await applyLeaveDecision(id, orgId, 'approved', userId, true);
  },
  onRejected: async (orgId, id, userId) => {
    await applyLeaveDecision(id, orgId, 'rejected', userId, true);
  },
});

registerApprovalAdapter({
  type: 'payroll',
  label: 'Payroll runs',
  mode: 'gate',
  amountLabel: 'Net pay',
  async load(orgId, id) {
    if (!valid(id)) return null;
    const run = await HrmsPayrollRun.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) }).select('period totals').lean();
    if (!run) return null;
    return { title: `Payroll ${run.period}`, amount: run.totals?.net ?? 0, currency: run.totals?.currency ?? undefined, link: '/hrms/payroll' };
  },
});

registerApprovalAdapter({
  type: 'invoice',
  label: 'Invoices',
  mode: 'gate',
  amountLabel: 'Total',
  async load(orgId, id) {
    if (!valid(id)) return null;
    const inv = await BillingInvoice.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) }).select('number total currency createdBy').lean();
    if (!inv) return null;
    return { title: `Invoice ${inv.number}`, amount: inv.total, currency: inv.currency, requesterUserId: str(inv.createdBy), link: `/billing/invoices/${id}` };
  },
});

registerApprovalAdapter({
  type: 'quote',
  label: 'Quotations',
  mode: 'gate',
  amountLabel: 'Total',
  async load(orgId, id) {
    if (!valid(id)) return null;
    const q = await CrmQuote.findOne({ _id: id, taskflowOrganizationId: toOrgOid(orgId) }).select('title total currency createdBy').lean();
    if (!q) return null;
    return { title: `Quote: ${q.title}`, amount: q.total, currency: q.currency, requesterUserId: str(q.createdBy), link: `/crm/quotes/${id}` };
  },
});
