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

/*
 * Malayalam stems. JS `\b` only sees ASCII word chars, so the Malayalam
 * alternatives above never match; Malayalam also inflects by suffix
 * (ആപ്പ് → ആപ്പിന്, ആപ്പുകൾ), so match stems anywhere instead.
 */
const GREETING_ML = /^(ഹലോ|ഹായ്|ഹായ|നമസ്കാരം|നമസ്കാരം സർ|സുഖമാണോ|ഗുഡ് മോണിംഗ്)[\s!.]*$/u;

const GREETING_SOFT_ML = /(ഹലോ|ഹായ്|നമസ്കാരം)/u;

const LEAD_ML =
  /(വെബ്സ|വെബ്‌സ|സൈറ്റ്|ആപ്|ആപ്ലിക്കേഷ|പ്രോജക്ട|പ്രൊജക്ട|പ്രോജക്റ്റ|സോഫ്റ്റ്|ബഡ്ജറ്റ|ബജറ്റ|ക്വോട്ട|ക്വട്ടേഷ|നിരക്ക|ചെലവ|റേറ്റ|ബില്ലിംഗ|ബില്ലിങ|ബിസിനസ|കമ്പനി|ഡെവലപ്|ഉണ്ടാക്ക|ചെയ്തു തര|ഇ-കൊമേഴ്സ|ഓൺലൈൻ ഷോപ്പ)/u;

const REQUIREMENT_ML =
  /(ആവശ്യ|വേണം|വേണ്ടത|ഫീച്ചർ|ഫീച്ചറ|വിശദാംശ|ലോഗി|ഡാഷ്ബോർഡ|പേയ്മെന്റ|പേമെന്റ|ഡിസൈൻ|ഡെഡ്‌ലൈൻ|എത്ര ദിവസ)/u;

const SUPPORT_ML =
  /(സ്റ്റാറ്റസ|അപ്ഡേറ്റ|അപ്‌ഡേറ്റ|പ്രശ്ന|ഹെൽപ്പ|ഹെല്പ|സഹായ|സപ്പോർട്ട|സപ്പോര്ട്ട|എറർ|എര്ര|എറര|ബഗ്|വർക്ക് ചെയ്യുന്നില്ല|പ്രവർത്തിക്കുന്നില്ല|ശരിയാകുന്നില്ല|തകരാ|കിട്ടുന്നില്ല|ഓപ്പൺ ആകുന്നില്ല|തുറക്കുന്നില്ല|തുരകുന്നില്ല)/u;

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

  if (GREETING.test(cleaned) || GREETING_ML.test(cleaned)) {
    return toResult('greeting', 'greeting_exact');
  }

  const hasLead = LEAD.test(cleaned) || LEAD_ML.test(cleaned);
  const hasReq = REQUIREMENT.test(cleaned) || REQUIREMENT_ML.test(cleaned);
  const hasSupport = SUPPORT.test(cleaned) || SUPPORT_ML.test(cleaned);
  const hasGreeting =
    GREETING_SOFT.test(cleaned) || GREETING_SOFT_ML.test(cleaned);

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
