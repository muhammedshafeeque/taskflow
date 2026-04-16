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
      <section className="rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] card-shadow overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
          <span className="type-label-caps">
            Description
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs px-2.5 py-1 rounded-md text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSave(editValue)}
              disabled={saving}
              className="text-xs font-medium px-2.5 py-1 rounded-md bg-[color:var(--accent)] text-white hover:opacity-90 transition disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Done'}
            </button>
          </div>
        </div>
        <div className="px-4 py-4" data-description-editor>
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
    <section className="rounded-lg bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] card-shadow overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
        <span className="type-label-caps">
          Description
        </span>
        {onUpdateDescription && (
          <button
            type="button"
            onClick={() => {
              setEditValue(issue.description ?? '');
              setEditing(true);
            }}
            className="text-xs font-medium px-2.5 py-1 rounded-md text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] transition-colors"
          >
            Edit
          </button>
        )}
      </div>
      <div className="px-4 py-4">
        {issue.description ? (
          <RichTextContent body={issue.description} />
        ) : (
          <p className="type-meta italic py-6 text-center">
            {onUpdateDescription ? 'Add a description…' : 'No description.'}
          </p>
        )}
      </div>
    </section>
  );
}
