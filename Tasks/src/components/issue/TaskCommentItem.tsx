import type { Comment } from '../../lib/api';
import RichTextContent from '../richText/RichTextContent';

function relativeTime(s: string | undefined) {
  if (!s) return '';
  const d = new Date(s);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `about ${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  return new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

interface TaskCommentItemProps {
  comment: Comment;
}

export default function TaskCommentItem({ comment }: TaskCommentItemProps) {
  const authorName = typeof comment.author === 'object' ? comment.author.name : 'Unknown';

  return (
    <div className="rounded-xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] p-4">
      <RichTextContent body={comment.body} />
      <p className="text-[color:var(--text-muted)] text-[11px] mt-3 flex items-center gap-1">
        <span className="font-medium text-[color:var(--text-primary)]">{authorName}</span>
        <span>·</span>
        <span>{relativeTime(comment.createdAt)}</span>
      </p>
    </div>
  );
}
