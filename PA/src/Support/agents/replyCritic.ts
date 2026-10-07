import { getGroq } from '../../Config/groq';
import {
  fastChatModel,
  reasoningParams,
  strongChatModel,
  type AgentCallLog,
  pushAgentCall,
} from '../../Ai/models';
import { extractJsonObject } from '../types';
import { brandName } from '../../Config/brand';

const TICKET_CLAIM =
  /\b([A-Z][A-Z0-9]+-\d+|ticket\s*#?\s*\w+|issue\s*#?\s*\w+)\b/i;

export type ReplyCriticResult = {
  reply: string;
  ok: boolean;
  issues: string[];
  skipped: boolean;
  agentCalls: AgentCallLog[];
};

function extractClaimedKeys(reply: string): string[] {
  const keys: string[] = [];
  const re = /\b([A-Z]{2,}[A-Z0-9]*-\d+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply))) {
    keys.push(m[1]);
  }
  return keys;
}

function localChecks(
  reply: string,
  knownKeys: string[]
): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const trimmed = reply.trim();
  if (!trimmed) {
    issues.push('empty_reply');
    return { ok: false, issues };
  }
  if (trimmed.length > 600) issues.push('too_long');
  const claimed = extractClaimedKeys(trimmed);
  const knownUpper = new Set(knownKeys.map((k) => k.toUpperCase()));
  for (const c of claimed) {
    if (!knownUpper.has(c.toUpperCase()) && !knownKeys.includes(c)) {
      issues.push(`unknown_ticket:${c}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * Fast reply critic — runs before send when escalated, low confidence,
 * or the draft claims a ticket/status. One strong rewrite max if needed.
 */
export async function runReplyCritic(input: {
  reply: string;
  message: string;
  knownTicketKeys: string[];
  escalated: boolean;
  analysisConfidence: number;
  langHint?: 'ml' | 'en';
  agentCalls?: AgentCallLog[];
}): Promise<ReplyCriticResult> {
  const agentCalls = input.agentCalls || [];
  const claimsTicket = TICKET_CLAIM.test(input.reply);
  const shouldRun =
    Boolean(input.reply.trim()) &&
    (input.escalated ||
      input.analysisConfidence < 0.7 ||
      claimsTicket);

  if (!shouldRun) {
    pushAgentCall(agentCalls, {
      agent: 'REPLY_CRITIC',
      tier: 'none',
      skipped: true,
      reason: 'high_conf_no_ticket_claim',
    });
    return {
      reply: input.reply,
      ok: true,
      issues: [],
      skipped: true,
      agentCalls,
    };
  }

  const local = localChecks(input.reply, input.knownTicketKeys);
  if (local.ok && !input.escalated && input.analysisConfidence >= 0.55) {
    // Local pass is enough for non-escalated medium-conf replies
    pushAgentCall(agentCalls, {
      agent: 'REPLY_CRITIC',
      tier: 'none',
      skipped: true,
      reason: 'local_ok',
    });
    return {
      reply: input.reply.trim().slice(0, 500),
      ok: true,
      issues: [],
      skipped: true,
      agentCalls,
    };
  }

  let issues = [...local.issues];
  let reply = input.reply.trim().slice(0, 500);

  try {
    const model = fastChatModel();
    const groq = getGroq();
    const completion = await groq.chat.completions.create({
      model,
      ...reasoningParams(model),
      temperature: 0.1,
      max_tokens: 280,
      messages: [
        {
          role: 'system',
          content: `You are a reply critic for ${brandName()} WhatsApp support.
Reply ONLY JSON: {"ok":true,"issues":[],"revisedReply":""}
Rules:
- ok=false if reply invents ticket IDs not in knownTicketKeys, invents fixes/ETAs, is empty, or is off-policy (slang/emoji/internal jargon).
- If ok=false, set revisedReply to a safe 1-2 sentence customer reply (no invented tickets).
- If ok=true, leave revisedReply empty.
- Language: ${input.langHint === 'ml' ? 'Malayalam' : 'English'}.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            customerMessage: input.message,
            draftReply: input.reply,
            knownTicketKeys: input.knownTicketKeys,
            localIssues: local.issues,
            escalated: input.escalated,
          }),
        },
      ],
    });
    pushAgentCall(agentCalls, {
      agent: 'REPLY_CRITIC',
      tier: 'fast',
      model,
    });
    const parsed = extractJsonObject(
      completion.choices[0]?.message?.content || ''
    ) as {
      ok?: boolean;
      issues?: string[];
      revisedReply?: string;
    } | null;
    if (parsed) {
      if (Array.isArray(parsed.issues)) {
        issues = [...new Set([...issues, ...parsed.issues.map(String)])];
      }
      if (parsed.ok === false || issues.some((i) => i.startsWith('unknown_ticket'))) {
        if (parsed.revisedReply?.trim()) {
          reply = parsed.revisedReply.trim().slice(0, 500);
        } else if (input.escalated) {
          // Strong rewrite once
          reply = await strongRewrite({
            message: input.message,
            issues,
            knownKeys: input.knownTicketKeys,
            langHint: input.langHint,
            agentCalls,
          });
        } else {
          // Strip unknown ticket refs
          reply = stripUnknownTickets(reply, input.knownTicketKeys);
        }
        return { reply, ok: false, issues, skipped: false, agentCalls };
      }
    }
  } catch (err) {
    console.warn('Reply critic LLM failed', err);
    pushAgentCall(agentCalls, {
      agent: 'REPLY_CRITIC',
      tier: 'fast',
      skipped: true,
      reason: 'llm_failed',
    });
    if (local.issues.some((i) => i.startsWith('unknown_ticket'))) {
      reply = stripUnknownTickets(reply, input.knownTicketKeys);
      return { reply, ok: false, issues: local.issues, skipped: false, agentCalls };
    }
  }

  return { reply, ok: local.ok, issues, skipped: false, agentCalls };
}

function stripUnknownTickets(reply: string, knownKeys: string[]): string {
  const knownUpper = new Set(knownKeys.map((k) => k.toUpperCase()));
  return reply
    .replace(/\b([A-Z]{2,}[A-Z0-9]*-\d+)\b/g, (m) =>
      knownUpper.has(m.toUpperCase()) ? m : 'our support ticket'
    )
    .trim()
    .slice(0, 500);
}

async function strongRewrite(input: {
  message: string;
  issues: string[];
  knownKeys: string[];
  langHint?: 'ml' | 'en';
  agentCalls: AgentCallLog[];
}): Promise<string> {
  try {
    const model = strongChatModel();
    const groq = getGroq();
    const completion = await groq.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 200,
      messages: [
        {
          role: 'system',
          content: `Write a safe professional WhatsApp support reply (max 2 sentences). No invented ticket IDs. Plain text only. Language: ${
            input.langHint === 'ml' ? 'Malayalam' : 'English'
          }.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            customerMessage: input.message,
            criticIssues: input.issues,
            allowedTicketKeys: input.knownKeys,
          }),
        },
      ],
    });
    pushAgentCall(input.agentCalls, {
      agent: 'REPLY_CRITIC_REWRITE',
      tier: 'strong',
      model,
    });
    const text = (completion.choices[0]?.message?.content || '')
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      .trim();
    if (text.length >= 8) return text.slice(0, 500);
  } catch (err) {
    console.warn('Reply critic strong rewrite failed', err);
  }
  return input.langHint === 'ml'
    ? 'നന്ദി. ഞങ്ങൾ നോക്കുകയാണ് — കൂടുതൽ വിവരം ഉണ്ടെങ്കിൽ പങ്കിടൂ.'
    : 'Thanks — we are looking into this. Please share any extra detail if you have it.';
}

/** Test helper: local ticket hallucination check. */
export function criticLocalChecksForTests(
  reply: string,
  knownKeys: string[]
): { ok: boolean; issues: string[] } {
  return localChecks(reply, knownKeys);
}
