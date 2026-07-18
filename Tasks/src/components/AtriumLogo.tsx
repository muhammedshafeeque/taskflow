/** SVG recreation of the Atrium hexagonal hub mark (charcoal + teal accents). */
export function AtriumMarkSvg({ className = '', title = 'Atrium' }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {/* Six interlocking facets forming an open hexagonal atrium */}
      <g fill="#2F3A45" stroke="none">
        <path d="M32 4 L46 12 L40 22 L32 18 L24 22 L18 12 Z" />
        <path d="M46 12 L58 24 L50 32 L40 22 L46 12 Z" />
        <path d="M58 24 L58 40 L46 48 L40 42 L50 32 Z" />
        <path d="M46 48 L32 60 L18 48 L24 42 L32 48 L40 42 Z" />
        <path d="M18 48 L6 40 L6 24 L14 32 L24 42 Z" />
        <path d="M6 24 L18 12 L24 22 L14 32 L6 24 Z" />
      </g>
      {/* Inner teal rim accents */}
      <g fill="none" stroke="#3ECFCF" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.95">
        <path d="M28 20 L32 18 L36 20" />
        <path d="M40 24 L44 28" />
        <path d="M44 36 L40 40" />
        <path d="M36 44 L32 46 L28 44" />
        <path d="M24 40 L20 36" />
        <path d="M20 28 L24 24" />
      </g>
      {/* Open center hex */}
      <path
        d="M32 24 L38 28 L38 36 L32 40 L26 36 L26 28 Z"
        fill="none"
        stroke="#3ECFCF"
        strokeWidth="1.2"
        opacity="0.85"
      />
    </svg>
  );
}

type AtriumLogoVariant = 'mark' | 'icon' | 'lockup' | 'wordmark';

interface AtriumLogoProps {
  variant?: AtriumLogoVariant;
  className?: string;
  /** Height for image lockups; mark defaults to square via className. */
  height?: number;
  /** Prefer SVG mark for crisp UI chrome (default true for variant=mark). */
  useSvg?: boolean;
  title?: string;
}

/**
 * Brand logo variants matching the Atrium identity sheet:
 * - mark: hexagonal symbol (sidebar collapsed, favicon companion)
 * - icon: app tile with AT badge (PWA / about)
 * - lockup: mark + wordmark image (light surfaces)
 * - wordmark: text-only image
 */
export default function AtriumLogo({
  variant = 'mark',
  className = '',
  height,
  useSvg,
  title = 'Atrium',
}: AtriumLogoProps) {
  const preferSvg = useSvg ?? variant === 'mark';

  if (variant === 'mark' && preferSvg) {
    return <AtriumMarkSvg className={className || 'h-8 w-8'} title={title} />;
  }

  const src =
    variant === 'icon'
      ? '/brand/atrium-app-icon.png'
      : variant === 'lockup'
        ? '/brand/atrium-lockup.png'
        : variant === 'wordmark'
          ? '/brand/atrium-wordmark.png'
          : '/brand/atrium-mark.png';

  const style = height ? { height, width: 'auto' as const } : undefined;

  return (
    <img
      src={src}
      alt={title}
      className={className}
      style={style}
      draggable={false}
    />
  );
}
