import AtriumLogo from '../components/AtriumLogo';
import { useAppDisplayName, useAppLogoUrl } from '../hooks/useAppDisplayName';

/** Company logo when set; otherwise product mark. */
export function BrandMark({
  className = 'h-7 w-7',
  imgClassName,
}: {
  className?: string;
  imgClassName?: string;
}) {
  const logoUrl = useAppLogoUrl();
  const name = useAppDisplayName();
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={name}
        className={imgClassName ?? `${className} object-contain`}
      />
    );
  }
  return <AtriumLogo variant="mark" className={className} useSvg={false} />;
}
