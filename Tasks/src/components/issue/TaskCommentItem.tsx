import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Comment } from '../../lib/api';

function relativeTime(s: string | undefined) {
  if (!s) return '';
  const d = new Date(s);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `about ${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  return new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function VideoEmbed({ url }: { url: string }) {
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
      <video controls className="w-full max-w-lg" src={url}>
        Your browser does not support the video tag.
      </video>
    </div>
  );
}

function CommentBody({ body }: { body: string }) {
  const parts: { type: 'text' | 'video'; content: string }[] = [];
  const videoRegex = /\[video\]\((https?:\/\/[^)]+)\)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = videoRegex.exec(body)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ type: 'text', content: body.slice(lastIndex, m.index) });
    }
    parts.push({ type: 'video', content: m[1] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < body.length) {
    parts.push({ type: 'text', content: body.slice(lastIndex) });
  }
  if (parts.length === 0) {
    parts.push({ type: 'text', content: body });
  }

  return (
    <div className="prose prose-invert prose-sm max-w-none break-words [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-[color:var(--border-subtle)] [&_table]:border-collapse [&_table]:w-full [&_table]:my-3 [&_table]:text-sm [&_th]:border [&_th]:border-[color:var(--border-subtle)] [&_th]:bg-[color:var(--bg-elevated)] [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-[color:var(--border-subtle)] [&_td]:px-2 [&_td]:py-1.5 [&_tr]:border-b [&_tr]:border-[color:var(--border-subtle)]">
      {parts.map((part, i) =>
        part.type === 'video' ? (
          <VideoEmbed key={i} url={part.content} />
        ) : (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            components={{
              img: ({ src, alt }) => (
                <img src={src} alt={alt || 'image'} className="max-w-full rounded-lg border border-[color:var(--border-subtle)] my-1" />
              ),
              table: ({ children }) => (
                <div className="my-3 overflow-x-auto rounded-lg border border-[color:var(--border-subtle)]">
                  <table className="w-full border-collapse text-sm">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-[color:var(--bg-elevated)]">{children}</thead>,
              tbody: ({ children }) => <tbody>{children}</tbody>,
              tr: ({ children }) => <tr className="border-b border-[color:var(--border-subtle)]">{children}</tr>,
              th: ({ children }) => (
                <th className="border border-[color:var(--border-subtle)] px-2 py-1.5 text-left font-semibold text-[color:var(--text-primary)]">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-[color:var(--border-subtle)] px-2 py-1.5 text-[color:var(--text-primary)]">
                  {children}
                </td>
              ),
            }}
          >
            {part.content}
          </ReactMarkdown>
        )
      )}
    </div>
  );
}

interface TaskCommentItemProps {
  comment: Comment;
}

export default function TaskCommentItem({ comment }: TaskCommentItemProps) {
  const authorName = typeof comment.author === 'object' ? comment.author.name : 'Unknown';

  return (
    <div className="rounded-xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-4">
      <CommentBody body={comment.body} />
      <p className="text-[color:var(--text-muted)] text-[11px] mt-3 flex items-center gap-1">
        <span className="font-medium text-[color:var(--text-primary)]">{authorName}</span>
        <span>·</span>
        <span>{relativeTime(comment.createdAt)}</span>
      </p>
    </div>
  );
}
