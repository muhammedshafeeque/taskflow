import mongoose from 'mongoose';
import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { CrmAccount } from '../crm/models/crmAccount.model';
import { CrmDeal } from '../crm/models/crmDeal.model';
import { CrmContact } from '../crm/models/crmContact.model';
import { CrmContract } from '../crm/models/crmContract.model';
import { CrmLead } from '../crm/models/crmLead.model';
import { CrmQuote } from '../crm/models/crmQuote.model';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import { ServiceTicket } from '../service-desk/models/serviceTicket.model';
import { KbArticle } from '../service-desk/models/kbArticle.model';
import { HrmsEmployee } from '../hrms/models/hrmsEmployee.model';
import { DocumentRecord } from '../documents/models/documentRecord.model';
import { Project } from '../projects/project.model';
import { ProjectMember } from '../projects/projectMember.model';
import { Issue } from '../issues/issue.model';
import { userHasPermission } from '../../shared/constants/legacyPermissionMap';
import { getPlatformEnabledModules } from '../core/core.service';
import { isModuleEnabled, type ModuleId } from '../../shared/constants/moduleAccess';

export type SearchHitType =
  | 'issue'
  | 'project'
  | 'account'
  | 'contact'
  | 'lead'
  | 'deal'
  | 'quote'
  | 'contract'
  | 'invoice'
  | 'ticket'
  | 'kb'
  | 'employee'
  | 'document';

export type SearchHit = {
  type: SearchHitType;
  id: string;
  title: string;
  subtitle?: string;
  link: string;
};

export type SearchViewer = { userId: string; permissions: string[] };

type Source = {
  type: SearchHitType;
  module: ModuleId;
  /** Any one of these grants visibility. Empty = membership-scoped (issues/projects). */
  permissions: string[];
  run: (ctx: { orgOid: mongoose.Types.ObjectId; rx: RegExp; limit: number; userId: string }) => Promise<SearchHit[]>;
};

const DOCUMENT_LINKS: Record<string, string> = {
  proposal: '/documents/proposals',
  sow: '/documents/sows',
  policy: '/documents/policies',
  template: '/documents/templates',
};

async function memberProjectIds(userId: string, orgOid: mongoose.Types.ObjectId) {
  const ids = await ProjectMember.find({ user: new mongoose.Types.ObjectId(userId) }).distinct('project');
  if (!ids.length) return [];
  // Keep to the active workspace; legacy projects without an org stay visible to members.
  return Project.find({
    _id: { $in: ids },
    $or: [{ taskflowOrganizationId: orgOid }, { taskflowOrganizationId: null }],
  }).distinct('_id');
}

const SOURCES: Source[] = [
  {
    type: 'issue',
    module: 'pm',
    permissions: [],
    run: async ({ orgOid, rx, limit, userId }) => {
      const projectIds = await memberProjectIds(userId, orgOid);
      if (!projectIds.length) return [];
      const rows = await Issue.find({ project: { $in: projectIds }, $or: [{ key: rx }, { title: rx }] })
        .select('key title status type project')
        .sort({ updatedAt: -1 })
        .limit(limit)
        .lean();
      return rows.map((i) => ({
        type: 'issue' as const,
        id: String(i._id),
        title: i.key ? `${i.key} · ${i.title}` : i.title,
        subtitle: `${i.type} · ${i.status}`,
        link: `/projects/${i.project}/issues/${encodeURIComponent(i.key ?? String(i._id))}`,
      }));
    },
  },
  {
    type: 'project',
    module: 'pm',
    permissions: [],
    run: async ({ orgOid, rx, limit, userId }) => {
      const projectIds = await memberProjectIds(userId, orgOid);
      if (!projectIds.length) return [];
      const rows = await Project.find({ _id: { $in: projectIds }, $or: [{ name: rx }, { key: rx }] })
        .select('name key')
        .limit(limit)
        .lean();
      return rows.map((p) => ({
        type: 'project' as const,
        id: String(p._id),
        title: p.name,
        subtitle: (p as { key?: string }).key,
        link: `/projects/${p._id}`,
      }));
    },
  },
  {
    type: 'account',
    module: 'crm',
    permissions: ['taskflow.crm.account.list', 'taskflow.crm.account.read'],
    run: async ({ orgOid, rx, limit }) =>
      (await CrmAccount.find({ taskflowOrganizationId: orgOid, name: rx }).limit(limit).lean()).map((a) => ({
        type: 'account' as const,
        id: String(a._id),
        title: a.name,
        subtitle: a.type,
        link: `/crm/accounts/${a._id}`,
      })),
  },
  {
    type: 'contact',
    module: 'crm',
    permissions: ['taskflow.crm.contact.list', 'taskflow.crm.contact.read'],
    run: async ({ orgOid, rx, limit }) =>
      (
        (await CrmContact.find({ taskflowOrganizationId: orgOid, $or: [{ name: rx }, { email: rx }, { phone: rx }] })
          .limit(limit)
          .lean()) as Array<Record<string, unknown>>
      ).map((c) => ({
        type: 'contact' as const,
        id: String(c._id),
        title: String(c.name ?? c.email ?? 'Contact'),
        subtitle: c.email as string | undefined,
        link: c.email
          ? `/crm/contacts?email=${encodeURIComponent(String(c.email))}`
          : `/crm/contacts?name=${encodeURIComponent(String(c.name ?? ''))}`,
      })),
  },
  {
    type: 'lead',
    module: 'crm',
    permissions: ['taskflow.crm.lead.list', 'taskflow.crm.lead.read'],
    run: async ({ orgOid, rx, limit }) =>
      (
        await CrmLead.find({
          taskflowOrganizationId: orgOid,
          $or: [{ title: rx }, { companyName: rx }, { contactName: rx }, { contactEmail: rx }, { contactPhone: rx }],
        })
          .select('title companyName status')
          .sort({ updatedAt: -1 })
          .limit(limit)
          .lean()
      ).map((l) => ({
        type: 'lead' as const,
        id: String(l._id),
        title: l.title,
        subtitle: [l.companyName, l.status].filter(Boolean).join(' · '),
        link: `/crm/leads/${l._id}`,
      })),
  },
  {
    type: 'deal',
    module: 'crm',
    permissions: ['taskflow.crm.deal.list', 'taskflow.crm.deal.read'],
    run: async ({ orgOid, rx, limit }) =>
      (await CrmDeal.find({ taskflowOrganizationId: orgOid, title: rx }).limit(limit).lean()).map((d) => ({
        type: 'deal' as const,
        id: String(d._id),
        title: d.title,
        subtitle: `${d.status} · ${d.currency} ${d.value}`,
        link: '/crm/deals',
      })),
  },
  {
    type: 'quote',
    module: 'crm',
    permissions: ['taskflow.crm.quote.list', 'taskflow.crm.quote.read'],
    run: async ({ orgOid, rx, limit }) =>
      (await CrmQuote.find({ taskflowOrganizationId: orgOid, title: rx }).select('title status').limit(limit).lean()).map(
        (q) => ({
          type: 'quote' as const,
          id: String(q._id),
          title: q.title,
          subtitle: q.status,
          link: `/crm/quotes/${q._id}`,
        })
      ),
  },
  {
    type: 'contract',
    module: 'crm',
    permissions: ['taskflow.crm.contract.list', 'taskflow.crm.contract.read', 'taskflow.contracts.msa.list'],
    run: async ({ orgOid, rx, limit }) =>
      (await CrmContract.find({ taskflowOrganizationId: orgOid, title: rx }).limit(limit).lean()).map((c) => ({
        type: 'contract' as const,
        id: String(c._id),
        title: c.title,
        subtitle: `${c.kind} · ${c.status}`,
        link: `/contracts/${c._id}`,
      })),
  },
  {
    type: 'invoice',
    module: 'billing',
    permissions: ['taskflow.billing.invoice.list'],
    run: async ({ orgOid, rx, limit }) =>
      (await BillingInvoice.find({ taskflowOrganizationId: orgOid, number: rx }).limit(limit).lean()).map((i) => ({
        type: 'invoice' as const,
        id: String(i._id),
        title: i.number,
        subtitle: `${i.status} · ${i.currency} ${i.total}`,
        link: `/billing/invoices/${i._id}`,
      })),
  },
  {
    type: 'ticket',
    module: 'service',
    permissions: ['taskflow.service.ticket.list', 'taskflow.service.ticket.read'],
    run: async ({ orgOid, rx, limit }) =>
      (await ServiceTicket.find({ taskflowOrganizationId: orgOid, subject: rx }).sort({ updatedAt: -1 }).limit(limit).lean()).map(
        (t) => ({
          type: 'ticket' as const,
          id: String(t._id),
          title: t.subject,
          subtitle: `${t.status} · ${t.priority}`,
          link: `/service/tickets?ticket=${t._id}`,
        })
      ),
  },
  {
    type: 'kb',
    module: 'service',
    permissions: ['taskflow.service.kb.list', 'taskflow.service.kb.read'],
    run: async ({ orgOid, rx, limit }) =>
      (
        await KbArticle.find({ taskflowOrganizationId: orgOid, $or: [{ title: rx }, { category: rx }] })
          .select('title category published')
          .limit(limit)
          .lean()
      ).map((a) => ({
        type: 'kb' as const,
        id: String(a._id),
        title: a.title,
        subtitle: `${a.category}${a.published ? '' : ' · draft'}`,
        link: `/service/kb?q=${encodeURIComponent(a.title)}`,
      })),
  },
  {
    type: 'employee',
    module: 'hrms',
    permissions: ['taskflow.hr.employee.list', 'taskflow.hr.employee.read'],
    run: async ({ orgOid, rx, limit }) =>
      (
        await HrmsEmployee.find({
          taskflowOrganizationId: orgOid,
          $or: [{ name: rx }, { email: rx }, { employeeCode: rx }],
        })
          .select('name employeeCode designation department')
          .limit(limit)
          .lean()
      ).map((e) => ({
        type: 'employee' as const,
        id: String(e._id),
        title: e.name,
        subtitle: [e.employeeCode, e.designation, e.department].filter(Boolean).join(' · '),
        link: '/hrms/employees',
      })),
  },
  {
    type: 'document',
    module: 'documents',
    permissions: [
      'taskflow.documents.proposal.list',
      'taskflow.documents.sow.list',
      'taskflow.documents.policy.list',
      'taskflow.documents.template.list',
    ],
    run: async ({ orgOid, rx, limit }) =>
      (
        await DocumentRecord.find({ taskflowOrganizationId: orgOid, $or: [{ title: rx }, { tags: rx }] })
          .select('title kind status version')
          .limit(limit)
          .lean()
      ).map((d) => ({
        type: 'document' as const,
        id: String(d._id),
        title: d.title,
        subtitle: `${d.kind} · ${d.status} · v${d.version}`,
        link: DOCUMENT_LINKS[d.kind] ?? '/documents',
      })),
  },
];

export async function globalSearch(
  workspaceId: string | null | undefined,
  rawQuery: string,
  viewer: SearchViewer
): Promise<{ query: string; hits: SearchHit[]; groups: Record<string, number> }> {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const q = (rawQuery || '').trim().slice(0, 100);
  if (q.length < 2) return { query: q, hits: [], groups: {} };
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const enabled = await getPlatformEnabledModules();
  const visible = SOURCES.filter(
    (s) =>
      isModuleEnabled(s.module, enabled) &&
      (s.permissions.length === 0 || s.permissions.some((p) => userHasPermission(viewer.permissions, p)))
  );

  // An issue key like "APP-12" is almost always what the user wants — give issues more room.
  const looksLikeKey = /^[a-z][a-z0-9]*-\d+$/i.test(q);
  const results = await Promise.all(
    visible.map((s) =>
      s
        .run({ orgOid, rx, userId: viewer.userId, limit: s.type === 'issue' ? (looksLikeKey ? 10 : 8) : 5 })
        .catch((err) => {
          console.error(`search source ${s.type} failed`, err);
          return [] as SearchHit[];
        })
    )
  );

  // Exact title/key matches first, then source order.
  const lower = q.toLowerCase();
  const hits = results
    .flat()
    .map((h, i) => ({ h, i, exact: h.title.toLowerCase().startsWith(lower) ? 0 : 1 }))
    .sort((a, b) => a.exact - b.exact || a.i - b.i)
    .map((x) => x.h);

  const groups = hits.reduce<Record<string, number>>((acc, h) => {
    acc[h.type] = (acc[h.type] ?? 0) + 1;
    return acc;
  }, {});

  return { query: q, hits, groups };
}
