import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Issue } from '../../lib/api';
import DescriptionEditor from './DescriptionEditor';

interface TaskDescriptionProps {
  issue: Issue;
  onUpdateDescription?: (description: string) => void;
}

function DescriptionBody({ body }: { body: string }) {
  const parts: { type: 'text' | 'video'; content: string }[] = [];
  const videoRegex = /\[video\]\((https?:\/\/[^)]+)\)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = videoRegex.exec(body)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ type: 'text', content: body.slice(lastIndex, m.index) });
    }
    parts.push({ type: 'video', content: m[1] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < body.length) {
    parts.push({ type: 'text', content: body.slice(lastIndex) });
  }
  if (parts.length === 0) {
    parts.push({ type: 'text', content: body });
  }

  return (
    <div className="prose prose-invert prose-sm max-w-none break-words [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-[color:var(--border-subtle)]">
      {parts.map((part, i) =>
        part.type === 'video' ? (
          <video
            key={i}
            controls
            className="w-full max-w-lg my-2 rounded-lg border border-[color:var(--border-subtle)]"
            src={part.content}
          />
        ) : (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
            {part.content}
          </ReactMarkdown>
        )
      )}
    </div>
  );
}

export default function TaskDescription({ issue, onUpdateDescription }: TaskDescriptionProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editValue, setEditValue] = useState(issue.description ?? '');

  const handleSave = useCallback(
    async (description: string) => {
      if (onUpdateDescription && description !== (issue.description ?? '')) {
        setSaving(true);
        try {
          await onUpdateDescription(description);
          setEditing(false);
        } finally {
          setSaving(false);
        }
      } else {
        setEditing(false);
      }
    },
    [issue.description, onUpdateDescription]
  );

  if (editing && onUpdateDescription) {
    return (
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[10px] font-semibold text-[color:var(--text-muted)] uppercase tracking-[0.1em]">
            Description
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSave(editValue)}
              disabled={saving}
              className="text-xs font-medium text-[color:var(--accent)] hover:underline disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Done'}
            </button>
          </div>
        </div>
        <div data-description-editor>
          <DescriptionEditor
            value={editValue}
            onChange={setEditValue}
            placeholder="Add a description…"
          />
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[10px] font-semibold text-[color:var(--text-muted)] uppercase tracking-[0.1em]">
          Description
        </h2>
        {onUpdateDescription && (
          <button
            type="button"
            onClick={() => {
              setEditValue(issue.description ?? '');
              setEditing(true);
            }}
            className="text-xs font-medium px-3 py-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-elevated)] transition-colors"
          >
            Edit
          </button>
        )}
      </div>
      <div className="rounded-xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)]/90 p-4 shadow-sm">
        {issue.description ? (
          <DescriptionBody body={issue.description} />
        ) : (
          <p className="text-sm text-[color:var(--text-muted)] italic">
            {onUpdateDescription ? 'Add a description…' : 'No description.'}
          </p>
        )}
      </div>
    </section>
  );
}
