import type { MouseEvent } from 'react';

/** Open in new tab + browser download for uploaded files (same-origin URLs). */
export function AttachmentDownloadLinks({
  href,
  fileName,
  className = '',
  linkClassName = 'text-[11px] font-medium text-[color:var(--accent)] hover:underline',
}: {
  href: string;
  fileName: string;
  className?: string;
  linkClassName?: string;
}) {
  async function handleDownloadClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    try {
      const res = await fetch(href, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = fileName || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      // Do not auto-open file/image on failure; keep behavior download-only.
      alert('Unable to download this file right now. Please try again.');
    }
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <a href={href} target="_blank" rel="noopener noreferrer" className={linkClassName}>
        Open
      </a>
      <a href={href} download={fileName} className={linkClassName} onClick={handleDownloadClick}>
        Download
      </a>
    </span>
  );
}
