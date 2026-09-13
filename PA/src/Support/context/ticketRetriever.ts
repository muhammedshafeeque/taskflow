import type {
  TaskflowProjectContext,
  TaskflowTicketSummary,
} from './taskflowContext';

const STOP = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'to',
  'of',
  'in',
  'on',
  'for',
  'and',
  'or',
  'with',
  'this',
  'that',
  'it',
  'we',
  'you',
  'our',
  'please',
  'hi',
  'hello',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u0d00-\u0d7f\s-]/gi, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

function scoreTicket(
  ticket: TaskflowTicketSummary,
  tokens: string[]
): number {
  if (!tokens.length) return 0;
  const hay = `${ticket.subject || ''} ${ticket.description || ''} ${
    ticket.key || ''
  } ${ticket.issueKey || ''}`.toLowerCase();
  let score = 0;
  for (const tok of tokens) {
    if (hay.includes(tok)) score += tok.length >= 5 ? 2 : 1;
  }
  return score;
}

/**
 * Rank open Taskflow tickets by keyword overlap with the customer message.
 * Pure (no LLM) — used before SE/QA prompts.
 */
export function rankTicketsByRelevance(
  tickets: TaskflowTicketSummary[],
  query: string,
  entities: string[] = [],
  limit = 8
): TaskflowTicketSummary[] {
  const tokens = [
    ...tokenize(query),
    ...entities.flatMap((e) => tokenize(e)),
  ];
  const unique = [...new Set(tokens)];
  const scored = tickets.map((t) => ({
    t,
    score: scoreTicket(t, unique),
  }));
  scored.sort((a, b) => b.score - a.score);
  const ranked = scored.filter((s) => s.score > 0).map((s) => s.t);
  if (ranked.length >= limit) return ranked.slice(0, limit);
  // Fill with remaining (preserve original order among unscored)
  const seen = new Set(ranked.map((t) => t.id));
  for (const t of tickets) {
    if (ranked.length >= limit) break;
    if (!seen.has(t.id)) {
      ranked.push(t);
      seen.add(t.id);
    }
  }
  return ranked.slice(0, limit);
}

/**
 * Return a Taskflow context copy with tickets reordered by relevance.
 */
export function withRankedTickets(
  ctx: TaskflowProjectContext,
  query: string,
  entities: string[] = [],
  limit = 8
): TaskflowProjectContext {
  return {
    ...ctx,
    tickets: rankTicketsByRelevance(ctx.tickets || [], query, entities, limit),
  };
}

export function knownTicketKeys(
  tickets: TaskflowTicketSummary[]
): string[] {
  const keys: string[] = [];
  for (const t of tickets) {
    for (const k of [t.key, t.issueKey, t.id]) {
      if (k && !keys.includes(k)) keys.push(k);
    }
  }
  return keys;
}
