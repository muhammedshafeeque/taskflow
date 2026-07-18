import { useCallback, useEffect, useMemo, useState } from 'react';
import { organizationsApi, type AuthUser, type TaskflowOrganizationDetail } from '../lib/api';
import ConfirmModal from './ConfirmModal';

type Props = {
  token: string;
  activeOrganizationId: string | undefined;
  user: AuthUser | null;
  onMembersChanged: () => void;
  /** When true, only workspace profile and identifiers are shown (no members list, invites, or CSV). */
  hideMembers?: boolean;
};

function escapeCsvCell(s: string) {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function OrganizationSettingsPanel({
  token,
  activeOrganizationId,
  user,
  onMembersChanged,
  hideMembers = false,
}: Props) {
  const [detail, setDetail] = useState<TaskflowOrganizationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'org_admin' | 'org_member'>('org_member');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [orgStatus, setOrgStatus] = useState<'active' | 'archived'>('active');
  const [orgName, setOrgName] = useState('');
  const [orgDescription, setOrgDescription] = useState('');
  const [orgSaving, setOrgSaving] = useState(false);
  const [roleBusyUserId, setRoleBusyUserId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ userId: string; label: string; isSelf: boolean } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

  const activeRole = user?.organizations?.find((o) => o.id === activeOrganizationId)?.role;
  const isOrgAdmin = activeRole === 'org_admin';
  const currentUserId = user?.id;

  const load = useCallback(async () => {
    if (!activeOrganizationId || !token) return;
    setLoading(true);
    setError(null);
    const res = await organizationsApi.get(activeOrganizationId, token);
    setLoading(false);
    if (!res.success || !res.data) {
      setError((res as { message?: string }).message ?? 'Failed to load workspace');
      setDetail(null);
      return;
    }
    setDetail(res.data);
  }, [activeOrganizationId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detail) return;
    setOrgName(detail.organization.name);
    setOrgDescription(detail.organization.description ?? '');
    const s = detail.organization.status;
    setOrgStatus(s === 'archived' ? 'archived' : 'active');
  }, [detail]);

  const adminCount = useMemo(
    () => detail?.members.filter((m) => m.status === 'active' && m.role === 'org_admin').length ?? 0,
    [detail]
  );

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrganizationId || !inviteEmail.trim()) return;
    setInviteBusy(true);
    const res = await organizationsApi.inviteMember(
      activeOrganizationId,
      { email: inviteEmail.trim(), role: inviteRole },
      token
    );
    setInviteBusy(false);
    if (!res.success) {
      setError((res as { message?: string }).message ?? 'Invite failed');
      return;
    }
    setInviteEmail('');
    setError(null);
    await load();
    onMembersChanged();
  }

  async function runBulkInvite() {
    if (!activeOrganizationId) return;
    const parts = bulkText.split(/[\n,;\t]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const unique = [...new Set(parts)].filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (unique.length === 0) {
      setBulkSummary('Enter at least one valid email (one per line).');
      return;
    }
    setBulkBusy(true);
    setBulkSummary(null);
    setError(null);
    const ok: string[] = [];
    const failed: { email: string; msg: string }[] = [];
    for (const email of unique) {
      const res = await organizationsApi.inviteMember(activeOrganizationId, { email, role: 'org_member' }, token);
      if (res.success) ok.push(email);
      else failed.push({ email, msg: (res as { message?: string }).message ?? 'Failed' });
    }
    setBulkBusy(false);
    setBulkSummary(
      `Added or invited: ${ok.length}. Failed: ${failed.length}.` +
        (failed.length ? ` ${failed.map((f) => `${f.email} (${f.msg})`).join('; ')}` : '')
    );
    await load();
    onMembersChanged();
  }

  async function saveOrganizationProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!activeOrganizationId || !isOrgAdmin) return;
    setOrgSaving(true);
    setError(null);
    const res = await organizationsApi.update(
      activeOrganizationId,
      { name: orgName.trim(), description: orgDescription, status: orgStatus },
      token
    );
    setOrgSaving(false);
    if (!res.success) {
      setError((res as { message?: string }).message ?? 'Could not save workspace');
      return;
    }
    await load();
    onMembersChanged();
  }

  async function changeMemberRole(targetUserId: string, role: 'org_admin' | 'org_member') {
    if (!activeOrganizationId) return;
    setRoleBusyUserId(targetUserId);
    setError(null);
    const res = await organizationsApi.updateMemberRole(activeOrganizationId, targetUserId, { role }, token);
    setRoleBusyUserId(null);
    if (!res.success) {
      setError((res as { message?: string }).message ?? 'Could not update role');
      return;
    }
    await load();
    onMembersChanged();
  }

  async function confirmRemove() {
    if (!activeOrganizationId || !removeTarget || removeBusy) return;
    setRemoveBusy(true);
    setError(null);
    const res = await organizationsApi.removeMember(activeOrganizationId, removeTarget.userId, token);
    setRemoveBusy(false);
    if (!res.success) {
      setError((res as { message?: string }).message ?? 'Could not remove member');
      setRemoveTarget(null);
      return;
    }
    setRemoveTarget(null);
    await load();
    onMembersChanged();
  }

  function exportMembersCsv() {
    if (!detail) return;
    const rows = [['name', 'email', 'role', 'status'].join(',')];
    for (const m of detail.members) {
      const name = m.user?.name ?? '';
      const email = m.user?.email ?? '';
      rows.push([escapeCsvCell(name), escapeCsvCell(email), escapeCsvCell(m.role), escapeCsvCell(m.status)].join(','));
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workspace-members-${detail.organization.slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setError(null);
      setCopyFeedback(`Copied ${label} to clipboard.`);
      window.setTimeout(() => setCopyFeedback(null), 2500);
    } catch {
      setError('Could not copy to clipboard');
    }
  }

  return (
    <div className="space-y-4 text-sm">
      {error && (
        <div className="rounded-md border border-[color:var(--color-blocked)]/40 bg-[color:var(--color-blocked)]/10 px-3 py-2 text-xs text-[color:var(--color-blocked)]">
          {error}
        </div>
      )}
      {copyFeedback && <p className="text-xs text-[color:var(--accent)]">{copyFeedback}</p>}
      {bulkSummary && (
        <div className="rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 text-xs text-[color:var(--text-muted)]">
          {bulkSummary}
        </div>
      )}
      {loading && <p className="text-xs text-[color:var(--text-muted)]">Loading…</p>}
      {!loading && detail && (
        <>
          {isOrgAdmin ? (
            <form onSubmit={saveOrganizationProfile} className="space-y-3 border-b border-[color:var(--border-subtle)] pb-4">
              <div className="text-xs font-semibold text-[color:var(--text-primary)]">Organization profile</div>
              <label className="block space-y-1">
                <span className="text-[11px] text-[color:var(--text-muted)]">Name</span>
                <input
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1.5 text-xs outline-none focus:border-[color:var(--accent)]"
                  required
                  minLength={1}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[11px] text-[color:var(--text-muted)]">Description</span>
                <textarea
                  value={orgDescription}
                  onChange={(e) => setOrgDescription(e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1.5 text-xs outline-none focus:border-[color:var(--accent)]"
                />
              </label>
              <label className={`block space-y-1 ${hideMembers ? 'max-w-md' : 'max-w-xs'}`}>
                <span className="text-[11px] text-[color:var(--text-muted)]">Organization status</span>
                <select
                  value={orgStatus}
                  onChange={(e) => setOrgStatus(e.target.value as 'active' | 'archived')}
                  className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1.5 text-xs"
                >
                  <option value="active">active</option>
                  <option value="archived">archived</option>
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={orgSaving}
                  className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  {orgSaving ? 'Saving…' : 'Save profile'}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-2 border-b border-[color:var(--border-subtle)] pb-4">
              <div>
                <div className="text-xs font-medium text-[color:var(--text-muted)]">Name</div>
                <div className="mt-0.5 text-[color:var(--text-primary)]">{detail.organization.name}</div>
              </div>
              {detail.organization.description ? (
                <div>
                  <div className="text-xs font-medium text-[color:var(--text-muted)]">Description</div>
                  <div className="mt-0.5 text-[color:var(--text-primary)] whitespace-pre-wrap">{detail.organization.description}</div>
                </div>
              ) : null}
            </div>
          )}

          <div className="flex flex-wrap gap-2 items-center">
            <div>
              <div className="text-xs font-medium text-[color:var(--text-muted)]">Slug</div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="font-mono text-xs text-[color:var(--text-primary)]">{detail.organization.slug}</span>
                <button
                  type="button"
                  onClick={() => void copyText('slug', detail.organization.slug)}
                  className="text-[11px] text-[color:var(--accent)] hover:underline"
                >
                  Copy
                </button>
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-[color:var(--text-muted)]">Organization ID</div>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="font-mono text-[10px] text-[color:var(--text-primary)] break-all">{detail.organization._id}</span>
                <button
                  type="button"
                  onClick={() => void copyText('organization id', detail.organization._id)}
                  className="text-[11px] text-[color:var(--accent)] hover:underline shrink-0"
                >
                  Copy
                </button>
              </div>
            </div>
            {!hideMembers && (
              <button
                type="button"
                onClick={exportMembersCsv}
                className="ml-auto rounded-md border border-[color:var(--border-subtle)] px-2 py-1 text-[11px] text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)]"
              >
                Export members CSV
              </button>
            )}
          </div>

          {!hideMembers && (
          <div>
            <div className="text-xs font-semibold text-[color:var(--text-primary)] mb-2">Members</div>
            <ul className="space-y-2">
              {detail.members.map((m) => {
                const u = m.user;
                const label = u ? `${u.name} (${u.email})` : String(m._id);
                const uid = u?._id;
                const isSelf = Boolean(currentUserId && uid && currentUserId === uid);
                const canChangeRole = isOrgAdmin && uid && !roleBusyUserId;
                const isTargetAdmin = m.role === 'org_admin';
                const canRemoveOther = isOrgAdmin && uid && !isSelf;
                const canLeaveSelf =
                  uid &&
                  isSelf &&
                  (!isTargetAdmin || (isTargetAdmin && adminCount > 1));
                return (
                  <li
                    key={m._id}
                    className="flex flex-col gap-2 rounded-md border border-[color:var(--border-subtle)] px-2 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="min-w-0 truncate font-medium text-[color:var(--text-primary)]">{label}</span>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {canChangeRole ? (
                        <select
                          value={m.role}
                          disabled={roleBusyUserId === uid}
                          onChange={(e) => {
                            const next = e.target.value as 'org_admin' | 'org_member';
                            if (next !== m.role) void changeMemberRole(uid!, next);
                          }}
                          className="rounded border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-1.5 py-1 text-[11px]"
                        >
                          <option value="org_member">org_member</option>
                          <option value="org_admin">org_admin</option>
                        </select>
                      ) : (
                        <span className="text-[color:var(--text-muted)]">{m.role}</span>
                      )}
                      {canRemoveOther && uid && (
                        <button
                          type="button"
                          onClick={() => setRemoveTarget({ userId: uid, label: u?.name ?? u?.email ?? 'Member', isSelf: false })}
                          className="text-[11px] text-[color:var(--color-blocked)] hover:underline"
                        >
                          Remove
                        </button>
                      )}
                      {canLeaveSelf && uid && (
                        <button
                          type="button"
                          onClick={() => setRemoveTarget({ userId: uid, label: 'your account', isSelf: true })}
                          className="text-[11px] text-[color:var(--text-muted)] hover:underline"
                        >
                          Leave organization
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          )}

          {isOrgAdmin && !hideMembers && (
            <>
              <form onSubmit={submitInvite} className="space-y-2 border-t border-[color:var(--border-subtle)] pt-3">
                <div className="text-xs font-semibold text-[color:var(--text-primary)]">Add member</div>
                <p className="text-[11px] text-[color:var(--text-muted)]">
                  User must already have an Atrium account (same email).
                </p>
                <label className="block space-y-1 max-w-md">
                  <span className="text-[11px] text-[color:var(--text-muted)]">Role</span>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'org_admin' | 'org_member')}
                    className="w-full rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1.5 text-xs"
                  >
                    <option value="org_member">org_member</option>
                    <option value="org_admin">org_admin</option>
                  </select>
                </label>
                <div className="flex gap-2 max-w-md">
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    className="flex-1 min-w-0 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1.5 text-xs outline-none focus:border-[color:var(--accent)]"
                  />
                  <button
                    type="submit"
                    disabled={inviteBusy}
                    className="shrink-0 rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {inviteBusy ? '…' : 'Add'}
                  </button>
                </div>
              </form>

              <div className="space-y-2 border-t border-[color:var(--border-subtle)] pt-3">
                <div className="text-xs font-semibold text-[color:var(--text-primary)]">Bulk invite</div>
                <p className="text-[11px] text-[color:var(--text-muted)]">
                  One email per line (or comma-separated). Existing members are reported as failed. Invites use role{' '}
                  <strong>org_member</strong>.
                </p>
                <textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  rows={4}
                  placeholder={'alice@acme.com\nbob@acme.com'}
                  className="w-full max-w-lg rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-1.5 text-xs font-mono outline-none focus:border-[color:var(--accent)]"
                />
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void runBulkInvite()}
                  className="rounded-md border border-[color:var(--border-subtle)] px-3 py-1.5 text-xs font-medium hover:bg-[color:var(--bg-surface)] disabled:opacity-50"
                >
                  {bulkBusy ? 'Running…' : 'Run bulk invite'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      <ConfirmModal
        open={Boolean(removeTarget)}
        title={removeTarget?.isSelf ? 'Leave organization?' : 'Remove member?'}
        message={
          removeTarget?.isSelf
            ? 'You will lose access to this organization until an admin adds you again.'
            : `Remove ${removeTarget?.label ?? 'this member'} from this organization?`
        }
        confirmLabel={removeTarget?.isSelf ? 'Leave' : 'Remove'}
        variant="danger"
        onCancel={() => !removeBusy && setRemoveTarget(null)}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );
}
