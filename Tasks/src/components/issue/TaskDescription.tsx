import { useState, useCallback } from 'react';
import type { Issue } from '../../lib/api';
import DescriptionEditor from './DescriptionEditor';
import RichTextContent from '../richText/RichTextContent';

interface TaskDescriptionProps {
  issue: Issue;
  onUpdateDescription?: (description: string) => void;
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
          <RichTextContent body={issue.description} />
        ) : (
          <p className="text-sm text-[color:var(--text-muted)] italic">
            {onUpdateDescription ? 'Add a description…' : 'No description.'}
          </p>
        )}
      </div>
    </section>
  );
}
