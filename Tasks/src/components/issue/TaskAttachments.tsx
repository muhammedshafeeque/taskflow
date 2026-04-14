import { useRef, forwardRef, useImperativeHandle, useCallback } from 'react';
import type { Attachment } from '../../lib/api';
import { getFilesFromDataTransfer } from '../../lib/clipboardFiles';
import { uploadFile, attachmentsApi } from '../../lib/api';
import { AttachmentDownloadLinks } from '../attachment/AttachmentDownloadLinks';

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
  noWrapper?: boolean;
}

export type TaskAttachmentsHandle = {
  openFilePicker: () => void;
};

const TaskAttachments = forwardRef<TaskAttachmentsHandle, TaskAttachmentsProps>(function TaskAttachments(
  {
  issueId,
  attachments,
  currentUserId,
  token,
  onAttachmentsChange,
  noWrapper = false,
},
  ref
) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      openFilePicker: () => {
        if (!token) return;
        fileInputRef.current?.click();
      },
    }),
    [token]
  );

  const uploadOneFile = useCallback(
    async (file: File) => {
      if (!token) return;
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
    },
    [issueId, token, onAttachmentsChange]
  );

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !token) return;
    e.target.value = '';
    await uploadOneFile(file);
  }

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!token) return;
      const files = getFilesFromDataTransfer(e.clipboardData);
      if (files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      for (const f of files) void uploadOneFile(f);
    },
    [token, uploadOneFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!token) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, [token]);

  const handleDropFiles = useCallback(
    (e: React.DragEvent) => {
      if (!token) return;
      const files = getFilesFromDataTransfer(e.dataTransfer);
      if (files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      for (const f of files) void uploadOneFile(f);
    },
    [token, uploadOneFile]
  );

  async function handleRemove(a: Attachment) {
    if (!token) return;
    const res = await attachmentsApi.remove(issueId, a._id, token);
    if (res.success) onAttachmentsChange();
  }

  const canDelete = (a: Attachment) =>
    currentUserId && a.uploadedBy && typeof a.uploadedBy === 'object' && a.uploadedBy._id === currentUserId;

  const imageAttachments = attachments.filter((a) => isImage(a.mimeType));
  const videoAttachments = attachments.filter((a) => isVideo(a.mimeType));
  const otherAttachments = attachments.filter((a) => !isImage(a.mimeType) && !isVideo(a.mimeType));

  const fileInput =
    token ? (
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} />
    ) : null;

  const content = (
    <>
      {attachments.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)] italic py-6 text-center px-4">No attachments yet.</p>
      ) : (
        <>
          {imageAttachments.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 px-4 py-4">
              {imageAttachments.map((a) => {
                const href = getDownloadUrl(a.url);
                return (
                  <div
                    key={a._id}
                    className="flex flex-col rounded-lg overflow-hidden border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] group"
                  >
                    <div className="relative">
                      <a href={href} target="_blank" rel="noopener noreferrer" className="block">
                        <img
                          src={href}
                          alt={a.originalName}
                          loading="lazy"
                          className="w-full h-40 object-cover"
                        />
                      </a>
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition pointer-events-none">
                        <p className="text-[11px] text-white truncate">{a.originalName}</p>
                      </div>
                      {canDelete(a) && (
                        <button
                          type="button"
                          onClick={() => handleRemove(a)}
                          className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 bg-black/60 text-[10px] text-red-300 hover:text-red-200 px-1.5 py-0.5 rounded transition"
                          aria-label="Remove attachment"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]/70 px-2 py-1.5">
                      <span className="text-[10px] text-[color:var(--text-muted)] truncate min-w-0 flex-1" title={a.originalName}>
                        {a.originalName}
                      </span>
                      <AttachmentDownloadLinks
                        href={href}
                        fileName={a.originalName}
                        linkClassName="text-[10px] font-medium text-[color:var(--accent)] hover:underline"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {videoAttachments.map((a) => (
            <div key={a._id} className="px-4 py-3 border-t border-[color:var(--border-subtle)] first:border-t-0">
              <video
                src={getDownloadUrl(a.url)}
                className="w-full max-h-72 rounded-lg bg-black"
                controls
                playsInline
                preload="metadata"
              />
              <div className="flex flex-wrap items-center justify-between gap-2 mt-1.5">
                <span className="text-xs text-[color:var(--text-muted)] truncate min-w-0">{a.originalName}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <AttachmentDownloadLinks
                    href={getDownloadUrl(a.url)}
                    fileName={a.originalName}
                    linkClassName="text-[11px] font-medium text-[color:var(--accent)] hover:underline"
                  />
                  {canDelete(a) && (
                    <button
                      type="button"
                      onClick={() => handleRemove(a)}
                      className="text-[11px] text-red-400 hover:text-red-300"
                      aria-label="Remove attachment"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {otherAttachments.map((a) => (
            <div key={a._id} className="flex items-center gap-3 px-4 py-2.5 border-t border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)] group transition-colors">
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
                <div className="mt-0.5">
                  <AttachmentDownloadLinks href={getDownloadUrl(a.url)} fileName={a.originalName} />
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
          ))}
        </>
      )}
    </>
  );

  if (noWrapper) {
    return (
      <>
        {fileInput}
        {content}
      </>
    );
  }

  return (
    <div
      className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] card-shadow overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/35"
      tabIndex={token ? 0 : undefined}
      onPaste={handlePaste}
      onDragOver={handleDragOver}
      onDrop={handleDropFiles}
      role={token ? 'region' : undefined}
      aria-label={token ? 'Attachments — paste or drop files here when focused' : undefined}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--text-muted)]">
          Attachments{' '}
          <span className="ml-1 bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] px-1.5 py-0.5 rounded-full text-[10px] font-semibold">
            {attachments.length}
          </span>
        </span>
        {token && (
          <>
            {fileInput}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-xs font-medium px-2.5 py-1 rounded-md text-[color:var(--accent)] hover:bg-[color:var(--accent)]/10 transition-colors"
            >
              Add attachment
            </button>
          </>
        )}
      </div>
      {content}
    </div>
  );
});

export default TaskAttachments;
