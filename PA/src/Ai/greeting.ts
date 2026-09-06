import type { ReplyLang } from '../Media/lang';

/** Fixed first-contact greeting — no LLM. */
export function greetingIntro(lang: ReplyLang): string {
  if (lang === 'ml') {
    return 'ഹായ്, ഇത് ഐവോറിക്സ് ഹെൽപ്പ് ഡെസ്ക് ആണ്. ഇന്ന് ഞങ്ങൾക്ക് നിങ്ങളെ എങ്ങനെ സഹായിക്കാം? വെബ്സൈറ്റുകൾ, മൊബൈൽ ആപ്പുകൾ, കസ്റ്റം സോഫ്റ്റ്‌വെയർ തുടങ്ങിയ ഡിജിറ്റൽ സൊല്യൂഷനുകൾ ഞങ്ങൾ നൽകുന്നു.';
  }
  return 'Hi, this is Ivorix Help Desk. How can I help you today? We provide digital solutions like websites, mobile apps, and custom software.';
}
