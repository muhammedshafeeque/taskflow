import mongoose from 'mongoose';
import { CrmLead } from '../models/crmLead.model';
import { CrmContact } from '../models/crmContact.model';
import { CustomerOrg } from '../../customer-portal/customer-org/customerOrg.model';
import { escapeRegex } from '../../../utils/safeUrl';
import { toOrgOid } from '../crmWorkspace';

/** Why two records look like the same customer. */
export type DuplicateReason = 'email' | 'phone' | 'company' | 'domain' | 'contact';

export interface DuplicateCandidate {
  contactEmail?: string;
  contactPhone?: string;
  companyName?: string;
  website?: string;
  additionalContacts?: Array<{ email?: string; phone?: string }>;
}

export interface LeadDuplicate {
  _id: string;
  title: string;
  status: string;
  companyName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  updatedAt?: Date;
  reasons: DuplicateReason[];
  assigneeId?: string;
  assigneeName?: string;
  /** Set when the match is outside the viewer's CRM reach: only that it exists, and who has it, is shown. */
  outOfScope?: boolean;
}

export interface CustomerOrgMatch {
  _id: string;
  name: string;
  status?: string;
  contactEmail?: string;
  contactPhone?: string;
  reasons: DuplicateReason[];
}

/** Mailbox providers whose domain says nothing about the company. */
const FREE_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'ymail.com', 'outlook.com',
  'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me',
  'protonmail.com', 'zoho.com', 'zohomail.com', 'yandex.com', 'yandex.ru', 'gmx.com', 'gmx.net', 'mail.com',
  'rediffmail.com', 'qq.com', '163.com', 'tutanota.com', 'fastmail.com',
]);

/** Legal-form words dropped before comparing company names ("Acme Pvt. Ltd." = "ACME"). */
const COMPANY_SUFFIXES = new Set([
  'inc', 'incorporated', 'ltd', 'limited', 'llc', 'llp', 'lp', 'plc', 'pvt', 'private', 'corp', 'corporation',
  'co', 'company', 'gmbh', 'ag', 'sa', 'sarl', 'bv', 'nv', 'pty', 'pte', 'oy', 'ab', 'as', 'srl', 'spa', 'kk',
  'the', 'group', 'holdings',
]);

/** Digits compared from the end, so "+91 98765 43210" matches "098765-43210". */
const PHONE_TAIL = 9;

export function normEmail(v?: string | null): string | undefined {
  const s = String(v ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : undefined;
}

export function normPhone(v?: string | null): string | undefined {
  const digits = String(v ?? '').replace(/\D/g, '');
  if (digits.length < 7) return undefined;
  return digits.slice(-PHONE_TAIL);
}

export function normCompany(v?: string | null): string | undefined {
  const words = String(v ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !COMPANY_SUFFIXES.has(w));
  const s = words.join(' ');
  return s.length >= 2 ? s : undefined;
}

/** Host of a website without "www.", or undefined when it is not a usable domain. */
export function normDomain(v?: string | null): string | undefined {
  let s = String(v ?? '').trim().toLowerCase();
  if (!s) return undefined;
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  s = s.split(/[/?#:]/)[0] ?? '';
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : undefined;
}

/** Company domain from a work email; free mailbox domains give nothing. */
export function emailDomain(email?: string | null): string | undefined {
  const e = normEmail(email);
  if (!e) return undefined;
  const d = e.split('@')[1];
  return d && !FREE_MAIL_DOMAINS.has(d) ? d : undefined;
}

type Keys = { emails: Set<string>; phones: Set<string>; company?: string; domains: Set<string> };

export function candidateKeys(c: DuplicateCandidate): Keys {
  const emails = new Set<string>();
  const phones = new Set<string>();
  const domains = new Set<string>();
  const addEmail = (e?: string) => {
    const n = normEmail(e);
    if (n) emails.add(n);
    const d = emailDomain(e);
    if (d) domains.add(d);
  };
  const addPhone = (p?: string) => {
    const n = normPhone(p);
    if (n) phones.add(n);
  };
  addEmail(c.contactEmail);
  addPhone(c.contactPhone);
  for (const x of c.additionalContacts ?? []) {
    addEmail(x.email);
    addPhone(x.phone);
  }
  const site = normDomain(c.website);
  if (site) domains.add(site);
  return { emails, phones, company: normCompany(c.companyName), domains };
}

export function hasKeys(k: Keys): boolean {
  return k.emails.size > 0 || k.phones.size > 0 || Boolean(k.company) || k.domains.size > 0;
}

/** Which of the candidate's keys another lead shares. Pure, so it is unit-tested. */
export function leadMatchReasons(k: Keys, other: DuplicateCandidate): DuplicateReason[] {
  const o = candidateKeys(other);
  const reasons: DuplicateReason[] = [];
  if ([...o.emails].some((e) => k.emails.has(e))) reasons.push('email');
  if ([...o.phones].some((p) => k.phones.has(p))) reasons.push('phone');
  if (k.company && o.company && k.company === o.company) reasons.push('company');
  if ([...o.domains].some((d) => k.domains.has(d))) reasons.push('domain');
  return reasons;
}

/** Regex matching a phone stored in any format whose last digits equal `tail`. */
function phoneRegex(tail: string): RegExp {
  return new RegExp(`${tail.split('').join('\\D*')}\\D*$`);
}

/** First word of a normalised company name, used to narrow the database scan. */
function companyProbe(company: string): RegExp {
  const first = company.split(' ').sort((a, b) => b.length - a.length)[0] ?? company;
  return new RegExp(escapeRegex(first), 'i');
}

const SCAN_LIMIT = 200;

function assigneeOf(a: unknown): { assigneeId?: string; assigneeName?: string } {
  if (!a) return {};
  if (typeof a === 'object' && '_id' in a) {
    const p = a as { _id: unknown; name?: string };
    return { assigneeId: String(p._id), assigneeName: p.name };
  }
  return { assigneeId: String(a) };
}
const RESULT_LIMIT = 10;

/**
 * Leads in the workspace that look like the same customer: same email or phone (main or extra
 * contacts), same company name ignoring legal suffixes, or same company web domain.
 */
export async function findLeadDuplicates(
  orgId: string,
  candidate: DuplicateCandidate,
  opts: { excludeIds?: string[] } = {}
): Promise<LeadDuplicate[]> {
  const keys = candidateKeys(candidate);
  if (!hasKeys(keys)) return [];
  const or: Record<string, unknown>[] = [];
  const emails = [...keys.emails];
  if (emails.length) {
    or.push({ contactEmail: { $in: emails } }, { 'additionalContacts.email': { $in: emails } });
  }
  for (const p of keys.phones) {
    const rx = phoneRegex(p);
    or.push({ contactPhone: rx }, { 'additionalContacts.phone': rx });
  }
  if (keys.company) or.push({ companyName: companyProbe(keys.company) });
  for (const d of keys.domains) {
    const rx = new RegExp(`(^|[/.@])${escapeRegex(d)}($|[/:?#])`, 'i');
    or.push({ website: rx }, { contactEmail: new RegExp(`@${escapeRegex(d)}$`, 'i') });
  }
  const exclude = (opts.excludeIds ?? []).filter((id) => mongoose.isValidObjectId(id)).map((id) => new mongoose.Types.ObjectId(id));
  const rows = await CrmLead.find({
    taskflowOrganizationId: toOrgOid(orgId),
    ...(exclude.length ? { _id: { $nin: exclude } } : {}),
    $or: or,
  })
    .select('title status companyName contactName contactEmail contactPhone website additionalContacts updatedAt assigneeId')
    .populate('assigneeId', 'name')
    .sort({ updatedAt: -1 })
    .limit(SCAN_LIMIT)
    .lean();

  const out: LeadDuplicate[] = [];
  for (const r of rows) {
    const reasons = leadMatchReasons(keys, r as DuplicateCandidate);
    if (!reasons.length) continue;
    out.push({
      _id: String(r._id),
      title: r.title,
      status: r.status,
      companyName: r.companyName,
      contactName: r.contactName,
      contactEmail: r.contactEmail,
      contactPhone: r.contactPhone,
      updatedAt: r.updatedAt,
      reasons,
      ...assigneeOf(r.assigneeId),
    });
  }
  return rankByReasons(out).slice(0, RESULT_LIMIT);
}

/**
 * Customer organisations in the workspace the candidate probably belongs to: same name ignoring
 * legal suffixes, same contact email, phone or work-email domain, or a CRM contact with the
 * candidate's email already filed under that organisation.
 */
export async function findCustomerOrgMatches(
  orgId: string,
  candidate: DuplicateCandidate & { orgName?: string }
): Promise<CustomerOrgMatch[]> {
  const keys = candidateKeys(candidate);
  const names = [normCompany(candidate.orgName), keys.company].filter(Boolean) as string[];
  if (!hasKeys(keys) && !names.length) return [];
  const orgOid = toOrgOid(orgId);
  const or: Record<string, unknown>[] = [];
  const emails = [...keys.emails];
  if (emails.length) or.push({ contactEmail: { $in: emails } });
  for (const p of keys.phones) or.push({ contactPhone: phoneRegex(p) });
  for (const n of new Set(names)) or.push({ name: companyProbe(n) });
  for (const d of keys.domains) or.push({ contactEmail: new RegExp(`@${escapeRegex(d)}$`, 'i') });

  const viaContacts = emails.length
    ? await CrmContact.find({
        taskflowOrganizationId: orgOid,
        email: { $in: emails },
        customerOrgId: { $ne: null },
      })
        .select('customerOrgId')
        .lean()
    : [];
  const contactOrgIds = new Set(viaContacts.map((c) => String(c.customerOrgId)));
  if (contactOrgIds.size) or.push({ _id: { $in: [...contactOrgIds].map((id) => new mongoose.Types.ObjectId(id)) } });
  if (!or.length) return [];

  const rows = await CustomerOrg.find({ taskflowOrganizationId: orgOid, $or: or })
    .select('name status contactEmail contactPhone')
    .limit(SCAN_LIMIT)
    .lean();

  const nameSet = new Set(names);
  const out: CustomerOrgMatch[] = [];
  for (const r of rows) {
    const reasons: DuplicateReason[] = [];
    const email = normEmail(r.contactEmail);
    if (email && keys.emails.has(email)) reasons.push('email');
    const phone = normPhone(r.contactPhone);
    if (phone && keys.phones.has(phone)) reasons.push('phone');
    const name = normCompany(r.name);
    if (name && nameSet.has(name)) reasons.push('company');
    const domain = emailDomain(r.contactEmail);
    if (domain && keys.domains.has(domain)) reasons.push('domain');
    if (contactOrgIds.has(String(r._id))) reasons.push('contact');
    if (!reasons.length) continue;
    out.push({
      _id: String(r._id),
      name: r.name,
      status: r.status,
      contactEmail: r.contactEmail,
      contactPhone: r.contactPhone,
      reasons,
    });
  }
  return rankByReasons(out).slice(0, RESULT_LIMIT);
}

/** Strongest evidence first: email/phone/contact outrank a shared name or domain. */
function rankByReasons<T extends { reasons: DuplicateReason[] }>(rows: T[]): T[] {
  const weight: Record<DuplicateReason, number> = { email: 4, contact: 4, phone: 3, company: 2, domain: 1 };
  const score = (r: T) => r.reasons.reduce((s, x) => s + weight[x], 0);
  return [...rows].sort((a, b) => score(b) - score(a));
}
