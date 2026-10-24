import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import { useAuth } from '../../contexts/AuthContext';
import { getFilesFromDataTransfer } from '../../lib/clipboardFiles';
import { uploadFile } from '../../lib/api';
import { baseEditorExtensions, editorContentClass } from '../richText/richTextEditorExtensions';
import { VideoBlock, AttachmentBlock } from '../richText/richTextCustomNodes';
import { contentToEditorHtml } from '../../lib/richTextStorage';
import RichTextToolbar from '../richText/RichTextToolbar';
import { DOC_PROSE } from './docsUi';

async function insertImages(editor: Editor | null, files: File[], token: string | null | undefined) {
  if (!editor) return;
  for (const file of files) {
    const res = await uploadFile(file, token ?? undefined);
    if (res.success && res.data) editor.chain().focus().setImage({ src: res.data.url, alt: res.data.originalName }).run();
  }
}

function pick(accept: string, onFile: (f: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => input.files?.[0] && onFile(input.files[0]);
  input.click();
}

/**
 * Full-page writing surface for docs: no box around the text, and the formatting toolbar
 * sticks under the edit bar while you scroll. `stickyTop` is the edit bar's height.
 */
export default function DocEditor({ value, onChange, placeholder, stickyTop = 0 }: { value: string; onChange: (html: string) => void; placeholder?: string; stickyTop?: number }) {
  const { token } = useAuth();
  const lastSet = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [...baseEditorExtensions(placeholder ?? 'Start writing…'), VideoBlock, AttachmentBlock],
    editorProps: {
      attributes: {
        class: editorContentClass(`min-h-[60vh] py-6 text-[16px] leading-[1.8] outline-none ${DOC_PROSE}`),
      },
      handleDrop(_view, event) {
        const images = getFilesFromDataTransfer(event.dataTransfer).filter((f) => f.type.startsWith('image/'));
        if (!images.length) return false;
        event.preventDefault();
        void insertImages(editor, images, token);
        return true;
      },
      handlePaste(_view, event) {
        const images = getFilesFromDataTransfer(event.clipboardData).filter((f) => f.type.startsWith('image/'));
        if (!images.length) return false;
        event.preventDefault();
        void insertImages(editor, images, token);
        return true;
      },
    },
  });

  useEffect(() => {
    if (!editor || value === lastSet.current) return;
    editor.commands.setContent(contentToEditorHtml(value) || '', false);
    lastSet.current = value;
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const html = editor.getHTML();
      lastSet.current = html;
      onChange(html);
    };
    editor.on('update', update);
    return () => {
      editor.off('update', update);
    };
  }, [editor, onChange]);

  const onPickImage = () => pick('image/*', (f) => void insertImages(editor, [f], token));
  const onPickFile = () =>
    pick('video/*,.pdf,.xlsx,.xls,.docx,.doc,.pptx,.csv,.zip', async (file) => {
      const res = await uploadFile(file, token ?? undefined);
      if (!res.success || !res.data) return;
      const { url, originalName, mimeType } = res.data;
      editor
        ?.chain()
        .focus()
        .insertContent(file.type.startsWith('video/') ? { type: 'videoBlock', attrs: { url, name: originalName } } : { type: 'attachmentBlock', attrs: { url, name: originalName, mimeType } })
        .run();
    });

  return (
    <div>
      <div
        className="sticky z-10 -mx-2 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)]/95 shadow-sm backdrop-blur [&>div]:border-0 [&>div]:bg-transparent [&>div]:justify-center"
        style={{ top: stickyTop + 8 }}
      >
        <RichTextToolbar editor={editor} onPickImage={onPickImage} onPickFile={onPickFile} />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
