import { resolveMediaUrl } from '../../lib/mediaUrls';

/** Strict allowlist — never interpolate raw URL fragments into iframe src. */
const YOUTUBE_ID_RE = /^[\w-]{6,20}$/;
const VIMEO_ID_RE = /^\d{6,12}$/;

function youtubeId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0] || '';
      return YOUTUBE_ID_RE.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      const id = u.searchParams.get('v') || '';
      if (YOUTUBE_ID_RE.test(id)) return id;
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts[0] === 'embed' || parts[0] === 'shorts') {
        const embedId = parts[1] || '';
        return YOUTUBE_ID_RE.test(embedId) ? embedId : null;
      }
    }
  } catch {
    // fall through
  }
  return null;
}

function vimeoId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^www\./, '');
    if (host !== 'vimeo.com' && host !== 'player.vimeo.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const id = host === 'player.vimeo.com' && parts[0] === 'video' ? parts[1] : parts[0];
    return id && VIMEO_ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function VideoEmbed({ url }: { url: string }) {
  const resolved = resolveMediaUrl(url);
  const yt = youtubeId(url);
  if (yt) {
    return (
      <div className="aspect-video w-full max-w-lg my-2 rounded-lg overflow-hidden border border-[color:var(--border-subtle)]">
        <iframe
          title="YouTube video"
          className="w-full h-full"
          src={`https://www.youtube.com/embed/${yt}`}
          allowFullScreen
        />
      </div>
    );
  }
  const vim = vimeoId(url);
  if (vim) {
    return (
      <div className="aspect-video w-full max-w-lg my-2 rounded-lg overflow-hidden border border-[color:var(--border-subtle)]">
        <iframe
          title="Vimeo video"
          className="w-full h-full"
          src={`https://player.vimeo.com/video/${vim}`}
          allowFullScreen
        />
      </div>
    );
  }
  if (/youtube\.com|youtu\.be|vimeo\.com/i.test(url)) {
    return (
      <a
        href={url}
        className="text-[color:var(--text-primary)] hover:underline"
        target="_blank"
        rel="noreferrer"
      >
        {url}
      </a>
    );
  }
  return (
    <div className="my-2 rounded-lg overflow-hidden border border-[color:var(--border-subtle)]">
      <video controls className="w-full max-w-lg" src={resolved} playsInline preload="metadata">
        Your browser does not support the video tag.
      </video>
    </div>
  );
}
