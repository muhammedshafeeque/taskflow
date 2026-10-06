import { createContext, useContext } from 'react';
import { ml } from './ml';

export type Lang = 'en' | 'ml';

export const LANGUAGES: Array<{ id: Lang; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'ml', label: 'മലയാളം (Malayalam)' },
];

const DICTS: Record<Lang, Record<string, string>> = { en: {}, ml };

/** English text is the key, so untranslated strings simply show in English. */
export function translate(lang: Lang, text: string, vars?: Record<string, string | number>): string {
  const out = DICTS[lang][text] ?? text;
  return vars ? out.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : out;
}

export type I18nCtx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (text: string, vars?: Record<string, string | number>) => string;
};

export const I18nContext = createContext<I18nCtx>({ lang: 'en', setLang: () => undefined, t: (s, v) => translate('en', s, v) });

export function useI18n(): I18nCtx {
  return useContext(I18nContext);
}
