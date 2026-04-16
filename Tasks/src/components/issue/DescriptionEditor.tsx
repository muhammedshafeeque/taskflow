import { useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { useAuth } from '../../contexts/AuthContext';
import { getFilesFromDataTransfer } from '../../lib/clipboardFiles';
import { uploadFile } from '../../lib/api';
import { EditorContent, useEditor } from '@tiptap/react';
import { baseEditorExtensions, editorContentClass } from '../richText/richTextEditorExtensions';
import { VideoBlock, AttachmentBlock } from '../richText/richTextCustomNodes';
import { contentToEditorHtml } from '../../lib/richTextStorage';
import RichTextToolbar from '../richText/RichTextToolbar';

interface DescriptionEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

async function insertUploadedImages(editor: Editor | null, imageFiles: File[], token: string | null | undefined) {
  if (!editor) return;
  for (const file of imageFiles) {
    if (!file.type.startsWith('image/')) continue;
    const res = await uploadFile(file, token ?? undefined);
    if (res.success && res.data) {
      editor.chain().focus().setImage({ src: res.data.url, alt: res.data.originalName }).run();
    }
  }
}

export default function DescriptionEditor({
  value,
  onChange,
  placeholder = 'Add a description…',
}: DescriptionEditorProps) {
  const { token } = useAuth();
  const lastSetValueRef = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [...baseEditorExtensions(placeholder), VideoBlock, AttachmentBlock],
    editorProps: {
      attributes: {
        class: editorContentClass(
          'min-h-[120px] px-3 py-2 bg-[color:var(--bg-page)] text-[color:var(--text-primary)] text-sm leading-[1.7] outline-none rounded-b-md'
        ),
      },
      handleDrop(_view, event) {
        const files = getFilesFromDataTransfer(event.dataTransfer);
        const images = files.filter((f) => f.type.startsWith('image/'));
        if (images.length === 0) return false;
        event.preventDefault();
        void insertUploadedImages(editor, images, token);
        return true;
      },
      handlePaste(_view, event) {
        const files = getFilesFromDataTransfer(event.clipboardData);
        const images = files.filter((f) => f.type.startsWith('image/'));
        if (images.length === 0) return false;
        event.preventDefault();
        void insertUploadedImages(editor, images, token);
        return true;
      },
    },
  });

  useEffect(() => {
    if (!editor || value === undefined) return;
    if (value === lastSetValueRef.current) return;
    const html = contentToEditorHtml(value);
    editor.commands.setContent(html || '', false);
    lastSetValueRef.current = value;
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;
    const handleUpdate = () => {
      const html = editor.getHTML();
      lastSetValueRef.current = html;
      onChange(html);
    };
    editor.on('update', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
    };
  }, [editor, onChange]);

  const handleImageUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      if (!input.files || !input.files[0]) return;
      const res = await uploadFile(input.files[0], token || undefined);
      if (res.success && res.data) {
        editor
          ?.chain()
          .focus()
          .setImage({ src: res.data.url, alt: res.data.originalName })
          .run();
      }
    };
    input.click();
  };

  const handleFileUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,.pdf,.xlsx,.xls,.docx,.doc';
    input.onchange = async () => {
      if (!input.files?.[0]) return;
      const file = input.files[0];
      const res = await uploadFile(file, token || undefined);
      if (res.success && res.data) {
        const { url, originalName, mimeType } = res.data;
        if (file.type.startsWith('video/')) {
          editor?.chain().focus().insertContent({ type: 'videoBlock', attrs: { url, name: originalName } }).run();
        } else {
          editor?.chain().focus().insertContent({ type: 'attachmentBlock', attrs: { url, name: originalName, mimeType } }).run();
        }
      }
    };
    input.click();
  };

  return (
    <div className="rounded-md border border-[color:var(--border-subtle)] overflow-hidden">
      <RichTextToolbar editor={editor} onPickImage={handleImageUpload} onPickFile={handleFileUpload} />
      <EditorContent editor={editor} />
    </div>
  );
}
