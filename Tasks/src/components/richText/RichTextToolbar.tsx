import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import {
  LuAlignCenter,
  LuAlignJustify,
  LuAlignLeft,
  LuAlignRight,
  LuBold,
  LuCode,
  LuHeading1,
  LuHeading2,
  LuHeading3,
  LuItalic,
  LuLink,
  LuList,
  LuListOrdered,
  LuPaperclip,
  LuQuote,
  LuRedo2,
  LuStrikethrough,
  LuTable,
  LuUnderline,
  LuUndo2,
} from 'react-icons/lu';

const TB =
  'w-8 h-8 rounded border border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] hover:border-[color:var(--border-subtle)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 text-[10px] font-medium shrink-0 flex items-center justify-center transition-colors';
const TB_ACTIVE =
  'bg-[color:var(--accent)]/20 text-[color:var(--accent)] border-[color:var(--accent)]/40 shadow-[inset_0_0_0_1px_var(--accent)]';
const SEP = 'w-px h-4 bg-[color:var(--border-subtle)]/70 mx-0.5';

interface RichTextToolbarProps {
  editor: Editor | null;
  onPickImage?: () => void;
  onPickFile?: () => void;
  extraRight?: ReactNode;
}

export default function RichTextToolbar({ editor, onPickImage, onPickFile, extraRight }: RichTextToolbarProps) {
  if (!editor) return null;
  const colorInputRef = useRef<HTMLInputElement>(null);
  const activeColor = (editor.getAttributes('textStyle').color as string | undefined) ?? '';
  const buttonColor = useMemo(() => {
    const v = (activeColor || '').trim();
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v : '#4f46e5';
  }, [activeColor]);

  return (
    <div className="flex flex-wrap items-center gap-0.5 px-2 py-1 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
      <span className="text-[9px] uppercase tracking-wide text-[color:var(--text-muted)] mr-1">Heading</span>
      {([1, 2, 3] as const).map((level) => (
        <button
          key={level}
          type="button"
          title={`Heading ${level}`}
          onClick={() => editor.chain().focus().toggleHeading({ level }).run()}
          className={`${TB} ${editor.isActive('heading', { level }) ? TB_ACTIVE : ''}`}
        >
          {level === 1 ? <LuHeading1 className="w-4 h-4" /> : level === 2 ? <LuHeading2 className="w-4 h-4" /> : <LuHeading3 className="w-4 h-4" />}
        </button>
      ))}
      <button type="button" title="Paragraph" onClick={() => editor.chain().focus().setParagraph().run()} className={TB}>
        ¶
      </button>
      <div className={SEP} />
      <button
        type="button"
        title="Bold"
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={`${TB} ${editor.isActive('bold') ? TB_ACTIVE : ''}`}
      >
        <LuBold className="w-4 h-4" />
      </button>
      <button
        type="button"
        title="Italic"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={`${TB} ${editor.isActive('italic') ? TB_ACTIVE : ''}`}
      >
        <LuItalic className="w-4 h-4" />
      </button>
      <button
        type="button"
        title="Underline"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={`${TB} ${editor.isActive('underline') ? TB_ACTIVE : ''}`}
      >
        <LuUnderline className="w-4 h-4" />
      </button>
      <button
        type="button"
        title="Strikethrough"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={`${TB} ${editor.isActive('strike') ? TB_ACTIVE : ''}`}
      >
        <LuStrikethrough className="w-4 h-4" />
      </button>
      <button
        type="button"
        title="Inline code"
        onClick={() => editor.chain().focus().toggleCode().run()}
        className={`${TB} ${editor.isActive('code') ? TB_ACTIVE : ''}`}
      >
        <LuCode className="w-4 h-4" />
      </button>
      <input
        ref={colorInputRef}
        type="color"
        value={buttonColor}
        onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
        className="sr-only"
        aria-label="Pick text color"
      />
      <button
        type="button"
        title="Text color"
        onClick={() => colorInputRef.current?.click()}
        className={`${TB} ${activeColor ? TB_ACTIVE : ''}`}
      >
        <span className="w-4 h-4 rounded border border-[color:var(--border-subtle)]" style={{ backgroundColor: buttonColor }} />
      </button>
      <button
        type="button"
        title="Clear text color"
        onClick={() => editor.chain().focus().unsetColor().run()}
        className={TB}
      >
        A
      </button>
      <div className={SEP} />
      {(['left', 'center', 'right', 'justify'] as const).map((align) => (
        <button
          key={align}
          type="button"
          title={`Align ${align}`}
          onClick={() => editor.chain().focus().setTextAlign(align).run()}
          className={`${TB} ${editor.isActive({ textAlign: align }) ? TB_ACTIVE : ''}`}
        >
          {align === 'left' ? (
            <LuAlignLeft className="w-4 h-4" />
          ) : align === 'center' ? (
            <LuAlignCenter className="w-4 h-4" />
          ) : align === 'right' ? (
            <LuAlignRight className="w-4 h-4" />
          ) : (
            <LuAlignJustify className="w-4 h-4" />
          )}
        </button>
      ))}
      <div className={SEP} />
      <button
        type="button"
        title="Bullet list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`${TB} ${editor.isActive('bulletList') ? TB_ACTIVE : ''}`}
      >
        <LuList className="w-4 h-4" />
      </button>
      <button
        type="button"
        title="Numbered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`${TB} ${editor.isActive('orderedList') ? TB_ACTIVE : ''}`}
      >
        <LuListOrdered className="w-4 h-4" />
      </button>
      <button
        type="button"
        title="Quote"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`${TB} ${editor.isActive('blockquote') ? TB_ACTIVE : ''}`}
      >
        <LuQuote className="w-4 h-4" />
      </button>
      <button
        type="button"
        title="Code block"
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={`${TB} ${editor.isActive('codeBlock') ? TB_ACTIVE : ''}`}
      >
        <LuCode className="w-4 h-4" />
      </button>
      <button type="button" title="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()} className={TB}>
        —
      </button>
      <div className={SEP} />
      <button
        type="button"
        title="Link"
        onClick={() => {
          const prev = editor.getAttributes('link').href as string | undefined;
          const url = window.prompt('Link URL', prev || 'https://');
          if (url === null) return;
          if (url === '') editor.chain().focus().extendMarkRange('link').unsetLink().run();
          else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        }}
        className={`${TB} ${editor.isActive('link') ? TB_ACTIVE : ''}`}
      >
        <LuLink className="w-4 h-4" />
      </button>
      <button
        type="button"
        title="Insert table"
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        className={TB}
      >
        <LuTable className="w-4 h-4" />
      </button>
      {onPickImage && (
        <button type="button" title="Insert image" onClick={onPickImage} className={TB}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
      )}
      {onPickFile && (
        <button type="button" title="Attach file" onClick={onPickFile} className={TB}>
          <LuPaperclip className="w-3.5 h-3.5" />
        </button>
      )}
      <button type="button" title="Undo" onClick={() => editor.chain().focus().undo().run()} className={TB}>
        <LuUndo2 className="w-4 h-4" />
      </button>
      <button type="button" title="Redo" onClick={() => editor.chain().focus().redo().run()} className={TB}>
        <LuRedo2 className="w-4 h-4" />
      </button>
      {extraRight && (
        <>
          <div className={SEP} />
          {extraRight}
        </>
      )}
    </div>
  );
}
