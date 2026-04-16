import { MetaIconGlyph, type MetaIconKey } from '../pages/ProjectSettings';

export interface MetaBadgeMeta {
  icon?: string;
  color?: string;
  fontColor?: string;
}

interface MetaBadgeProps {
  label: string;
  meta?: MetaBadgeMeta | null;
  className?: string;
}

/** Renders a badge with optional icon and color from project-configured meta (status, type, priority). */
export function MetaBadge({ label, meta, className = '' }: MetaBadgeProps) {
  const effectiveTextColor = meta?.fontColor || meta?.color;
  return (
    <span
      className={`inline-flex items-center gap-0.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium tracking-wide bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] ${className}`}
      style={
        meta?.color
          ? { backgroundColor: `${meta.color}20`, color: effectiveTextColor, borderColor: `${meta.color}40` }
          : effectiveTextColor
            ? { color: effectiveTextColor }
          : undefined
      }
    >
      {meta?.icon && (
        <span style={effectiveTextColor ? { color: effectiveTextColor } : undefined}>
          <MetaIconGlyph icon={meta.icon as MetaIconKey} className="w-3.5 h-3.5" />
        </span>
      )}
      {label}
    </span>
  );
}
