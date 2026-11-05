import type { Editor } from '@tiptap/core';
import type { UploadedFile } from '../../lib/api';

/**
 * Chooses the block from what was stored, never from the button used: "All files" in the
 * file dialog gets anything past `accept`, and a video in an <img> can't play.
 */
export function insertUploadedFile(editor: Editor | null, { url, originalName, mimeType }: UploadedFile) {
  const chain = editor?.chain().focus();
  if (mimeType.startsWith('image/')) chain?.setImage({ src: url, alt: originalName }).run();
  else if (mimeType.startsWith('video/')) chain?.insertContent({ type: 'videoBlock', attrs: { url, name: originalName } }).run();
  else chain?.insertContent({ type: 'attachmentBlock', attrs: { url, name: originalName, mimeType } }).run();
}
