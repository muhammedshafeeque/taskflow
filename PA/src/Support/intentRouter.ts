import type { WhatsappGroupDoc } from '../Models/WhatsappGroup';
import { normalizeGroupProjects } from '../Models/WhatsappGroup';
import type { ReplyLang } from '../Media/lang';
import {
  createPortalRequest,
  getBillingSummary,
  getHrmsMe,
  getIssueByKey,
  listTicketDigest,
  searchAssets,
  searchKb,
  searchPurchaseOrders,
  type KbArticleHit,
} from './context/ecosystemIngest';
import { searchClientDocs, searchClientKb } from './context/paInternalClient';

export type EcosystemIntent =
  | 'kb'
  | 'portal_request'
  | 'ticket_status'
  | 'issue_status'
  | 'billing'
  | 'hrms'
  | 'assets'
  | 'procurement'
  | 'none';

const ISSUE_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/;
const TICKET_STATUS =
  /\b(ticket\s*status|open\s*tickets|pending\s*tickets|any\s*updates?\s*on\s*tickets?|ticket\s*digest)\b/i;
const PORTAL_REQ =
  /\b(raise\s*(a\s*)?(request|change)|create\s*(a\s*)?(service\s*)?request|submit\s*(a\s*)?(change|feature)\s*request|portal\s*request)\b/i;
const BILLING =
  /\b(billing|invoice|outstanding|amount\s*due|payment\s*due|balance)\b/i;
const HRMS =
  /\b(leave\s*balance|my\s*leave|attendance|leave\s*days|time\s*off)\b/i;
const ASSETS = /\b(asset|laptop|inventory|device\s*tag|serial)\b/i;
const PROCUREMENT = /\b(purchase\s*order|\bPO\b|procurement|vendor\s*order)\b/i;
const FAQ =
  /\b(how\s*(do|to|can)|what\s*is|where\s*(is|can)|help\s*with|faq|guide|documentation)\b/i;

export function detectEcosystemIntent(text: string): {
  intent: EcosystemIntent;
  issueKey?: string;
  query?: string;
} {
  const t = text.trim();
  if (TICKET_STATUS.test(t)) return { intent: 'ticket_status' };
  if (PORTAL_REQ.test(t)) return { intent: 'portal_request', query: t };
  if (HRMS.test(t)) return { intent: 'hrms' };
  if (BILLING.test(t)) return { intent: 'billing' };
  if (PROCUREMENT.test(t)) return { intent: 'procurement', query: t };
  if (ASSETS.test(t)) return { intent: 'assets', query: t };

  const keyMatch = t.match(ISSUE_KEY);
  if (
    keyMatch &&
    !/^PO-/i.test(keyMatch[1]) &&
    (/\b(status|update|progress|where|sprint)\b/i.test(t) ||
      /^[A-Z][A-Z0-9]+-\d+$/.test(t.replace(/\s+/g, '')))
  ) {
    return { intent: 'issue_status', issueKey: keyMatch[1].toUpperCase() };
  }
  if (FAQ.test(t)) return { intent: 'kb', query: t };
  return { intent: 'none' };
}

function gateOk(
  group: WhatsappGroupDoc,
  intent: EcosystemIntent
): boolean {
  switch (intent) {
    case 'kb':
      return Boolean(group.kbEnabled);
    case 'portal_request':
      return Boolean(group.portalRequestsEnabled && group.customerOrgId);
    case 'ticket_status':
      return Boolean(group.ticketStatusEnabled);
    case 'issue_status':
      return Boolean(group.issueStatusEnabled);
    case 'billing':
      return Boolean(group.billingEnabled && group.customerOrgId);
    case 'hrms':
      return Boolean(group.hrmsEnabled);
    case 'assets':
      return Boolean(group.assetsEnabled);
    case 'procurement':
      return Boolean(group.procurementEnabled);
    default:
      return false;
  }
}

function formatKbReply(articles: KbArticleHit[], lang: ReplyLang): string {
  const top = articles[0];
  if (!top) {
    return lang === 'ml'
      ? 'അനുയോജ്യമായ നോളജ് ബേസ് ലേഖനം കണ്ടെത്തിയില്ല.'
      : 'No matching knowledge base article found.';
  }
  const snippet = top.body.replace(/\s+/g, ' ').trim().slice(0, 280);
  if (lang === 'ml') {
    return `KB: ${top.title}. ${snippet}${snippet.length >= 280 ? '…' : ''}`;
  }
  return `From our knowledge base — ${top.title}: ${snippet}${
    snippet.length >= 280 ? '…' : ''
  }`;
}

/** Service-desk KB for this chat, then the legacy ingest KB. */
async function searchKbForChat(
  query: string,
  chatId?: string,
  senderPhone?: string
): Promise<KbArticleHit[]> {
  if (chatId) {
    try {
      const kb = await searchClientKb(chatId, query, senderPhone);
      if (kb.articles?.length) return kb.articles as KbArticleHit[];
    } catch {
      /* fall through to legacy ingest KB */
    }
  }
  try {
    return (await searchKb(query)).articles || [];
  } catch {
    return [];
  }
}

/** True when this chat's project docs cover the question — the AI answers from them. */
async function docsCover(chatId: string, query: string, senderPhone?: string): Promise<boolean> {
  try {
    const docs = await searchClientDocs(chatId, { q: query, limit: 1, senderPhone });
    return Boolean(docs.pages?.length);
  } catch {
    return false;
  }
}

/**
 * Try to answer with ecosystem intents. Returns reply text if handled.
 */
export async function tryEcosystemReply(input: {
  text: string;
  group: WhatsappGroupDoc;
  lang: ReplyLang;
  senderPhone?: string;
  senderEmail?: string;
}): Promise<{ handled: boolean; reply?: string; intent?: EcosystemIntent }> {
  const detected = detectEcosystemIntent(input.text);
  if (detected.intent === 'none') return { handled: false };
  if (!gateOk(input.group, detected.intent)) {
    return { handled: false, intent: detected.intent };
  }

  const lang = input.lang;
  try {
    switch (detected.intent) {
      case 'kb': {
        const query = detected.query || input.text;
        // Project docs are read by the Support Engineer, which writes a proper answer.
        if (await docsCover(input.group.chatId, query, input.senderPhone)) {
          return { handled: false, intent: 'kb' };
        }
        const articles = await searchKbForChat(query, input.group.chatId, input.senderPhone);
        if (!articles.length) return { handled: false, intent: 'kb' };
        return { handled: true, intent: 'kb', reply: formatKbReply(articles, lang) };
      }
      case 'ticket_status': {
        const data = await listTicketDigest({
          customerOrgId: input.group.customerOrgId,
          whatsappGroupId: input.group.chatId,
          limit: 8,
        });
        const tickets = data.tickets || [];
        if (!tickets.length) {
          return {
            handled: true,
            intent: 'ticket_status',
            reply:
              lang === 'ml'
                ? 'ഇപ്പോൾ തുറന്ന ടിക്കറ്റുകളൊന്നുമില്ല.'
                : 'There are no open tickets right now.',
          };
        }
        const lines = tickets.map(
          (t) =>
            `• ${t.linkedIssueKey || t._id.slice(-6)} — ${t.subject} (${t.status})`
        );
        let docsNote = '';
        try {
          const keyed = tickets.find((t) => t.linkedIssueKey);
          const docs = await searchClientDocs(input.group.chatId, {
            ...(keyed?.linkedIssueKey
              ? { issueKey: keyed.linkedIssueKey }
              : { ticketId: tickets[0]._id }),
            limit: 3,
            senderPhone: input.senderPhone,
          });
          if (docs.pages?.length) {
            docsNote =
              (lang === 'ml' ? '\n\nബന്ധപ്പെട്ട ഡോക്‌സ്:\n' : '\n\nRelated docs:\n') +
              docs.pages
                .map((p) => `• ${p.emoji ? `${p.emoji} ` : ''}${p.title}${p.url ? ` — ${p.url}` : ''}`)
                .join('\n');
          }
        } catch {
          /* optional */
        }
        return {
          handled: true,
          intent: 'ticket_status',
          reply:
            (lang === 'ml' ? 'ടിക്കറ്റ് സ്റ്റാറ്റസ്:\n' : 'Ticket status:\n') +
            lines.join('\n') +
            docsNote,
        };
      }
      case 'issue_status': {
        const projects = normalizeGroupProjects(input.group);
        const projectId = projects[0]?.id;
        if (!projectId || !detected.issueKey) return { handled: false };
        const data = await getIssueByKey(detected.issueKey, projectId);
        const i = data.issue;
        const sprint = i.sprintName
          ? ` Sprint: ${i.sprintName}${i.sprintStatus ? ` (${i.sprintStatus})` : ''}.`
          : '';
        let docsNote = '';
        try {
          const docs = await searchClientDocs(input.group.chatId, {
            issueKey: detected.issueKey,
            limit: 3,
            senderPhone: input.senderPhone,
          });
          if (docs.pages?.length) {
            const lines = docs.pages
              .map((p) => `• ${p.emoji ? `${p.emoji} ` : ''}${p.title}${p.url ? ` — ${p.url}` : ''}`)
              .join('\n');
            docsNote = `\n\nRelated docs:\n${lines}`;
          }
        } catch {
          /* optional */
        }
        return {
          handled: true,
          intent: 'issue_status',
          reply: `${i.key}: ${i.title} — status ${i.status}.${
            i.assignee ? ` Assignee: ${i.assignee}.` : ''
          }${sprint}${docsNote}`,
        };
      }
      case 'portal_request': {
        const projects = normalizeGroupProjects(input.group);
        const projectId = projects[0]?.id;
        if (!projectId || !input.group.customerOrgId) {
          return {
            handled: true,
            intent: 'portal_request',
            reply:
              'This group needs a customer org and an Atrium project assigned before requests can be created.',
          };
        }
        const title = input.text.replace(PORTAL_REQ, '').trim().slice(0, 120) ||
          input.text.slice(0, 120);
        const created = await createPortalRequest({
          customerOrgId: input.group.customerOrgId,
          projectId,
          title: title || 'WhatsApp service request',
          description: input.text,
          type: /feature|enhancement/i.test(input.text)
            ? 'feature'
            : /bug|error|crash/i.test(input.text)
              ? 'bug'
              : 'other',
          whatsappGroupId: input.group.chatId,
          senderPhone: input.senderPhone,
        });
        const id = created.request?._id || '';
        return {
          handled: true,
          intent: 'portal_request',
          reply: `Your service request has been submitted${
            id ? ` (${id})` : ''
          } and is pending TaskFlow approval.`,
        };
      }
      case 'billing': {
        if (!input.group.customerOrgId) return { handled: false };
        const data = await getBillingSummary({
          customerOrgId: input.group.customerOrgId,
        });
        const recent = (data.recent || [])
          .slice(0, 3)
          .map((r) => `${r.number || 'invoice'}: ${r.status} (${r.total})`)
          .join('; ');
        return {
          handled: true,
          intent: 'billing',
          reply: `Outstanding: ${data.outstanding} across ${data.openCount} open invoice(s).${
            recent ? ` Recent: ${recent}.` : ''
          }`,
        };
      }
      case 'hrms': {
        const data = await getHrmsMe({
          phone: input.senderPhone,
          email: input.senderEmail,
        });
        if (!data.linked || !data.employee) {
          return {
            handled: true,
            intent: 'hrms',
            reply:
              'Your WhatsApp number is not linked to an HR employee record. Ask HR to set whatsappPhone/email on your profile.',
          };
        }
        const e = data.employee;
        return {
          handled: true,
          intent: 'hrms',
          reply: `${e.name} (${e.employeeCode}): leave balance ${e.leaveBalanceDays} day(s). Status: ${e.status || 'active'}.`,
        };
      }
      case 'assets': {
        const q = detected.query || input.text;
        const data = await searchAssets(q);
        const assets = data.assets || [];
        if (!assets.length) {
          return {
            handled: true,
            intent: 'assets',
            reply: 'No matching assets found.',
          };
        }
        const lines = assets
          .slice(0, 5)
          .map(
            (a) =>
              `• ${a.assetTag || a.name} — ${a.status}${
                a.assignedUser ? ` (${a.assignedUser})` : ''
              }`
          );
        return {
          handled: true,
          intent: 'assets',
          reply: 'Assets:\n' + lines.join('\n'),
        };
      }
      case 'procurement': {
        const data = await searchPurchaseOrders({
          q: detected.query || input.text,
        });
        const pos = data.purchaseOrders || [];
        if (!pos.length) {
          return {
            handled: true,
            intent: 'procurement',
            reply: 'No matching purchase orders found.',
          };
        }
        const lines = pos
          .slice(0, 5)
          .map((p) => `• ${p.poNumber}: ${p.title} — ${p.status}`);
        return {
          handled: true,
          intent: 'procurement',
          reply: 'Purchase orders:\n' + lines.join('\n'),
        };
      }
      default:
        return { handled: false };
    }
  } catch (err) {
    console.warn('Ecosystem intent failed', detected.intent, err);
    return {
      handled: true,
      intent: detected.intent,
      reply:
        lang === 'ml'
          ? 'ആ വിവരം ഇപ്പോൾ ലഭ്യമല്ല. പിന്നീട് ശ്രമിക്കൂ.'
          : 'That information is unavailable right now. Please try again later.',
    };
  }
}

/** KB assist for support pipeline — returns article text if strong hit. */
export async function lookupKbForSupport(
  text: string,
  enabled: boolean,
  opts: { chatId?: string; senderPhone?: string } = {}
): Promise<{ hit: boolean; reply?: string; title?: string }> {
  if (!enabled) return { hit: false };
  const articles = await searchKbForChat(text, opts.chatId, opts.senderPhone);
  if (!articles.length) return { hit: false };
  const top = articles[0];
  // Require some overlap of significant tokens
  const tokens = text
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 4);
  const hay = `${top.title} ${top.body}`.toLowerCase();
  const hits = tokens.filter((t) => hay.includes(t)).length;
  if (hits < 1 && tokens.length > 2) return { hit: false };
  return {
    hit: true,
    title: top.title,
    reply: formatKbReply(articles, 'en'),
  };
}
