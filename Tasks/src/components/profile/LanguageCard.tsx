import { LANGUAGES, useI18n, type Lang } from '../../i18n/context';

export default function LanguageCard() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 space-y-3">
      <h2 className="text-base font-medium text-[color:var(--text-primary)]">{t('Language')}</h2>
      <p className="text-sm text-[color:var(--text-muted)]">{t('Interface language for menus and common screens. More screens are being translated.')}</p>
      <div className="flex flex-wrap gap-2">
        {LANGUAGES.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setLang(l.id as Lang)}
            className={`px-3 py-1.5 rounded-lg border text-sm ${
              lang === l.id
                ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/10 text-[color:var(--accent)]'
                : 'border-[color:var(--border-subtle)] text-[color:var(--text-primary)]'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  );
}
