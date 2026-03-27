import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { uploadFile } from '../../lib/api';
import { BubbleMenu, EditorContent, useEditor } from '@tiptap/react';
import Mention from '@tiptap/extension-mention';
import { Node, mergeAttributes } from '@tiptap/core';
import { baseEditorExtensions, editorContentClass } from '../richText/richTextEditorExtensions';
import RichTextToolbar from '../richText/RichTextToolbar';
import { isEditorHtmlEmpty } from '../../lib/richTextStorage';

interface TaskCommentBoxProps {
  onSubmit: (body: string) => void;
  submitting: boolean;
  placeholder?: string;
  mentionUsers?: Array<{ _id: string; name: string; email: string }>;
}

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
    return [
      {
        tag: 'div[data-video-block]',
        getAttrs: (el) => {
          if (typeof el === 'string') return false;
          const node = el as HTMLElement;
          return {
            url: node.getAttribute('data-url') || '',
            name: node.getAttribute('data-name') || '',
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-video-block': 'true',
        'data-url': node.attrs.url || '',
        'data-name': node.attrs.name || '',
      }),
    ];
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
    return [
      {
        tag: 'div[data-attachment-block]',
        getAttrs: (el) => {
          if (typeof el === 'string') return false;
          const node = el as HTMLElement;
          return {
            url: node.getAttribute('data-url') || '',
            name: node.getAttribute('data-name') || '',
            mimeType: node.getAttribute('data-mime-type') || '',
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-attachment-block': 'true',
        'data-url': node.attrs.url || '',
        'data-name': node.attrs.name || '',
        'data-mime-type': node.attrs.mimeType || '',
        class:
          'my-2 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] text-[11px] text-[color:var(--text-primary)]',
      }),
      (node.attrs.name as string) || 'Attachment',
    ];
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

export default function TaskCommentBox({
  onSubmit,
  submitting,
  placeholder = 'Add a comment…',
  mentionUsers = [],
}: TaskCommentBoxProps) {
  const { token } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draftSnapshot, setDraftSnapshot] = useState('');
  const mentionUsersRef = useRef<Array<{ _id: string; name: string; email: string }>>([]);
  useEffect(() => {
    mentionUsersRef.current = mentionUsers;
  }, [mentionUsers]);

  const mentionSuggestion = {
    items: ({ query }: { query: string }) => {
      const users = mentionUsersRef.current || [];
      if (users.length === 0) return [];
      const qRaw = (query || '').trim();
      const q = qRaw.replace(/^@/, '').toLowerCase().trim();
      const qTight = q.replace(/\s+/g, '');
      if (!q) return users;
      const filtered = users
        .filter((u) => {
          const name = (u.name || '').toLowerCase();
          const email = (u.email || '').toLowerCase();
          if (name.includes(q) || email.includes(q)) return true;
          const nameTight = name.replace(/\s+/g, '');
          const emailTight = email.replace(/\s+/g, '');
          return nameTight.includes(qTight) || emailTight.includes(qTight);
        })
        .slice(0, 50);
      return filtered.length ? filtered : users;
    },
    render: () => {
      let root: HTMLDivElement | null = null;
      let selectedIndex = 0;
      let items: Array<{ _id: string; name: string; email: string }> = [];
      let command: ((p: { id: string; label: string }) => void) | null = null;

      function mount() {
        if (root) return;
        root = document.createElement('div');
        root.style.position = 'absolute';
        root.style.zIndex = '1000';
        document.body.appendChild(root);
      }

      function unmount() {
        if (root) root.remove();
        root = null;
      }

      function position(clientRect?: DOMRect) {
        if (!root || !clientRect) return;
        root.style.left = `${clientRect.left}px`;
        root.style.top = `${clientRect.bottom + 6}px`;
      }

      function renderList() {
        if (!root) return;
        root.innerHTML = '';
        const box = document.createElement('div');
        box.className =
          'w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-2xl overflow-hidden';
        const listEl = document.createElement('div');
        listEl.className = 'max-h-60 overflow-auto p-1';

        if (items.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'px-3 py-2 text-xs text-[color:var(--text-muted)]';
          empty.textContent = (mentionUsersRef.current || []).length === 0 ? 'Loading users…' : 'No matches';
          listEl.appendChild(empty);
        } else {
          items.forEach((u, i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className =
              'w-full text-left px-3 py-2 rounded-lg transition flex flex-col gap-0.5 hover:bg-[color:var(--bg-surface)]';
            if (i === selectedIndex) btn.className += ' bg-[color:var(--bg-surface)]';
            const name = document.createElement('div');
            name.className = 'text-xs font-medium text-[color:var(--text-primary)] truncate';
            name.textContent = u.name;
            const email = document.createElement('div');
            email.className = 'text-[11px] text-[color:var(--text-muted)] truncate';
            email.textContent = u.email;
            btn.append(name, email);
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', () => command?.({ id: u._id, label: u.name }));
            listEl.appendChild(btn);
          });
        }

        box.appendChild(listEl);
        root.appendChild(box);
      }

      return {
        onStart: (props: any) => {
          mount();
          items = props.items ?? [];
          selectedIndex = 0;
          command = props.command;
          renderList();
          position(props.clientRect?.());
        },
        onUpdate: (props: any) => {
          items = props.items ?? [];
          selectedIndex = 0;
          command = props.command;
          renderList();
          position(props.clientRect?.());
        },
        onKeyDown: (props: any) => {
          if (props.event.key === 'Escape') {
            unmount();
            return true;
          }
          if (props.event.key === 'ArrowDown') {
            selectedIndex = Math.min(items.length - 1, selectedIndex + 1);
            renderList();
            return true;
          }
          if (props.event.key === 'ArrowUp') {
            selectedIndex = Math.max(0, selectedIndex - 1);
            renderList();
            return true;
          }
          if (props.event.key === 'Enter') {
            const item = items[selectedIndex];
            if (item) {
              props.command({ id: item._id, label: item.name });
              return true;
            }
          }
          return false;
        },
        onExit: () => {
          unmount();
        },
      };
    },
  };

  const editor = useEditor(
    {
      extensions: [
        ...baseEditorExtensions(placeholder),
        Mention.configure({
          HTMLAttributes: {
            class:
              'inline-flex items-center rounded-md bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] px-2 py-0.5 text-xs text-[color:var(--text-primary)] font-medium',
          },
          suggestion: mentionSuggestion as any,
        }),
        VideoBlock,
        AttachmentBlock,
      ],
      editorProps: {
        attributes: {
          class: editorContentClass(
            'min-h-[96px] px-4 py-3 bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] text-sm leading-relaxed outline-none'
          ),
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
    },
    []
  );

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
    const html = editor?.getHTML() ?? '';
    if (isEditorHtmlEmpty(html) || submitting) return;
    onSubmit(html);
    editor?.commands.clearContent(true);
    setExpanded(false);
    setDraftSnapshot('');
  };

  const mediaBtn =
    'w-8 h-8 rounded text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 flex items-center justify-center';

  const handleCancel = () => {
    if (!editor) return;
    editor.commands.setContent(draftSnapshot || '', false);
    setExpanded(false);
  };

  const handleExpand = () => {
    if (!editor) return;
    setDraftSnapshot(editor.getHTML());
    setExpanded(true);
    requestAnimationFrame(() => {
      editor.chain().focus('end').run();
    });
  };

  if (!expanded) {
    return (
      <div className="rounded-xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-3">
        <button
          type="button"
          onClick={handleExpand}
          className="w-full text-left px-3 py-2.5 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-sm text-[color:var(--text-muted)] hover:border-[color:var(--accent)]/50 transition-colors"
        >
          {placeholder}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
      <RichTextToolbar
        editor={editor}
        onPickImage={handleImageUpload}
        extraRight={
          <>
            <button type="button" title="Insert video" onClick={handleVideoUpload} className={mediaBtn}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </button>
            <button type="button" title="Insert file link" onClick={handleFileLink} className={mediaBtn}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.5 3.5L21 8l-9.5 9.5a3 3 0 01-4.243 0l-2.757-2.757a3 3 0 010-4.243L11 3l4.5 4.5" />
              </svg>
            </button>
          </>
        }
      />
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
      <div className="px-4 py-2 border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handleCancel}
          disabled={submitting || uploading}
          className="px-3 py-1.5 rounded-md text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || uploading || !editor || isEditorHtmlEmpty(editor.getHTML())}
          className="px-3 py-1.5 rounded-md bg-[color:var(--accent)] text-xs text-white hover:opacity-95 disabled:opacity-60 disabled:bg-[color:var(--bg-elevated)] disabled:text-[color:var(--text-muted)] disabled:cursor-not-allowed transition-colors"
        >
          {submitting || uploading ? 'Sending…' : 'Comment'}
        </button>
      </div>
    </form>
  );
}
