export type MessageType =
  | 'greeting'
  | 'project_lead'
  | 'requirement'
  | 'support'
  | 'random';

export type AnalyzeResult = {
  type: MessageType;
  shouldReply: boolean;
  reason: string;
};

export type AnalyzeContext = {
  /** Previous business intent for this chat (from DB). */
  lastType?: MessageType | null;
  /** True if we already exchanged messages in this chat. */
  hasHistory?: boolean;
};

const REPLY_TYPES = new Set<MessageType>([
  'greeting',
  'project_lead',
  'requirement',
  'support',
]);

const ACTIVE: MessageType[] = [
  'greeting',
  'project_lead',
  'requirement',
  'support',
];

const GREETING =
  /^(hi|hello|hey|hii+|helo|good\s*(morning|afternoon|evening)|namaste|assalamu\s*alaikum|slm|hai|ഹലോ|നമസ്കാരം|സുഖമാണോ)\b[\s!.]*$/i;

const GREETING_SOFT =
  /\b(hi|hello|hey|good\s*(morning|afternoon|evening)|namaste|നമസ്കാരം|ഹലോ)\b/i;

const LEAD =
  /\b(project|website|web\s*site|app|application|software|develop|development|build|quote|quotation|budget|cost|price|proposal|hire|agency|company|business|startup|ecommerce|e-commerce|landing\s*page|crm|erp|billing|invoice|pos|വെബ്സൈറ്റ്|ആപ്പ്|പ്രോജക്ട്|സോഫ്റ്റ്?വെയര്?|ബഡ്ജറ്റ്|ക്വോട്ട്|നിരക്ക്|ബില്ലിംഗ്)\b/i;

const REQUIREMENT =
  /\b(need|want|require|requirement|feature|features|spec|specs|scope|timeline|deadline|module|payment|login|dashboard|api|database|design|ui|ux|wireframe|mockup|ആവശ്യം|വേണം|ഫീച്ചര്?|സമയം|വിശദാംശം)\b/i;

const SUPPORT =
  /\b(status|update|progress|bug|issue|error|problem|help|support|follow\s*up|pending|delay|fix|not\s*working|broken|സ്റ്റാറ്റസ്|അപ്ഡേറ്റ്|പ്രശ്നം|ഹെല്പ്|സപ്പോര്?ട്ട്)\b/i;

/** Obvious off-topic — still ignore even mid-conversation. */
const SPAM =
  /\b(lottery|crypto\s*giveaway|forex\s*signal|porn|xxx|joke|meme|cricket\s*score)\b/i;

function toResult(type: MessageType, reason: string): AnalyzeResult {
  return {
    type,
    shouldReply: REPLY_TYPES.has(type),
    reason,
  };
}

/**
 * Rule-based classifier (no LLM). Uses chat history so follow-ups after a
 * greeting/lead are not dropped as "random".
 */
export function analyzeMessage(
  text: string,
  ctx: AnalyzeContext = {}
): AnalyzeResult {
  const cleaned = text.trim();
  if (!cleaned) {
    return toResult('random', 'empty');
  }

  if (SPAM.test(cleaned)) {
    return toResult('random', 'spam');
  }

  if (GREETING.test(cleaned)) {
    return toResult('greeting', 'greeting_exact');
  }

  const hasLead = LEAD.test(cleaned);
  const hasReq = REQUIREMENT.test(cleaned);
  const hasSupport = SUPPORT.test(cleaned);
  const hasGreeting = GREETING_SOFT.test(cleaned);

  if (hasLead && hasReq) {
    return toResult('requirement', 'lead_and_requirement');
  }
  if (hasReq && (hasLead || cleaned.length > 25)) {
    return toResult('requirement', 'requirement_keywords');
  }
  if (hasLead) {
    return toResult('project_lead', 'lead_keywords');
  }
  if (hasSupport) {
    return toResult('support', 'support_keywords');
  }
  if (hasGreeting && cleaned.length < 40) {
    return toResult('greeting', 'greeting_soft');
  }

  // Active conversation: keep helping without keyword match (no AI for classify)
  const last = ctx.lastType;
  if (last && ACTIVE.includes(last)) {
    if (last === 'greeting' || last === 'project_lead' || last === 'requirement') {
      return toResult('requirement', 'history_follow_up');
    }
    return toResult('support', 'history_follow_up');
  }

  if (ctx.hasHistory && cleaned.length >= 8) {
    return toResult('support', 'history_continue');
  }

  return toResult('random', 'no_business_keywords');
}
