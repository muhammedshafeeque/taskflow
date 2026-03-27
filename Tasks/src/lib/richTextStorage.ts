import { marked } from 'marked';

/** Heuristic: HTML saved by TipTap vs legacy markdown. */
export function isHtmlStored(s: string): boolean {
  const t = s.trim();
  if (!t.startsWith('<')) return false;
  return /^(<p[\s/>]|<h[1-6][\s/>]|<div[\s/>]|<ul[\s/>]|<ol[\s/>]|<blockquote[\s/>]|<table[\s/>]|<pre[\s/>]|<hr[\s/>])/i.test(
    t
  );
}

/** Load stored content into TipTap (HTML from DB or legacy markdown). */
export function contentToEditorHtml(raw: string): string {
  if (!raw?.trim()) return '';
  if (isHtmlStored(raw)) return raw;
  return marked.parse(raw, { async: false }) as string;
}

/** Whether editor HTML is effectively empty. */
export function isEditorHtmlEmpty(html: string): boolean {
  const t = html.trim();
  if (!t) return true;
  // Rich content without plain text should still be submittable.
  if (
    /<(img|video|iframe|table|hr)\b/i.test(t) ||
    /data-video-block|data-attachment-block/i.test(t)
  ) {
    return false;
  }
  const text = t.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  if (!text) return true;
  return /^(<p>\s*(<br\s*\/?>)?\s*<\/p>)+$/i.test(t);
}
