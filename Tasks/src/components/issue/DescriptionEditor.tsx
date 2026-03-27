import { useEffect, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { uploadFile } from '../../lib/api';
import { EditorContent, useEditor } from '@tiptap/react';
import { baseEditorExtensions, editorContentClass } from '../richText/richTextEditorExtensions';
import { contentToEditorHtml } from '../../lib/richTextStorage';
import RichTextToolbar from '../richText/RichTextToolbar';

interface DescriptionEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function DescriptionEditor({
  value,
  onChange,
  placeholder = 'Add a description…',
}: DescriptionEditorProps) {
  const { token } = useAuth();
  const lastSetValueRef = useRef<string | null>(null);

  const editor = useEditor({
    extensions: baseEditorExtensions(placeholder),
    editorProps: {
      attributes: {
        class: editorContentClass(
          'min-h-[120px] px-3 py-2 bg-[color:var(--bg-page)] text-[color:var(--text-primary)] text-xs leading-relaxed outline-none rounded-b-md'
        ),
      },
      handleDrop(_view, event) {
        const dt = event.dataTransfer;
        const files = dt?.files;
        if (!files || files.length === 0) return false;
        event.preventDefault();
        const file = Array.from(files)[0];
        if (!file?.type.startsWith('image/')) return false;
        (async () => {
          const res = await uploadFile(file, token || undefined);
          if (res.success && res.data) {
            editor
              ?.chain()
              .focus()
              .setImage({ src: res.data.url, alt: res.data.originalName })
              .run();
          }
        })();
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

  return (
    <div className="rounded-md border border-[color:var(--border-subtle)] overflow-hidden">
      <RichTextToolbar editor={editor} onPickImage={handleImageUpload} />
      <EditorContent editor={editor} />
    </div>
  );
}
