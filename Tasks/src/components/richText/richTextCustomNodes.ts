import { Node, mergeAttributes } from '@tiptap/core';

export const VideoBlock = Node.create({
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

export const AttachmentBlock = Node.create({
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
