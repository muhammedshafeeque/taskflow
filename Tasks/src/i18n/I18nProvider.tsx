import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { I18nContext, translate, type Lang } from './context';

const STORAGE_KEY = 'atrium.lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ml') return saved;
  } catch {
    // ignore
  }
  return typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ml') ? 'ml' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // ignore
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  const t = useCallback((text: string, vars?: Record<string, string | number>) => translate(lang, text, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
