import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';
import { resolveMediaUrl } from '../../lib/mediaUrls';
import { isHtmlStored } from '../../lib/richTextStorage';
import { VideoEmbed } from '../issue/VideoEmbed';

const PROSE =
  'prose prose-invert prose-sm max-w-none break-words [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-[color:var(--border-subtle)] [&_table]:border-collapse [&_table]:w-full [&_table]:my-3 [&_table]:text-sm [&_th]:border [&_th]:border-[color:var(--border-subtle)] [&_th]:bg-[color:var(--bg-elevated)] [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-[color:var(--border-subtle)] [&_td]:px-2 [&_td]:py-1.5 [&_tr]:border-b [&_tr]:border-[color:var(--border-subtle)] [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-[color:var(--accent)] [&_blockquote]:border-l-4 [&_blockquote]:border-[color:var(--border-subtle)] [&_blockquote]:pl-4 [&_pre]:bg-[color:var(--bg-elevated)] [&_pre]:rounded-md [&_pre]:p-3';

function splitHtmlByVideoBlocks(html: string): ({ type: 'html'; html: string } | { type: 'video'; url: string })[] {
  const re =
    /<div\b[^>]*\bdata-video-block="true"[^>]*\bdata-url="([^"]+)"[^>]*>\s*<\/div>|<div\b[^>]*\bdata-url="([^"]+)"[^>]*\bdata-video-block="true"[^>]*>\s*<\/div>/gi;
  const parts: ({ type: 'html'; html: string } | { type: 'video'; url: string })[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = m[1] || m[2];
    if (m.index > last) {
      parts.push({ type: 'html', html: html.slice(last, m.index) });
    }
    if (url) parts.push({ type: 'video', url });
    last = m.index + m[0].length;
  }
  if (last < html.length) {
    parts.push({ type: 'html', html: html.slice(last) });
  }
  if (parts.length === 0) {
    parts.push({ type: 'html', html });
  }
  return parts;
}

function sanitizeRichHtml(fragment: string): string {
  return DOMPurify.sanitize(fragment, {
    ADD_TAGS: ['video', 'span'],
    ADD_ATTR: [
      'href',
      'target',
      'rel',
      'class',
      'style',
      'src',
      'alt',
      'width',
      'height',
      'colspan',
      'rowspan',
      'controls',
      'playsinline',
      'preload',
      'data-url',
      'data-name',
      'data-video-block',
      'data-attachment-block',
      'data-type',
      'data-id',
      'data-label',
    ],
    ALLOW_DATA_ATTR: true,
  });
}

function fixImgSrcInHtml(html: string): string {
  return html.replace(/<img\b([^>]*)>/gi, (full, attrs) => {
    const srcMatch = /src="([^"]+)"/i.exec(attrs);
    if (!srcMatch) return full;
    const fixed = resolveMediaUrl(srcMatch[1]);
    return full.replace(srcMatch[0], `src="${fixed}"`);
  });
}

function fixAnchorHref(html: string): string {
  return html.replace(/<a\b([^>]*)>/gi, (full, attrs) => {
    const hrefMatch = /href="([^"]+)"/i.exec(attrs);
    if (!hrefMatch) return full;
    const href = hrefMatch[1];
    if (/^[a-fA-F0-9]{24}$/.test(href)) return full;
    if (href.startsWith('mailto:') || href.startsWith('#')) return full;
    const fixed = resolveMediaUrl(href);
    return full.replace(hrefMatch[0], `href="${fixed}"`);
  });
}

function HtmlSegment({ html }: { html: string }) {
  const clean = fixAnchorHref(fixImgSrcInHtml(sanitizeRichHtml(html)));
  return (
    <div
      className={`${PROSE} [&_p[style*='text-align']]:max-w-none [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg`}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

function MarkdownRichBody({ body }: { body: string }) {
  const parts: { type: 'text' | 'video'; content: string }[] = [];
  const videoRegex = /\[video\]\(([^)\s]+)\)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = videoRegex.exec(body)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ type: 'text', content: body.slice(lastIndex, m.index) });
    }
    parts.push({ type: 'video', content: m[1].trim() });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < body.length) {
    parts.push({ type: 'text', content: body.slice(lastIndex) });
  }
  if (parts.length === 0) {
    parts.push({ type: 'text', content: body });
  }

  return (
    <div className={PROSE}>
      {parts.map((part, i) =>
        part.type === 'video' ? (
          <VideoEmbed key={i} url={part.content} />
        ) : (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            components={{
              img: ({ src, alt }) => (
                <img
                  src={resolveMediaUrl(src || '')}
                  alt={alt || 'image'}
                  className="max-w-full rounded-lg border border-[color:var(--border-subtle)] my-1"
                />
              ),
              a: ({ href, children }) => {
                const rawHref = href || '';
                const isMentionId = /^[a-fA-F0-9]{24}$/.test(rawHref);
                if (isMentionId) {
                  const name =
                    typeof children === 'string'
                      ? children
                      : Array.isArray(children) && children.every((c) => typeof c === 'string')
                        ? children.join('')
                        : 'User';
                  return (
                    <span className="inline-flex items-center rounded-md bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] px-2 py-0.5 text-xs text-[color:var(--text-primary)] font-medium">
                      @{String(name).trim() || 'User'}
                    </span>
                  );
                }
                return (
                  <a
                    href={resolveMediaUrl(rawHref)}
                    className="text-[color:var(--text-primary)] hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {children}
                  </a>
                );
              },
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

function HtmlRichBody({ html }: { html: string }) {
  const segments = splitHtmlByVideoBlocks(html);
  return (
    <div className="space-y-2">
      {segments.map((seg, i) =>
        seg.type === 'video' ? (
          <VideoEmbed key={i} url={seg.url} />
        ) : (
          <HtmlSegment key={i} html={seg.html} />
        )
      )}
    </div>
  );
}

interface RichTextContentProps {
  body: string;
}

/** Renders issue/comment description: legacy markdown or TipTap HTML. */
export default function RichTextContent({ body }: RichTextContentProps) {
  if (!body?.trim()) return null;
  if (isHtmlStored(body)) {
    return <HtmlRichBody html={body} />;
  }
  return <MarkdownRichBody body={body} />;
}
