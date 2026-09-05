import {
  isImageMime,
  isPdfMime,
  isVideoMime,
  resolveMediaUrl,
} from '../util/mediaUrl';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isHtmlStored(s: string): boolean {
  const t = s.trim();
  if (!t.startsWith('<')) return false;
  if (/^(<img[\s/>]|<video[\s/>]|<iframe[\s/>]|<table[\s/>]|<hr[\s/>]|<figure[\s/>])/i.test(t)) return true;
  if (/data-video-block|data-attachment-block/i.test(t)) return true;
  return /^(<p[\s/>]|<h[1-6][\s/>]|<div[\s/>]|<ul[\s/>]|<ol[\s/>]|<blockquote[\s/>]|<table[\s/>]|<pre[\s/>]|<hr[\s/>])/i.test(
    t
  );
}

type Resolve = (url: string) => string;

function videoHtml(url: string, resolve: Resolve): string {
  const src = escapeHtml(resolve(url));
  return `<div class="media-block"><video controls playsinline preload="metadata" src="${src}"></video><div class="media-actions"><a href="${src}" target="_blank" rel="noopener">Open video</a></div></div>`;
}

function pdfHtml(url: string, name: string, resolve: Resolve): string {
  const src = escapeHtml(resolve(url));
  const label = escapeHtml(name || 'Document.pdf');
  return `<div class="media-block pdf-block"><div class="media-label">${label}</div><iframe class="pdf-frame" src="${src}" title="${label}"></iframe><div class="media-actions"><a href="${src}" target="_blank" rel="noopener">Open PDF</a></div></div>`;
}

function attachmentChip(url: string, name: string, mime: string, resolve: Resolve): string {
  const href = escapeHtml(resolve(url));
  const label = escapeHtml(name || 'Attachment');
  if (isImageMime(mime, name || url)) {
    return `<div class="media-block"><a href="${href}" target="_blank" rel="noopener"><img src="${href}" alt="${label}" /></a><div class="media-actions"><a href="${href}" target="_blank" rel="noopener">${label}</a></div></div>`;
  }
  if (isVideoMime(mime, name || url)) {
    return videoHtml(url, resolve);
  }
  if (isPdfMime(mime, name || url)) {
    return pdfHtml(url, name, resolve);
  }
  return `<div class="file-chip"><a href="${href}" target="_blank" rel="noopener">${label}</a></div>`;
}

function splitHtmlByVideoBlocks(html: string): Array<{ type: 'html'; html: string } | { type: 'video'; url: string }> {
  const re =
    /<div\b[^>]*\bdata-video-block="true"[^>]*\bdata-url="([^"]+)"[^>]*>\s*<\/div>|<div\b[^>]*\bdata-url="([^"]+)"[^>]*\bdata-video-block="true"[^>]*>\s*<\/div>/gi;
  const parts: Array<{ type: 'html'; html: string } | { type: 'video'; url: string }> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const url = m[1] || m[2];
    if (m.index > last) parts.push({ type: 'html', html: html.slice(last, m.index) });
    if (url) parts.push({ type: 'video', url });
    last = m.index + m[0].length;
  }
  if (last < html.length) parts.push({ type: 'html', html: html.slice(last) });
  if (parts.length === 0) parts.push({ type: 'html', html });
  return parts;
}

function splitHtmlByAttachmentBlocks(
  html: string
): Array<
  | { type: 'html'; html: string }
  | { type: 'attachment'; url: string; name: string; mimeType: string }
> {
  const re = /<div\b([^>]*\bdata-attachment-block="true"[^>]*)>([^<]*)<\/div>/gi;
  const parts: Array<
    | { type: 'html'; html: string }
    | { type: 'attachment'; url: string; name: string; mimeType: string }
  > = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const attrStr = m[1] || '';
    const innerText = (m[2] || '').trim();
    const urlMatch = /data-url="([^"]*)"/i.exec(attrStr);
    const nameMatch = /data-name="([^"]*)"/i.exec(attrStr);
    const mimeMatch = /data-mime-type="([^"]*)"/i.exec(attrStr);
    const rawUrl = urlMatch ? urlMatch[1] : '';
    const name = nameMatch ? nameMatch[1] : innerText || 'Attachment';
    const mimeType = mimeMatch ? mimeMatch[1] : '';
    if (m.index > last) parts.push({ type: 'html', html: html.slice(last, m.index) });
    if (rawUrl) parts.push({ type: 'attachment', url: rawUrl, name, mimeType });
    else parts.push({ type: 'html', html: m[0] });
    last = m.index + m[0].length;
  }
  if (last < html.length) parts.push({ type: 'html', html: html.slice(last) });
  if (parts.length === 0) parts.push({ type: 'html', html });
  return parts;
}

function sanitizeRichHtml(fragment: string): string {
  let html = fragment
    .replace(/<(script|style|iframe|object|embed|form|link|meta|base)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|form|link|meta|base)\b[^>]*\/?>/gi, '');
  html = html.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, ' $1="#"');
  return html;
}

function fixImgAndAnchors(html: string, resolve: Resolve): string {
  let out = html.replace(/<img\b([^>]*)>/gi, (full, attrs: string) => {
    const srcMatch = /src="([^"]+)"/i.exec(attrs);
    if (!srcMatch) return full;
    const fixed = escapeHtml(resolve(srcMatch[1]));
    const altMatch = /alt="([^"]*)"/i.exec(attrs);
    const alt = escapeHtml(altMatch?.[1] || 'image');
    return `<figure class="media-block"><a href="${fixed}" target="_blank" rel="noopener"><img src="${fixed}" alt="${alt}" /></a></figure>`;
  });
  out = out.replace(/<a\b([^>]*)>/gi, (full, attrs: string) => {
    const hrefMatch = /href="([^"]+)"/i.exec(attrs);
    if (!hrefMatch) return full;
    const href = hrefMatch[1];
    if (/^[a-fA-F0-9]{24}$/.test(href)) {
      return full.replace(/href="[^"]*"/i, 'href="#"').replace('<a ', '<a class="mention" ');
    }
    if (href.startsWith('mailto:') || href.startsWith('#')) return full;
    const fixed = escapeHtml(resolve(href));
    return full.replace(hrefMatch[0], `href="${fixed}" target="_blank" rel="noopener"`);
  });
  return out;
}

function renderHtmlSegment(html: string, resolve: Resolve): string {
  return fixImgAndAnchors(sanitizeRichHtml(html), resolve);
}

function renderHtmlBody(html: string, resolve: Resolve): string {
  const afterVideo = splitHtmlByVideoBlocks(html);
  const segments: Array<
    | { type: 'html'; html: string }
    | { type: 'video'; url: string }
    | { type: 'attachment'; url: string; name: string; mimeType: string }
  > = [];
  for (const seg of afterVideo) {
    if (seg.type === 'html') segments.push(...splitHtmlByAttachmentBlocks(seg.html));
    else segments.push(seg);
  }

  return segments
    .map((seg) => {
      if (seg.type === 'video') return videoHtml(seg.url, resolve);
      if (seg.type === 'attachment') return attachmentChip(seg.url, seg.name, seg.mimeType, resolve);
      if (!seg.html.trim()) return '';
      return `<div class="prose">${renderHtmlSegment(seg.html, resolve)}</div>`;
    })
    .join('');
}

function renderMarkdownLite(body: string, resolve: Resolve): string {
  let text = body;
  const parts: string[] = [];
  const videoRe = /\[video\]\(([^)\s]+)\)/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = videoRe.exec(text)) !== null) {
    if (m.index > last) parts.push(mdChunk(text.slice(last, m.index), resolve));
    parts.push(videoHtml(m[1].trim(), resolve));
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(mdChunk(text.slice(last), resolve));
  return parts.join('') || mdChunk(body, resolve);
}

function mdChunk(chunk: string, resolve: Resolve): string {
  let html = escapeHtml(chunk);
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_full, alt, url) => {
    const src = escapeHtml(resolve(String(url).trim()));
    const a = escapeHtml(String(alt || 'image'));
    return `<figure class="media-block"><a href="${src}" target="_blank" rel="noopener"><img src="${src}" alt="${a}" /></a></figure>`;
  });
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_full, label, url) => {
    const href = String(url).trim();
    if (/^[a-fA-F0-9]{24}$/.test(href)) {
      return `<span class="mention">${escapeHtml(String(label).replace(/^@+/, ''))}</span>`;
    }
    return `<a href="${escapeHtml(resolve(href))}" target="_blank" rel="noopener">${escapeHtml(String(label))}</a>`;
  });
  html = html.replace(/\n/g, '<br/>');
  return `<div class="prose">${html}</div>`;
}

/** Render TipTap HTML or legacy markdown for the issue webview. */
export function renderRichContent(
  body: string,
  apiBaseUrl: string,
  accessToken: string | undefined
): string {
  if (!body?.trim()) return '<em class="muted">No content</em>';
  const resolve: Resolve = (url) => resolveMediaUrl(apiBaseUrl, accessToken, url);
  if (isHtmlStored(body)) return renderHtmlBody(body, resolve);
  return renderMarkdownLite(body, resolve);
}

export interface AttachmentRef {
  _id?: string;
  url: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
}

export function renderAttachmentsList(
  attachments: AttachmentRef[],
  apiBaseUrl: string,
  accessToken: string | undefined,
  opts?: { skipHeading?: boolean }
): string {
  if (!attachments.length) return '';
  const resolve: Resolve = (url) => resolveMediaUrl(apiBaseUrl, accessToken, url);
  const items = attachments
    .map((a) =>
      attachmentChip(a.url, a.originalName || 'Attachment', a.mimeType || '', resolve)
    )
    .join('');
  if (opts?.skipHeading) return `<div class="attachments">${items}</div>`;
  return `<h2>Attachments</h2><div class="attachments">${items}</div>`;
}
