import { useRef } from 'react';
import type { Attachment } from '../../lib/api';
import { uploadFile, attachmentsApi } from '../../lib/api';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getDownloadUrl(url: string): string {
  const base = API_BASE.replace(/\/api\/?$/, '') || 'http://localhost:5000';
  return url.startsWith('http') ? url : `${base}${url}`;
}

function isImage(mimeType?: string | null) {
  return typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('image/');
}

function isVideo(mimeType?: string | null) {
  return typeof mimeType === 'string' && mimeType.toLowerCase().startsWith('video/');
}

interface TaskAttachmentsProps {
  issueId: string;
  attachments: Attachment[];
  currentUserId?: string;
  token: string | null;
  onAttachmentsChange: () => void;
}

export default function TaskAttachments({
  issueId,
  attachments,
  currentUserId,
  token,
  onAttachmentsChange,
}: TaskAttachmentsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    e.target.value = '';
    const res = await uploadFile(file, token);
    if (!res.success || !res.data) {
      alert((res as { message?: string }).message ?? 'Upload failed');
      return;
    }
    const addRes = await attachmentsApi.add(
      issueId,
      {
        url: res.data.url,
        originalName: res.data.originalName,
        mimeType: res.data.mimeType,
        size: res.data.size,
      },
      token
    );
    if (addRes.success) onAttachmentsChange();
    else alert((addRes as { message?: string }).message ?? 'Failed to add attachment');
  }

  async function handleRemove(a: Attachment) {
    if (!token) return;
    const res = await attachmentsApi.remove(issueId, a._id, token);
    if (res.success) onAttachmentsChange();
  }

  const canDelete = (a: Attachment) =>
    currentUserId && a.uploadedBy && typeof a.uploadedBy === 'object' && a.uploadedBy._id === currentUserId;

  return (
    <div className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-[color:var(--text-muted)] uppercase tracking-wider">
          Attachments
        </h3>
        {token && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={handleFileSelect}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-[11px] text-[color:var(--accent)] hover:underline font-medium"
            >
              Add attachment
            </button>
          </>
        )}
      </div>
      {attachments.length === 0 ? (
        <p className="text-xs text-[color:var(--text-muted)]">No attachments yet.</p>
      ) : (
        <ul className="space-y-3">
          {attachments.map((a) => (
            <li key={a._id} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/30 overflow-hidden">
              {(isImage(a.mimeType) || isVideo(a.mimeType)) && (
                <div className="bg-black/20">
                  {isImage(a.mimeType) ? (
                    <a href={getDownloadUrl(a.url)} target="_blank" rel="noopener noreferrer" className="block">
                      <img
                        src={getDownloadUrl(a.url)}
                        alt={a.originalName}
                        loading="lazy"
                        className="w-full max-h-64 object-contain"
                      />
                    </a>
                  ) : (
                    <video
                      src={getDownloadUrl(a.url)}
                      className="w-full max-h-80 bg-black"
                      controls
                      playsInline
                      preload="metadata"
                    />
                  )}
                </div>
              )}

              <div className="px-3 py-2.5 flex items-start justify-between gap-3 group">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <a
                      href={getDownloadUrl(a.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 text-xs text-[color:var(--text-primary)] font-medium hover:underline truncate"
                      title={a.originalName}
                    >
                      {a.originalName}
                    </a>
                    <span className="text-[10px] text-[color:var(--text-muted)] shrink-0">
                      {formatSize(a.size)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                    <a
                      href={getDownloadUrl(a.url)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[color:var(--accent)] hover:underline font-medium"
                    >
                      Open
                    </a>
                    <a
                      href={getDownloadUrl(a.url)}
                      download
                      className="text-[color:var(--accent)] hover:underline font-medium"
                    >
                      Download
                    </a>
                  </div>
                </div>

                {canDelete(a) && (
                  <button
                    type="button"
                    onClick={() => handleRemove(a)}
                    className="opacity-0 group-hover:opacity-100 text-[11px] text-red-400 hover:text-red-300 shrink-0"
                    aria-label="Remove attachment"
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
