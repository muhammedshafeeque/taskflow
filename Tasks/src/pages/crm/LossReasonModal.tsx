import { useState } from 'react';
import { Field, Modal, btnPrimary, btnSecondary, inputCls } from './crmKit';

/** Asks why a deal was lost before it moves to a lost stage (AUT-32: a reason is required). */
export default function LossReasonModal({ title, onCancel, onConfirm }: { title: string; onCancel: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  return (
    <Modal open title="Mark deal as lost" subtitle={title} onClose={onCancel}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!reason.trim()) return;
          setSaving(true);
          await onConfirm(reason.trim());
          setSaving(false);
        }}
      >
        <Field label="Why was it lost?" hint="Required. Shows up in the dashboard's loss-reason breakdown.">
          <input autoFocus required className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Price, Timing, Went with competitor" />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnSecondary} onClick={onCancel}>Cancel</button>
          <button type="submit" disabled={saving || !reason.trim()} className={btnPrimary}>Mark lost</button>
        </div>
      </form>
    </Modal>
  );
}
