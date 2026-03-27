import { resolveMediaUrl } from '../../lib/mediaUrls';

export function VideoEmbed({ url }: { url: string }) {
  const resolved = resolveMediaUrl(url);
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&?/]+)/);
    const vid = match ? match[1] : url.split('/').pop() || '';
    return (
      <div className="aspect-video w-full max-w-lg my-2 rounded-lg overflow-hidden border border-[color:var(--border-subtle)]">
        <iframe
          title="YouTube video"
          className="w-full h-full"
          src={`https://www.youtube.com/embed/${vid}`}
          allowFullScreen
        />
      </div>
    );
  }
  if (url.includes('vimeo.com')) {
    const match = url.match(/vimeo\.com\/(\d+)/);
    const vid = match ? match[1] : '';
    return vid ? (
      <div className="aspect-video w-full max-w-lg my-2 rounded-lg overflow-hidden border border-[color:var(--border-subtle)]">
        <iframe
          title="Vimeo video"
          className="w-full h-full"
          src={`https://player.vimeo.com/video/${vid}`}
          allowFullScreen
        />
      </div>
    ) : (
      <a href={url} className="text-[color:var(--text-primary)] hover:underline" target="_blank" rel="noreferrer">
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
