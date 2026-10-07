import type { ReplyLang } from './lang';
import { brand, brandName } from '../Config/brand';

/**
 * Malayalam Edge TTS mangles Latin words. Keep only Malayalam script + light punctuation.
 * Returns empty string if the result is not speakable (caller should use a safe fallback).
 */
/** The configured company name, so Malayalam speech pronounces it as written in companyNameMl. */
function companyNameRx(): RegExp {
  const b = brand();
  if (!b.companyNameMl || !b.companyName.trim()) return /(?!)/g;
  return new RegExp(b.companyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
}

export function prepareTtsText(text: string, lang: ReplyLang): string {
  let t = text.trim();
  if (!t) return '';

  t = t.replace(/[—–]/g, ', ');
  t = t.replace(/\//g, ' ');

  if (lang !== 'ml') {
    // Drop prompt-leak patterns
    if (/topic:|platform:|featuresNoted|Per-chat|Message type:/i.test(t)) {
      return '';
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  t = t
    .replace(companyNameRx(), brandName('ml'))
    .replace(/\bHelp\s*Desk\b/gi, 'ഹെൽപ്പ് ഡെസ്ക്')
    .replace(/\bSupport\b/gi, 'സപ്പോർട്ട്')
    .replace(/\bteam\b/gi, 'ടീം')
    .replace(/\bweb\b/gi, 'വെബ്')
    .replace(/\bapps?\b/gi, 'ആപ്പ്')
    .replace(/\bmobile\b/gi, 'മൊബൈൽ')
    .replace(/\bwholesale\b/gi, 'ഹോൾസെയിൽ')
    .replace(/\bvegetable\b/gi, 'പച്ചക്കറി')
    .replace(/\bbilling\b/gi, 'ബില്ലിംഗ്')
    .replace(/\bfeature[s]?\b/gi, 'ഫീച്ചർ')
    .replace(/\bwhatsapp\b/gi, 'വാട്സ്ആപ്പ്');

  // Keep Malayalam letters, digits, and basic punctuation only
  t = t.replace(/[^\u0D00-\u0D7F0-9\s.,?!]/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  // Collapse leftover punctuation-only noise
  t = t.replace(/^[\s.,?:!]+/, '').replace(/[\s.,?:!]+$/, '').trim();

  const letters = (t.match(/[\u0D00-\u0D7F]/g) || []).length;
  if (letters < 10) return '';

  return t;
}
