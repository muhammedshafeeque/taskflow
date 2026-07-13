import fs from 'fs';
import path from 'path';
import {
  type AdoConnection,
  type AdoWorkItem,
  ADO_API_VERSION,
  adoAuthHeader,
} from './adoClient.service';
import * as attachmentsService from '../../attachments/attachments.service';

const MAX_BYTES = 50 * 1024 * 1024;
const uploadRoot = path.join(process.cwd(), 'uploads');

function ensureUploadDir(): void {
  if (!fs.existsSync(uploadRoot)) {
    fs.mkdirSync(uploadRoot, { recursive: true });
  }
}

function extractAttachmentId(url: string): string | null {
  const m = /\/attachments\/([^/?]+)/i.exec(url);
  return m ? m[1] : null;
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.\-()+ ]/g, '_').replace(/\s+/g, '-').slice(0, 180) || 'attachment';
}

function guessMime(name: string, header?: string | null): string {
  if (header && header.includes('/')) return header.split(';')[0].trim();
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.zip': 'application/zip',
    '.mp4': 'video/mp4',
  };
  return map[ext] ?? 'application/octet-stream';
}

export async function syncAdoAttachmentsToIssue(
  issueId: string,
  item: AdoWorkItem,
  conn: AdoConnection,
  uploadedByUserId: string
): Promise<number> {
  const rels = item.relations ?? [];
  const attached = rels.filter((r) => r.rel === 'AttachedFile');
  if (attached.length === 0) return 0;

  ensureUploadDir();
  let imported = 0;

  for (const rel of attached) {
    const adoAttachmentId = extractAttachmentId(rel.url);
    if (!adoAttachmentId) continue;

    const attrs = (rel as { attributes?: Record<string, unknown> }).attributes ?? {};
    const originalName =
      String(attrs.name ?? `attachment-${adoAttachmentId}`).trim() || `attachment-${adoAttachmentId}`;
    const resourceSize = typeof attrs.resourceSize === 'number' ? attrs.resourceSize : undefined;
    if (resourceSize != null && resourceSize > MAX_BYTES) continue;

    try {
      const baseUrl = rel.url.split('?')[0];
      const downloadUrl = `${baseUrl}?api-version=${ADO_API_VERSION}`;

      const res = await fetch(downloadUrl, { headers: adoAuthHeader(conn.pat) });
      if (!res.ok) continue;

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length === 0 || buffer.length > MAX_BYTES) continue;

      const mimeType = guessMime(originalName, res.headers.get('content-type'));
      const ext = path.extname(originalName);
      const base = path.basename(originalName, ext);
      const diskName = `${Date.now()}-ado-${adoAttachmentId.slice(0, 8)}-${safeFilename(base)}${ext}`;
      fs.writeFileSync(path.join(uploadRoot, diskName), buffer);

      const publicPath = `/api/uploads/${encodeURIComponent(diskName)}`;
      const added = await attachmentsService.createFromAdoSync(issueId, uploadedByUserId, {
        url: publicPath,
        originalName,
        mimeType,
        size: buffer.length,
        adoAttachmentId,
      });
      if (added) imported++;
    } catch {
      /* skip failed attachment */
    }
  }

  return imported;
}
