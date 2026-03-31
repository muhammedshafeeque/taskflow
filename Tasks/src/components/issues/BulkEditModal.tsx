import { createPortal } from 'react-dom';
import type { User, Sprint } from '../../lib/api';

interface BulkForm {
  status?: string;
  assignee?: string;
  sprint?: string;
  storyPoints?: string;
  type?: string;
  priority?: string;
}

interface BulkEditModalProps {
  bulkModal: 'edit' | null;
  setBulkModal: (m: 'edit' | null) => void;
  bulkForm: BulkForm;
  setBulkForm: (f: BulkForm | ((prev: BulkForm) => BulkForm)) => void;
  bulkSubmitting: boolean;
  handleBulkUpdate: () => void;
  submitError: string;
  statusList: string[];
  users: User[];
  sprints: Sprint[];
  typeList: string[];
  priorityList: string[];
}

export function BulkEditModal({
  bulkModal,
  setBulkModal,
  bulkForm,
  setBulkForm,
  bulkSubmitting,
  handleBulkUpdate,
  submitError,
  statusList,
  users,
  sprints,
  typeList,
  priorityList,
}: BulkEditModalProps) {
  if (bulkModal !== 'edit') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={() => setBulkModal(null)}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] shadow-xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-[color:var(--text-primary)] mb-3">Bulk edit</h3>
        {submitError && <p className="text-xs text-red-400 mb-2">{submitError}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-[color:var(--text-muted)] mb-1">Status</label>
            <select value={bulkForm.status ?? ''} onChange={(e) => setBulkForm((f) => ({ ...f, status: e.target.value || undefined }))} className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)]">
              <option value="">— No change —</option>
              {statusList.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[color:var(--text-muted)] mb-1">Assignee</label>
            <select value={bulkForm.assignee ?? ''} onChange={(e) => setBulkForm((f) => ({ ...f, assignee: e.target.value || undefined }))} className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)]">
              <option value="">— No change —</option>
              <option value="__unassigned__">Unassigned</option>
              {users.map((u) => <option key={u._id} value={u._id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[color:var(--text-muted)] mb-1">Sprint</label>
            <select value={bulkForm.sprint ?? ''} onChange={(e) => setBulkForm((f) => ({ ...f, sprint: e.target.value || undefined }))} className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)]">
              <option value="">— No change —</option>
              <option value="__backlog__">Backlog</option>
              {sprints.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[color:var(--text-muted)] mb-1">Story points</label>
            <select value={bulkForm.storyPoints ?? ''} onChange={(e) => setBulkForm((f) => ({ ...f, storyPoints: e.target.value || undefined }))} className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)]">
              <option value="">— No change —</option>
              <option value="__clear__">Clear story points</option>
              {[0, 1, 2, 3, 5, 8, 13, 21].map((p) => <option key={p} value={String(p)}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[color:var(--text-muted)] mb-1">Type</label>
            <select value={bulkForm.type ?? ''} onChange={(e) => setBulkForm((f) => ({ ...f, type: e.target.value || undefined }))} className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)]">
              <option value="">— No change —</option>
              {typeList.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-[color:var(--text-muted)] mb-1">Priority</label>
            <select value={bulkForm.priority ?? ''} onChange={(e) => setBulkForm((f) => ({ ...f, priority: e.target.value || undefined }))} className="w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-primary)]">
              <option value="">— No change —</option>
              {priorityList.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-4">
          <button type="button" onClick={() => setBulkModal(null)} className="px-3 py-1.5 rounded text-xs border border-[color:var(--border-subtle)] text-[color:var(--text-muted)]">Cancel</button>
          <button type="button" onClick={handleBulkUpdate} disabled={bulkSubmitting} className="px-3 py-1.5 rounded text-xs bg-[color:var(--accent)] text-white font-medium disabled:opacity-50">{bulkSubmitting ? 'Updating…' : 'Apply'}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
