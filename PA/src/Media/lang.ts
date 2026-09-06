export type ReplyLang = 'ml' | 'en';

/** Malayalam script (Unicode Malayalam block). */
export function hasMalayalam(text: string): boolean {
  return /[\u0D00-\u0D7F]/.test(text);
}

/** Tamil script — Whisper often mislabels Malayalam as Tamil. */
export function hasTamil(text: string): boolean {
  return /[\u0B80-\u0BFF]/.test(text);
}

/** Common Manglish / Malayalam-in-Latin cues. */
const MANGLISH =
  /\b(njan|njn|ningal|ningalude|ente|entha|enthu|enthinu|alle|allo|aano|ano|undo|undu|illa|illallo|venam|venda|veno|parayu|parayoo|paranja|sheri|sheriya|koode|ippo|ippol|pinne|pakshe|namukku|njangal|adheham|cheyyam|cheyyan|cheyyu|kittum|vendi|onnum|aanu|alla|poda|mwone|eda|edi|sahodara|sukham|sugham|namaskaram|namaskaaram|evide|evideya|enthokke|okke|polum|mathi|kurach|kurachu|nalla|nallath|thanne|athu|ithu)\b/i;

export function looksLikeManglish(text: string): boolean {
  return MANGLISH.test(text);
}

export function isTamilWhisperLang(whisperLang?: string | null): boolean {
  const w = whisperLang?.trim().toLowerCase() ?? '';
  return w === 'ta' || w === 'tam' || w === 'tamil' || w.startsWith('tamil');
}

function normalizeWhisperLang(whisperLang?: string | null): ReplyLang | null {
  if (!whisperLang) return null;
  const w = whisperLang.trim().toLowerCase();

  if (
    w === 'ml' ||
    w === 'mal' ||
    w === 'malayalam' ||
    w.startsWith('malayalam') ||
    w.startsWith('ml-')
  ) {
    return 'ml';
  }

  // Malayalam speech is frequently mis-detected as Tamil — treat as Malayalam for this bot
  if (isTamilWhisperLang(w)) return 'ml';

  if (
    w === 'en' ||
    w === 'eng' ||
    w === 'english' ||
    w.startsWith('english') ||
    w.startsWith('en-')
  ) {
    return 'en';
  }
  return null;
}

/**
 * Decide reply language for Ivorix (Kerala-focused: prefer Malayalam over Tamil misfires).
 */
export function detectReplyLang(
  text: string,
  whisperLang?: string | null
): ReplyLang {
  if (hasMalayalam(text)) return 'ml';
  if (hasTamil(text)) return 'ml';

  const fromWhisper = normalizeWhisperLang(whisperLang);
  if (fromWhisper === 'ml') return 'ml';
  if (looksLikeManglish(text)) return 'ml';
  if (fromWhisper === 'en') return 'en';
  return 'en';
}
