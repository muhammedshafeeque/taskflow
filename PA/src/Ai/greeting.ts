import type { ReplyLang } from '../Media/lang';
import { brand, brandName, fillBrand } from '../Config/brand';

/** Fixed first-contact greeting — no LLM. */
export function greetingIntro(lang: ReplyLang): string {
  const b = brand();
  if (lang === 'ml') {
    if (b.greetingMl) return fillBrand(b.greetingMl, 'ml');
    return `ഹായ്, ഇത് ${brandName('ml')} ഹെൽപ്പ് ഡെസ്ക് ആണ്. ഇന്ന് ഞങ്ങൾക്ക് നിങ്ങളെ എങ്ങനെ സഹായിക്കാം?`;
  }
  if (b.greetingEn) return fillBrand(b.greetingEn, 'en');
  return `Hi, this is ${brandName('en')} Help Desk. How can I help you today?${b.servicesSummary ? ` We provide ${b.servicesSummary}.` : ''}`;
}
