import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { uploadFile } from '../../lib/api';
import { BubbleMenu, EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { Node, mergeAttributes } from '@tiptap/core';

interface TaskCommentBoxProps {
  onSubmit: (body: string) => void;
  submitting: boolean;
  placeholder?: string;
}

const FORMAT_BUTTONS = [
  { label: 'B', action: 'bold', title: 'Bold' },
  { label: 'I', action: 'italic', title: 'Italic' },
  { label: 'S', action: 'strike', title: 'Strikethrough' },
  { label: '</>', action: 'code', title: 'Code' },
  { label: '•', action: 'bulletList', title: 'Bullet list' },
  { label: '1.', action: 'orderedList', title: 'Numbered list' },
  { label: '""', action: 'blockquote', title: 'Quote' },
  { label: '—', action: 'divider', title: 'Divider' },
];

const VideoBlock = Node.create({
  name: 'videoBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: {
        default: '',
      },
      name: {
        default: '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-video-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-video-block': 'true' }), 0];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className =
        'my-2 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] text-[11px] text-[color:var(--text-primary)]';
      const icon = document.createElement('span');
      icon.className = 'inline-flex w-3.5 h-3.5 items-center justify-center';
      icon.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>';
      const label = document.createElement('span');
      label.textContent = node.attrs.name || 'Video';
      dom.append(icon, label);
      return { dom };
    };
  },
});

const AttachmentBlock = Node.create({
  name: 'attachmentBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      url: {
        default: '',
      },
      name: {
        default: '',
      },
      mimeType: {
        default: '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-attachment-block]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-attachment-block': 'true' }), 0];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.className =
        'my-2 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] text-[11px] text-[color:var(--text-primary)]';
      const icon = document.createElement('span');
      icon.className = 'inline-flex w-3.5 h-3.5 items-center justify-center';
      icon.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 3.5L21 8l-9.5 9.5a3 3 0 01-4.243 0l-2.757-2.757a3 3 0 010-4.243L11 3l4.5 4.5" /></svg>';
      const label = document.createElement('span');
      label.textContent = node.attrs.name || 'Attachment';
      dom.append(icon, label);
      return { dom };
    };
  },
});

type JSONNode = {
  type?: string;
  text?: string;
  marks?: { type: string }[];
  content?: JSONNode[];
  attrs?: Record<string, unknown>;
};

function serializeNode(node: JSONNode): string {
  switch (node.type) {
    case 'doc':
      return (node.content || []).map(serializeNode).filter(Boolean).join('\n\n');
    case 'paragraph': {
      const text = (node.content || []).map(serializeNode).join('');
      return text;
    }
    case 'text': {
      let text = node.text || '';
      const marks = node.marks || [];
      for (const mark of marks) {
        if (mark.type === 'bold') {
          text = `**${text}**`;
        } else if (mark.type === 'italic') {
          text = `*${text}*`;
        } else if (mark.type === 'strike') {
          text = `~~${text}~~`;
        } else if (mark.type === 'code') {
          text = `\`${text}\``;
        }
      }
      return text;
    }
    case 'bulletList':
      return (node.content || [])
        .map((item) => {
          const inner = serializeNode(item).replace(/\n/g, '\n  ');
          return `- ${inner}`;
        })
        .join('\n');
    case 'orderedList': {
      let index = 1;
      return (node.content || [])
        .map((item) => {
          const inner = serializeNode(item).replace(/\n/g, '\n   ');
          const line = `${index}. ${inner}`;
          index += 1;
          return line;
        })
        .join('\n');
    }
    case 'listItem':
      return (node.content || []).map(serializeNode).join('\n');
    case 'blockquote':
      return (node.content || [])
        .map(serializeNode)
        .join('\n')
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'horizontalRule':
      return '---';
    case 'image': {
      const attrs = node.attrs || {};
      const alt = (attrs.alt as string) || '';
      const src = (attrs.src as string) || '';
      if (!src) return '';
      return `![${alt}](${src})`;
    }
    case 'videoBlock': {
      const attrs = node.attrs || {};
      const url = (attrs.url as string) || '';
      if (!url) return '';
      return `[video](${url})`;
    }
    case 'attachmentBlock': {
      const attrs = node.attrs || {};
      const url = (attrs.url as string) || '';
      const name = (attrs.name as string) || 'attachment';
      if (!url) return '';
      return `[${name}](${url})`;
    }
    case 'table': {
      const rows = node.content || [];
      const lines: string[] = [];
      let isFirstRow = true;
      for (const row of rows) {
        if (row.type !== 'tableRow') continue;
        const cells = (row.content || []).map((c) => {
          const cellText = (c.content || [])
            .map(serializeNode)
            .join('')
            .trim()
            .replace(/\|/g, '\\|')
            .replace(/\n/g, ' ');
          return cellText;
        });
        if (cells.length === 0) continue;
        lines.push('| ' + cells.map((cell) => (cell === '' ? ' ' : cell)).join(' | ') + ' |');
        if (isFirstRow) {
          lines.push('| ' + cells.map(() => '---').join(' | ') + ' |');
          isFirstRow = false;
        }
      }
      return lines.length > 0 ? lines.join('\n') : '';
    }
    case 'tableRow':
    case 'tableHeader':
    case 'tableCell':
      return (node.content || []).map(serializeNode).join('');
    default:
      return (node.content || []).map(serializeNode).join('\n');
  }
}

function getMarkdownFromEditor(editor: Editor | null): string {
  if (!editor) return '';
  const json = editor.getJSON() as JSONNode;
  return serializeNode(json).trim();
}

export default function TaskCommentBox({
  onSubmit,
  submitting,
  placeholder = 'Add a comment…',
}: TaskCommentBoxProps) {
  const { token } = useAuth();
  const [uploading, setUploading] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      Image.configure({
        inline: false,
      }),
      Placeholder.configure({
        placeholder,
      }),
      Table.configure({
        resizable: false,
        HTMLAttributes: {
          class: 'border-collapse w-full my-2 text-sm [&_th]:border [&_th]:border-[color:var(--border-subtle)] [&_th]:bg-[color:var(--bg-elevated)] [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_td]:border [&_td]:border-[color:var(--border-subtle)] [&_td]:px-2 [&_td]:py-1.5',
        },
      }),
      TableRow,
      TableHeader,
      TableCell,
      VideoBlock,
      AttachmentBlock,
    ],
    editorProps: {
      attributes: {
        class:
          'min-h-[96px] px-4 py-3 bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] text-sm leading-relaxed outline-none',
      },
      handleDrop(_view, event) {
        const dt = event.dataTransfer;
        const files = dt?.files;
        if (!files || files.length === 0) return false;
        event.preventDefault();
        const fileArray = Array.from(files);
        (async () => {
          for (const file of fileArray) {
            try {
              setUploading(true);
              const res = await uploadFile(file, token || undefined);
              if (!res.success || !res.data) {
                // eslint-disable-next-line no-alert
                alert((res as { message?: string }).message ?? 'Upload failed');
                continue;
              }
              const { url, originalName, mimeType } = res.data;
              if (file.type.startsWith('image/')) {
                editor
                  ?.chain()
                  .focus()
                  .setImage({ src: url, alt: originalName })
                  .run();
              } else if (file.type.startsWith('video/')) {
                editor
                  ?.chain()
                  .focus()
                  .insertContent({
                    type: 'videoBlock',
                    attrs: { url, name: originalName },
                  })
                  .run();
              } else {
                editor
                  ?.chain()
                  .focus()
                  .insertContent({
                    type: 'attachmentBlock',
                    attrs: { url, name: originalName, mimeType },
                  })
                  .run();
              }
            } finally {
              setUploading(false);
            }
          }
        })();
        return true;
      },
    },
  });

  const handleInsertTable = () => {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  const handleImageUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];
      setUploading(true);
      const res = await uploadFile(file, token || undefined);
      setUploading(false);
      if (res.success && res.data) {
        editor
          ?.chain()
          .focus()
          .setImage({ src: res.data.url, alt: res.data.originalName })
          .run();
      } else {
        alert((res as { message?: string }).message ?? 'Image upload failed');
      }
    };
    input.click();
  };

  const handleVideoUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.onchange = async () => {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];
      setUploading(true);
      const res = await uploadFile(file, token || undefined);
      setUploading(false);
      if (res.success && res.data) {
        editor
          ?.chain()
          .focus()
          .insertContent({
            type: 'videoBlock',
            attrs: { url: res.data.url, name: res.data.originalName },
          })
          .run();
      } else {
        alert((res as { message?: string }).message ?? 'Video upload failed');
      }
    };
    input.click();
  };

  const handleFileLink = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      if (!input.files || !input.files[0]) return;
      const file = input.files[0];
      setUploading(true);
      const res = await uploadFile(file, token || undefined);
      setUploading(false);
      if (res.success && res.data) {
        editor
          ?.chain()
          .focus()
          .insertContent({
            type: 'attachmentBlock',
            attrs: {
              url: res.data.url,
              name: res.data.originalName,
              mimeType: res.data.mimeType,
            },
          })
          .run();
      } else {
        alert((res as { message?: string }).message ?? 'File upload failed');
      }
    };
    input.click();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const markdown = getMarkdownFromEditor(editor);
    if (!markdown || submitting) return;
    onSubmit(markdown);
    editor?.commands.clearContent(true);
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
        {FORMAT_BUTTONS.map((btn) => (
          <button
            key={btn.label}
            type="button"
            title={btn.title}
            onClick={() => {
              if (!editor) return;
              const chain = editor.chain().focus();
              switch (btn.action) {
                case 'bold':
                  chain.toggleBold().run();
                  break;
                case 'italic':
                  chain.toggleItalic().run();
                  break;
                case 'strike':
                  chain.toggleStrike().run();
                  break;
                case 'code':
                  chain.toggleCode().run();
                  break;
                case 'bulletList':
                  chain.toggleBulletList().run();
                  break;
                case 'orderedList':
                  chain.toggleOrderedList().run();
                  break;
                case 'blockquote':
                  chain.toggleBlockquote().run();
                  break;
                case 'divider':
                  chain.setHorizontalRule().run();
                  break;
                default:
                  break;
              }
            }}
            className="w-8 h-8 rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 text-xs font-medium"
          >
            {btn.label}
          </button>
        ))}
        <button
          type="button"
          title="Insert table"
          onClick={handleInsertTable}
          className="ml-1 px-2 h-8 rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 text-[10px] font-medium"
        >
          Tbl
        </button>
        <div className="w-px h-5 bg-[color:var(--border-subtle)]/70 mx-1" />
        <button
          type="button"
          title="Insert image"
          onClick={handleImageUpload}
          className="w-8 h-8 rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 flex items-center justify-center"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
        <button
          type="button"
          title="Insert video"
          onClick={handleVideoUpload}
          className="w-8 h-8 rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 flex items-center justify-center"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        </button>
        <button
          type="button"
          title="Insert file link"
          onClick={handleFileLink}
          className="w-8 h-8 rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 flex items-center justify-center"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.5 3.5L21 8l-9.5 9.5a3 3 0 01-4.243 0l-2.757-2.757a3 3 0 010-4.243L11 3l4.5 4.5" />
          </svg>
        </button>
      </div>
      <EditorContent editor={editor} />
      {editor && (
        <BubbleMenu
          editor={editor}
          pluginKey="tableBubbleMenu"
          shouldShow={({ editor: ed }) => ed.isActive('table')}
          tippyOptions={{ placement: 'top', duration: 150 }}
          className="flex items-center gap-0.5 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] px-1.5 py-1 shadow-lg"
        >
          <button
            type="button"
            title="Add column before"
            onClick={() => editor.chain().focus().addColumnBefore().run()}
            className="w-7 h-7 rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] flex items-center justify-center"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <span className="ml-0.5 text-[10px]">Col</span>
          </button>
          <button
            type="button"
            title="Add column after"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
            className="w-7 h-7 rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] flex items-center justify-center"
          >
            <span className="text-[10px]">Col</span>
            <svg className="w-3.5 h-3.5 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
          <button
            type="button"
            title="Delete column"
            onClick={() => editor.chain().focus().deleteColumn().run()}
            className="w-7 h-7 rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] flex items-center justify-center"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span className="ml-0.5 text-[10px]">Col</span>
          </button>
          <div className="w-px h-4 bg-[color:var(--border-subtle)] mx-0.5" />
          <button
            type="button"
            title="Add row before"
            onClick={() => editor.chain().focus().addRowBefore().run()}
            className="w-7 h-7 rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] flex items-center justify-center"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
            <span className="ml-0.5 text-[10px]">Row</span>
          </button>
          <button
            type="button"
            title="Add row after"
            onClick={() => editor.chain().focus().addRowAfter().run()}
            className="w-7 h-7 rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] flex items-center justify-center"
          >
            <span className="text-[10px]">Row</span>
            <svg className="w-3.5 h-3.5 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            type="button"
            title="Delete row"
            onClick={() => editor.chain().focus().deleteRow().run()}
            className="w-7 h-7 rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] flex items-center justify-center"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <span className="ml-0.5 text-[10px]">Row</span>
          </button>
          <div className="w-px h-4 bg-[color:var(--border-subtle)] mx-0.5" />
          <button
            type="button"
            title="Delete table"
            onClick={() => editor.chain().focus().deleteTable().run()}
            className="w-7 h-7 rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] flex items-center justify-center"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span className="ml-0.5 text-[10px]">Table</span>
          </button>
        </BubbleMenu>
      )}
      <div className="px-4 py-2 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] flex justify-end">
        <button
          type="submit"
          disabled={submitting || uploading || !getMarkdownFromEditor(editor)}
          className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting || uploading ? 'Sending…' : 'Comment'}
        </button>
      </div>
    </form>
  );
}
