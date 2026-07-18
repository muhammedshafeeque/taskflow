import { requireWorkspaceId, toOrgOid } from '../crm/crmWorkspace';
import { CrmAccount } from '../crm/models/crmAccount.model';
import { CrmDeal } from '../crm/models/crmDeal.model';
import { CrmContact } from '../crm/models/crmContact.model';
import { CrmContract } from '../crm/models/crmContract.model';
import { BillingInvoice } from '../billing/models/billingInvoice.model';
import { ServiceTicket } from '../service-desk/models/serviceTicket.model';
import { Project } from '../projects/project.model';

export type SearchHit = {
  type: 'account' | 'contact' | 'deal' | 'contract' | 'invoice' | 'ticket' | 'project';
  id: string;
  title: string;
  subtitle?: string;
  link: string;
};

export async function globalSearch(
  workspaceId: string | null | undefined,
  rawQuery: string
): Promise<{ query: string; hits: SearchHit[]; groups: Record<string, number> }> {
  const orgId = requireWorkspaceId(workspaceId);
  const orgOid = toOrgOid(orgId);
  const q = (rawQuery || '').trim();
  if (q.length < 2) return { query: q, hits: [], groups: {} };
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const base = { taskflowOrganizationId: orgOid };
  const limit = 6;

  const [accounts, contacts, deals, contracts, invoices, tickets, projects] = await Promise.all([
    CrmAccount.find({ ...base, name: rx }).limit(limit).lean(),
    CrmContact.find({ ...base, $or: [{ name: rx }, { email: rx }] }).limit(limit).lean(),
    CrmDeal.find({ ...base, title: rx }).limit(limit).lean(),
    CrmContract.find({ ...base, title: rx }).limit(limit).lean(),
    BillingInvoice.find({ ...base, number: rx }).limit(limit).lean(),
    ServiceTicket.find({ ...base, subject: rx }).limit(limit).lean(),
    Project.find({ ...base, name: rx }).limit(limit).lean().catch(() => []),
  ]);

  const hits: SearchHit[] = [];
  for (const a of accounts) hits.push({ type: 'account', id: String(a._id), title: a.name, subtitle: a.type, link: `/crm/accounts/${a._id}` });
  for (const c of contacts as Array<Record<string, unknown>>)
    hits.push({
      type: 'contact',
      id: String(c._id),
      title: String(c.name ?? c.email ?? 'Contact'),
      subtitle: c.email as string | undefined,
      link: '/crm/contacts',
    });
  for (const d of deals) hits.push({ type: 'deal', id: String(d._id), title: d.title, subtitle: d.status, link: '/crm/deals' });
  for (const c of contracts) hits.push({ type: 'contract', id: String(c._id), title: c.title, subtitle: c.kind, link: '/contracts' });
  for (const i of invoices) hits.push({ type: 'invoice', id: String(i._id), title: i.number, subtitle: i.status, link: '/billing/invoices' });
  for (const t of tickets) hits.push({ type: 'ticket', id: String(t._id), title: t.subject, subtitle: t.status, link: '/service/tickets' });
  for (const p of projects as Array<Record<string, unknown>>)
    hits.push({ type: 'project', id: String(p._id), title: String(p.name ?? 'Project'), subtitle: p.status as string | undefined, link: `/projects/${p._id}` });

  const groups = hits.reduce<Record<string, number>>((acc, h) => {
    acc[h.type] = (acc[h.type] ?? 0) + 1;
    return acc;
  }, {});

  return { query: q, hits, groups };
}
