import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import type { AtriumClient } from '../api/client';
import { listAttachments, listComments, type IssueRef } from '../api/issues';
import { resolveMediaUrl } from '../util/mediaUrl';

export interface LocalAttachment {
  /** Absolute path on disk */
  absPath: string;
  /** Workspace-relative path with forward slashes */
  relPath: string;
  originalName: string;
  mimeType?: string;
  uri: vscode.Uri;
}

interface MediaCandidate {
  url: string;
  originalName: string;
  mimeType?: string;
}

/** Only raster screenshots for Agent context (PNG / JPEG). */
export function isPngOrJpeg(mime?: string, nameOrUrl?: string): boolean {
  const m = (mime || '').toLowerCase();
  if (m === 'image/png' || m === 'image/jpeg' || m === 'image/jpg') return true;
  return /\.(png|jpe?g)(\?|$)/i.test(nameOrUrl || '');
}

function safeFileName(name: string, fallback: string): string {
  const base = (name || fallback).replace(/[/\\?%*:|"<>]/g, '_').trim() || fallback;
  return base.slice(0, 180);
}

function uniqueName(used: Set<string>, name: string): string {
  if (!used.has(name.toLowerCase())) {
    used.add(name.toLowerCase());
    return name;
  }
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let i = 2;
  while (used.has(`${stem}-${i}${ext}`.toLowerCase())) i++;
  const next = `${stem}-${i}${ext}`;
  used.add(next.toLowerCase());
  return next;
}

/** Ensure workspace `.gitignore` includes `.atrium/` (idempotent). */
export async function ensureAtriumGitignored(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const gitignorePath = path.join(folder.uri.fsPath, '.gitignore');
  const entry = '.atrium/';
  try {
    let content = '';
    try {
      content = await fs.readFile(gitignorePath, 'utf8');
    } catch {
      content = '';
    }
    const lines = content.split(/\r?\n/);
    const already = lines.some((l) => {
      const t = l.trim();
      return t === '.atrium/' || t === '.atrium' || t === '/.atrium/' || t === '/.atrium';
    });
    if (already) return;
    const prefix = content.length === 0 || content.endsWith('\n') ? '' : '\n';
    const block =
      content.trim().length === 0
        ? `# Atrium Workbench local issue packets & downloads\n${entry}\n`
        : `${prefix}\n# Atrium Workbench local issue packets & downloads\n${entry}\n`;
    await fs.writeFile(gitignorePath, content + block, 'utf8');
  } catch (e) {
    console.warn('[atrium] could not update .gitignore', e);
  }
}

/** Pull PNG/JPEG upload URLs from TipTap HTML (img + image attachments). */
export function extractMediaFromHtml(html: string): MediaCandidate[] {
  if (!html) return [];
  const out: MediaCandidate[] = [];
  const seen = new Set<string>();

  const push = (url: string, name?: string, mime?: string) => {
    const u = (url || '').trim();
    if (!u || seen.has(u)) return;
    if (!isPngOrJpeg(mime, name || u)) return;
    seen.add(u);
    const fromUrl = u.split('?')[0].split('/').pop() || 'file';
    out.push({
      url: u,
      originalName: name || decodeURIComponent(fromUrl),
      mimeType: mime,
    });
  };

  for (const m of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)) {
    const alt = /alt="([^"]*)"/i.exec(m[0]);
    push(m[1], alt?.[1], 'image/png');
  }
  for (const m of html.matchAll(/<div\b([^>]*\bdata-attachment-block="true"[^>]*)>/gi)) {
    const attrs = m[1] || '';
    const url = /data-url="([^"]*)"/i.exec(attrs)?.[1];
    const name = /data-name="([^"]*)"/i.exec(attrs)?.[1];
    const mime = /data-mime-type="([^"]*)"/i.exec(attrs)?.[1];
    if (url) push(url, name, mime);
  }
  for (const m of html.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    push(m[2], m[1]);
  }

  return out;
}

function atriumDir(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  return path.join(folder.uri.fsPath, '.atrium');
}

/**
 * Collect PNG/JPEG attachments + inline images, download into `.atrium/attachments/`.
 * Ensures `.atrium/` is listed in the workspace `.gitignore`.
 */
export async function collectAndDownloadIssueMedia(
  client: AtriumClient,
  issue: IssueRef
): Promise<LocalAttachment[]> {
  const root = atriumDir();
  if (!root) return [];

  await ensureAtriumGitignored();

  const candidates: MediaCandidate[] = [];
  const seenUrls = new Set<string>();

  const add = (c: MediaCandidate) => {
    if (!c.url || seenUrls.has(c.url)) return;
    if (!isPngOrJpeg(c.mimeType, c.originalName || c.url)) return;
    seenUrls.add(c.url);
    candidates.push(c);
  };

  try {
    const listed = await listAttachments(client, issue._id);
    for (const a of listed || []) {
      add({
        url: a.url,
        originalName: a.originalName || 'attachment',
        mimeType: a.mimeType,
      });
    }
  } catch {
    /* ignore — still try inline media */
  }

  for (const c of extractMediaFromHtml(issue.description || '')) add(c);

  try {
    const comments = await listComments(client, issue._id);
    for (const comment of comments.data || []) {
      for (const c of extractMediaFromHtml(comment.body || '')) add(c);
    }
  } catch {
    /* ignore */
  }

  await fs.mkdir(root, { recursive: true });
  const destDir = path.join(root, 'attachments');
  await fs.mkdir(destDir, { recursive: true });
  try {
    const existing = await fs.readdir(destDir);
    await Promise.all(existing.map((f) => fs.unlink(path.join(destDir, f)).catch(() => undefined)));
  } catch {
    /* ignore */
  }

  if (candidates.length === 0) return [];

  const apiBase = client.getApiBaseUrl();
  const token = await client.getAccessToken();
  const usedNames = new Set<string>();
  const local: LocalAttachment[] = [];
  const folder = vscode.workspace.workspaceFolders![0];

  for (const c of candidates) {
    const fetchUrl = resolveMediaUrl(apiBase, token, c.url);
    try {
      const bytes = await client.fetchBinary(fetchUrl);
      let name = uniqueName(usedNames, safeFileName(c.originalName, 'image.png'));
      // Normalize extension if missing
      if (!/\.(png|jpe?g)$/i.test(name)) {
        const ext = (c.mimeType || '').includes('jpeg') || (c.mimeType || '').includes('jpg') ? '.jpg' : '.png';
        name = uniqueName(usedNames, `${path.basename(name, path.extname(name))}${ext}`);
      }
      const absPath = path.join(destDir, name);
      await fs.writeFile(absPath, bytes);
      const relPath = path.relative(folder.uri.fsPath, absPath).replace(/\\/g, '/');
      local.push({
        absPath,
        relPath,
        originalName: c.originalName,
        mimeType: c.mimeType,
        uri: vscode.Uri.file(absPath),
      });
    } catch (e) {
      console.warn('[atrium] failed to download attachment', c.url, e);
    }
  }

  return local;
}
