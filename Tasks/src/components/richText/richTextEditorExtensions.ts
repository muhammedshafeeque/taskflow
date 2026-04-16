import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import TextAlign from '@tiptap/extension-text-align';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';

const tableClass =
  'border-collapse w-full my-2 text-sm [&_th]:border [&_th]:border-[color:var(--border-subtle)] [&_th]:bg-[color:var(--bg-elevated)] [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_td]:border [&_td]:border-[color:var(--border-subtle)] [&_td]:px-2 [&_td]:py-1.5';

const editorSurfaceClass =
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_p]:my-1 [&_h1]:text-[1.375rem] [&_h1]:font-bold [&_h1]:leading-[1.3] [&_h1]:my-2 [&_h2]:text-[1.125rem] [&_h2]:font-semibold [&_h2]:leading-[1.35] [&_h2]:my-2 [&_h3]:text-[1rem] [&_h3]:font-semibold [&_h3]:leading-[1.4] [&_h3]:my-1.5';

/** Shared TipTap stack for issue description and comments (add Mention / custom nodes in comment box). */
export function baseEditorExtensions(placeholder: string) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      bulletList: { HTMLAttributes: { class: 'pl-5' } },
      orderedList: { HTMLAttributes: { class: 'pl-5' } },
      codeBlock: {
        HTMLAttributes: {
          class:
            'rounded-md bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] p-3 text-sm font-mono my-2 border border-[color:var(--border-subtle)]/80',
        },
      },
    }),
    TextAlign.configure({
      types: ['heading', 'paragraph'],
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        class: 'text-[color:var(--accent)] underline underline-offset-2',
      },
    }),
    TextStyle,
    Color,
    Image.configure({
      inline: false,
      HTMLAttributes: {
        class: 'max-w-full rounded-lg border border-[color:var(--border-subtle)] my-2',
      },
    }),
    Placeholder.configure({ placeholder }),
    Table.configure({
      resizable: false,
      HTMLAttributes: { class: tableClass },
    }),
    TableRow,
    TableHeader,
    TableCell,
  ];
}

export function editorContentClass(extra = '') {
  return `${editorSurfaceClass} ${extra}`.trim();
}
