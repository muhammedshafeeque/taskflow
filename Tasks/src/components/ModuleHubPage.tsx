import { Link } from 'react-router-dom';

export type ModuleShortcut = {
  label: string;
  description: string;
  to: string;
};

type ModuleHubPageProps = {
  title: string;
  subtitle: string;
  shortcuts: ModuleShortcut[];
  notes?: string[];
};

/** Shared landing page for modules that are rolling out feature-by-feature. */
export default function ModuleHubPage({ title, subtitle, shortcuts, notes }: ModuleHubPageProps) {
  return (
    <div className="p-8 animate-fade-in w-full px-4 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold mb-1">{title}</h1>
      <p className="text-[13px] text-[color:var(--text-muted)] mb-6 max-w-2xl">{subtitle}</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-8">
        {shortcuts.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 hover:border-[color:var(--accent)]/40 transition"
          >
            <p className="font-semibold text-[color:var(--text-primary)]">{s.label}</p>
            <p className="mt-1 text-[13px] text-[color:var(--text-muted)] leading-relaxed">{s.description}</p>
            <span className="mt-3 inline-flex text-[12px] font-medium text-[color:var(--accent)]">Open →</span>
          </Link>
        ))}
      </div>

      {notes && notes.length > 0 && (
        <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
          <h2 className="text-sm font-semibold mb-2">Getting started</h2>
          <ul className="space-y-1.5 text-[13px] text-[color:var(--text-muted)]">
            {notes.map((n) => (
              <li key={n}>• {n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
