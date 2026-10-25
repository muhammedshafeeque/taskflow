import type { Model } from 'mongoose';
import { CrmLead } from '../crm/models/crmLead.model';
import { CrmDeal } from '../crm/models/crmDeal.model';
import { CrmQuote } from '../crm/models/crmQuote.model';
import { CrmContract } from '../crm/models/crmContract.model';
import { CrmAccount } from '../crm/models/crmAccount.model';
import { CustomerOrg } from '../customer-portal/customer-org/customerOrg.model';
import { Project } from '../projects/project.model';
import { Issue } from '../issues/issue.model';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import { ServiceTicket } from '../service-desk/models/serviceTicket.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { Asset } from '../assets/models/asset.model';
import { PurchaseOrder } from '../procurement/models/purchaseOrder.model';
import type { ModuleId } from '../../shared/constants/moduleAccess';

/**
 * Every record type that can sit in the record graph. Adding a type here makes it
 * linkable everywhere: the graph, the picker and the "Linked records" panel.
 */
export const RECORD_TYPES = [
  'lead',
  'deal',
  'quote',
  'contract',
  'account',
  'customer',
  'project',
  'issue',
  'invoice',
  'ticket',
  'employee',
  'asset',
  'purchase_order',
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];

export function isRecordType(value: unknown): value is RecordType {
  return typeof value === 'string' && (RECORD_TYPES as readonly string[]).includes(value);
}

type Doc = Record<string, unknown> & { _id: unknown };

/** A reference field that already points from this record to another one. */
export type FieldRef = {
  field: string;
  to: RecordType;
  /** Shown on the edge, e.g. "Deal" on a quote. */
  label: string;
  /**
   * Also look this field up in reverse (records of this type pointing at the target).
   * Off where one target has thousands of rows (issues of a project).
   */
  inverse?: boolean;
};

export type RecordTypeDef = {
  type: RecordType;
  label: string;
  module: ModuleId;
  /** Any one grants visibility. Empty = project membership (projects, issues). */
  permissions: string[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: Model<any>;
  /** False when the collection has no taskflowOrganizationId (issues are scoped by project). */
  orgScoped: boolean;
  select: string;
  /** Fields matched by the link picker. */
  searchFields: string[];
  title: (d: Doc) => string;
  subtitle: (d: Doc) => string | undefined;
  status: (d: Doc) => string | undefined;
  link: (d: Doc) => string;
  refs: FieldRef[];
};

const str = (v: unknown): string | undefined => (v == null || v === '' ? undefined : String(v));
const money = (d: Doc, field: string) =>
  d[field] != null ? `${str(d.currency) ?? ''} ${Number(d[field]).toLocaleString('en')}`.trim() : undefined;

export const RECORD_TYPE_DEFS: Record<RecordType, RecordTypeDef> = {
  lead: {
    type: 'lead',
    label: 'Lead',
    module: 'crm',
    permissions: ['taskflow.crm.lead.list', 'taskflow.crm.lead.read'],
    model: CrmLead,
    orgScoped: true,
    select: 'title companyName status accountId customerOrgId dealId',
    searchFields: ['title', 'companyName', 'contactName', 'contactEmail'],
    title: (d) => String(d.title),
    subtitle: (d) => str(d.companyName),
    status: (d) => str(d.status),
    link: (d) => `/crm/leads/${d._id}`,
    refs: [
      { field: 'accountId', to: 'account', label: 'Account', inverse: true },
      { field: 'customerOrgId', to: 'customer', label: 'Customer', inverse: true },
      { field: 'dealId', to: 'deal', label: 'Converted to deal', inverse: true },
    ],
  },
  deal: {
    type: 'deal',
    label: 'Deal',
    module: 'crm',
    permissions: ['taskflow.crm.deal.list', 'taskflow.crm.deal.read'],
    model: CrmDeal,
    orgScoped: true,
    select: 'title status value currency accountId customerOrgId projectId leadId',
    searchFields: ['title'],
    title: (d) => String(d.title),
    subtitle: (d) => money(d, 'value'),
    status: (d) => str(d.status),
    link: (d) => `/crm/deals/${d._id}`,
    refs: [
      { field: 'accountId', to: 'account', label: 'Account', inverse: true },
      { field: 'customerOrgId', to: 'customer', label: 'Customer', inverse: true },
      { field: 'projectId', to: 'project', label: 'Project', inverse: true },
      { field: 'leadId', to: 'lead', label: 'From lead', inverse: true },
    ],
  },
  quote: {
    type: 'quote',
    label: 'Quote',
    module: 'crm',
    permissions: ['taskflow.crm.quote.list', 'taskflow.crm.quote.read'],
    model: CrmQuote,
    orgScoped: true,
    select: 'title status total currency dealId leadId accountId customerOrgId projectId',
    searchFields: ['title'],
    title: (d) => String(d.title),
    subtitle: (d) => money(d, 'total'),
    status: (d) => str(d.status),
    link: (d) => `/crm/quotes/${d._id}`,
    refs: [
      { field: 'dealId', to: 'deal', label: 'Deal', inverse: true },
      { field: 'leadId', to: 'lead', label: 'Lead', inverse: true },
      { field: 'accountId', to: 'account', label: 'Account', inverse: true },
      { field: 'customerOrgId', to: 'customer', label: 'Customer', inverse: true },
      { field: 'projectId', to: 'project', label: 'Project', inverse: true },
    ],
  },
  contract: {
    type: 'contract',
    label: 'Contract',
    module: 'contracts',
    permissions: ['taskflow.crm.contract.list', 'taskflow.crm.contract.read', 'taskflow.contracts.msa.list'],
    model: CrmContract,
    orgScoped: true,
    select: 'title kind status value currency accountId customerOrgId dealId projectId',
    searchFields: ['title'],
    title: (d) => String(d.title),
    subtitle: (d) => [str(d.kind), money(d, 'value')].filter(Boolean).join(' · ') || undefined,
    status: (d) => str(d.status),
    link: (d) => `/contracts/${d._id}`,
    refs: [
      { field: 'accountId', to: 'account', label: 'Account', inverse: true },
      { field: 'customerOrgId', to: 'customer', label: 'Customer', inverse: true },
      { field: 'dealId', to: 'deal', label: 'Deal', inverse: true },
      { field: 'projectId', to: 'project', label: 'Project', inverse: true },
    ],
  },
  account: {
    type: 'account',
    label: 'Account',
    module: 'crm',
    permissions: ['taskflow.crm.account.list', 'taskflow.crm.account.read'],
    model: CrmAccount,
    orgScoped: true,
    select: 'name type customerOrgId projectIds',
    searchFields: ['name'],
    title: (d) => String(d.name),
    subtitle: (d) => str(d.type),
    status: () => undefined,
    link: (d) => `/crm/accounts/${d._id}`,
    refs: [
      { field: 'customerOrgId', to: 'customer', label: 'Customer', inverse: true },
      { field: 'projectIds', to: 'project', label: 'Project', inverse: true },
    ],
  },
  customer: {
    type: 'customer',
    label: 'Customer',
    module: 'portal-admin',
    permissions: ['taskflow.customer_portal.org.view', 'taskflow.customer_portal.org.manage'],
    model: CustomerOrg,
    orgScoped: true,
    select: 'name status crmAccountId',
    searchFields: ['name'],
    title: (d) => String(d.name),
    subtitle: () => undefined,
    status: (d) => str(d.status),
    link: (d) => `/customers/${d._id}`,
    refs: [{ field: 'crmAccountId', to: 'account', label: 'CRM account', inverse: true }],
  },
  project: {
    type: 'project',
    label: 'Project',
    module: 'pm',
    permissions: [],
    model: Project,
    orgScoped: true,
    select: 'name key status',
    searchFields: ['name', 'key'],
    title: (d) => String(d.name),
    subtitle: (d) => str(d.key),
    status: (d) => str(d.status),
    link: (d) => `/projects/${d._id}`,
    refs: [],
  },
  issue: {
    type: 'issue',
    label: 'Issue',
    module: 'pm',
    permissions: [],
    model: Issue,
    orgScoped: false,
    select: 'key title status type project linkedServiceTicketId',
    searchFields: ['key', 'title'],
    title: (d) => (d.key ? `${d.key} · ${d.title}` : String(d.title)),
    subtitle: (d) => str(d.type),
    status: (d) => str(d.status),
    link: (d) => `/projects/${d.project}/issues/${encodeURIComponent(String(d.key ?? d._id))}`,
    refs: [
      { field: 'project', to: 'project', label: 'Project' },
      { field: 'linkedServiceTicketId', to: 'ticket', label: 'Ticket', inverse: true },
    ],
  },
  invoice: {
    type: 'invoice',
    label: 'Invoice',
    module: 'billing',
    permissions: ['taskflow.billing.invoice.list', 'taskflow.accounts.invoice.list', 'taskflow.accounts.invoice.read'],
    model: BillingInvoice,
    orgScoped: true,
    select: 'number status total currency accountId customerOrgId contractId projectId',
    searchFields: ['number', 'poNumber'],
    title: (d) => String(d.number),
    subtitle: (d) => money(d, 'total'),
    status: (d) => str(d.status),
    link: (d) => `/billing/invoices/${d._id}`,
    refs: [
      { field: 'accountId', to: 'account', label: 'Account', inverse: true },
      { field: 'customerOrgId', to: 'customer', label: 'Customer', inverse: true },
      { field: 'contractId', to: 'contract', label: 'Contract', inverse: true },
      { field: 'projectId', to: 'project', label: 'Project', inverse: true },
    ],
  },
  ticket: {
    type: 'ticket',
    label: 'Ticket',
    module: 'service',
    permissions: ['taskflow.service.ticket.list', 'taskflow.service.ticket.read'],
    model: ServiceTicket,
    orgScoped: true,
    select: 'subject status priority accountId contractId projectId customerOrgId linkedIssueId',
    searchFields: ['subject'],
    title: (d) => String(d.subject),
    subtitle: (d) => str(d.priority),
    status: (d) => str(d.status),
    link: (d) => `/service/tickets?ticket=${d._id}`,
    refs: [
      { field: 'linkedIssueId', to: 'issue', label: 'Issue', inverse: true },
      { field: 'projectId', to: 'project', label: 'Project', inverse: true },
      { field: 'contractId', to: 'contract', label: 'Contract', inverse: true },
      { field: 'accountId', to: 'account', label: 'Account', inverse: true },
      { field: 'customerOrgId', to: 'customer', label: 'Customer', inverse: true },
    ],
  },
  employee: {
    type: 'employee',
    label: 'Employee',
    module: 'hrms',
    permissions: ['taskflow.hr.employee.list', 'taskflow.hr.employee.read'],
    model: HrmsEmployee,
    orgScoped: true,
    select: 'name employeeCode designation status managerId',
    searchFields: ['name', 'employeeCode', 'email'],
    title: (d) => String(d.name),
    subtitle: (d) => [str(d.employeeCode), str(d.designation)].filter(Boolean).join(' · ') || undefined,
    status: (d) => str(d.status),
    link: (d) => `/hrms/employees?employee=${d._id}`,
    refs: [{ field: 'managerId', to: 'employee', label: 'Manager', inverse: true }],
  },
  asset: {
    type: 'asset',
    label: 'Asset',
    module: 'assets',
    permissions: ['taskflow.assets.inventory.list', 'taskflow.assets.inventory.manage'],
    model: Asset,
    orgScoped: true,
    select: 'assetTag name status accountId purchaseOrderId projectId',
    searchFields: ['assetTag', 'name', 'serialNumber'],
    title: (d) => `${d.assetTag} · ${d.name}`,
    subtitle: () => undefined,
    status: (d) => str(d.status),
    link: (d) => `/assets/inventory?asset=${d._id}`,
    refs: [
      { field: 'purchaseOrderId', to: 'purchase_order', label: 'Purchase order', inverse: true },
      { field: 'projectId', to: 'project', label: 'Project', inverse: true },
      { field: 'accountId', to: 'account', label: 'Account', inverse: true },
    ],
  },
  purchase_order: {
    type: 'purchase_order',
    label: 'Purchase order',
    module: 'procurement',
    permissions: ['taskflow.procurement.po.list', 'taskflow.procurement.po.manage'],
    model: PurchaseOrder,
    orgScoped: true,
    select: 'poNumber title status total currency vendorAccountId contractId projectId',
    searchFields: ['poNumber', 'title'],
    title: (d) => `${d.poNumber} · ${d.title}`,
    subtitle: (d) => money(d, 'total'),
    status: (d) => str(d.status),
    link: (d) => `/procurement/pos?po=${d._id}`,
    refs: [
      { field: 'vendorAccountId', to: 'account', label: 'Vendor', inverse: true },
      { field: 'contractId', to: 'contract', label: 'Contract', inverse: true },
      { field: 'projectId', to: 'project', label: 'Project', inverse: true },
    ],
  },
};
