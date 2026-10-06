/**
 * Cheap, deterministic check for "this customer needs a person now".
 * Runs before the LLM so an upset customer never gets another bot reply.
 * Covers English, Manglish and Malayalam phrasing seen in support chats.
 */

export type HandoverReason = 'asked_for_human' | 'frustrated';

const ASK_HUMAN: RegExp[] = [
  /\b(talk|speak|chat|connect)\s+(to|with)\s+(a\s+)?(human|person|someone|agent|staff|manager|owner|real person)\b/i,
  /\b(real person|live agent|human agent|call me|call back|callback)\b/i,
  /\bare you (a )?(bot|robot|ai)\b/i,
  /\b(stop|no more)\s+(bot|auto ?reply)\b/i,
  // Manglish
  /\b(aalu|aale|aarelum|aarenkilum)\s*(venam|vilikk|samsarikk)/i,
  /\bmanager(ine|e)?\s*(venam|vilikk)/i,
  /\bvilikk(u|amo|aamo|anam)\b/i,
  // Malayalam script: "ആളെ വേണം", "വിളിക്കൂ", "മാനേജർ"
  /ആള(െ|ുമായി)|വിളിക്ക|മാനേജർ|മനുഷ്യ/,
];

const FRUSTRATED: RegExp[] = [
  /\b(useless|worst|pathetic|ridiculous|nonsense|rubbish|scam|fraud|cheat(ed|ing)?)\b/i,
  /\b(not (working|helpful)|doesn'?t (help|understand)|you (don'?t|do not) understand)\b/i,
  /\b(refund|complain(t)?|legal action|consumer court)\b/i,
  /\b(waste of (time|money))\b/i,
  // Manglish
  /\b(chathi|thattippu|pattichu|veruthe)\b/i,
  // Malayalam script: "ചതി", "തട്ടിപ്പ്", "പറ്റിച്ചു"
  /ചതി|തട്ടിപ്പ്|പറ്റിച്ചു/,
];

export function detectHandover(text: string): HandoverReason | null {
  const t = text.trim();
  if (!t) return null;
  if (ASK_HUMAN.some((rx) => rx.test(t))) return 'asked_for_human';
  const shouting = t === t.toUpperCase() && (t.match(/[A-Z]/g) ?? []).length >= 10;
  const bangs = (t.match(/[!?]{3,}/g) ?? []).length > 0;
  if (FRUSTRATED.some((rx) => rx.test(t)) || (shouting && bangs)) return 'frustrated';
  return null;
}

export function handoverReply(lang: 'ml' | 'en'): string {
  return lang === 'ml'
    ? 'ശരി, ഞങ്ങളുടെ ടീമിലെ ഒരാൾ ഉടൻ നിങ്ങളെ ബന്ധപ്പെടും. 🙏'
    : "Understood — I've passed this to our team and a person will reply here shortly. 🙏";
}
