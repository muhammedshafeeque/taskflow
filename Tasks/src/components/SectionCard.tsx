import type { ReactNode } from 'react';

interface SectionCardProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

export default function SectionCard({
  title,
  description,
  actions,
  className = '',
  children,
}: SectionCardProps) {
  return (
    <section
      className={`min-w-0 rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-5 ${className}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">
            {title}
          </h2>
          {description && (
            <p className="text-[13px] text-[color:var(--text-muted)] mt-0.5">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

