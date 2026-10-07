import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getFilesFromDataTransfer } from '../lib/clipboardFiles';
import {
  authApi,
  uploadFile,
  projectsApi,
  dashboardApi,
  type Project,
  type DashboardStats,
} from '../lib/api';
import { formatDateDDMMYYYY } from '../lib/dateFormat';
import ApiTokensCard from '../components/profile/ApiTokensCard';
import LanguageCard from '../components/profile/LanguageCard';
import TwoFactorCard from '../components/profile/TwoFactorCard';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

function getAvatarUrl(avatarUrl?: string): string | null {
  if (!avatarUrl) return null;
  const base = API_BASE.replace(/\/api\/?$/, '') || 'http://localhost:5000';
  return avatarUrl.startsWith('http') ? avatarUrl : `${base}${avatarUrl}`;
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  return formatDateDDMMYYYY(iso);
}

function getIssueKey(issue: { key?: string; _id: string }): string {
  return issue.key ?? issue._id.slice(-6).toUpperCase();
}

export default function Profile() {
  const { user, token, updateUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [editName, setEditName] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [loading, setLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    if (!token) return;
    projectsApi.list(1, 50, token).then((res) => {
      if (res.success && res.data?.data) setProjects(res.data.data);
    });
  }, [token, user?.activeOrganizationId]);

  useEffect(() => {
    if (!token) return;
    dashboardApi.getStats(token).then((res) => {
      if (res.success && res.data) setStats(res.data);
    });
  }, [token, user?.activeOrganizationId]);

  const avatarValidTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  async function handleAvatarFile(file: File) {
    if (!token || !user) return;
    if (!avatarValidTypes.includes(file.type)) {
      setError('Please upload a JPEG, PNG, GIF, or WebP image');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Image must be under 2 MB');
      return;
    }
    setAvatarLoading(true);
    setError('');
    const res = await uploadFile(file, token);
    setAvatarLoading(false);
    if (res.success && res.data?.url) {
      const profileRes = await authApi.updateProfile({ avatarUrl: res.data.url }, token);
      if (profileRes.success && profileRes.data?.user) {
        updateUser(profileRes.data.user);
      }
    } else {
      setError((res as { message?: string }).message ?? 'Upload failed');
    }
  }

  function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    void handleAvatarFile(file);
  }

  function handleAvatarPaste(e: React.ClipboardEvent) {
    const files = getFilesFromDataTransfer(e.clipboardData);
    const image = files.find((f) => avatarValidTypes.includes(f.type));
    if (!image) return;
    e.preventDefault();
    void handleAvatarFile(image);
  }

  function handleAvatarDrop(e: React.DragEvent) {
    const files = getFilesFromDataTransfer(e.dataTransfer);
    const image = files.find((f) => avatarValidTypes.includes(f.type));
    if (!image) return;
    e.preventDefault();
    void handleAvatarFile(image);
  }

  function handleAvatarDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  async function handleRemoveAvatar() {
    if (!token || !user) return;
    setAvatarLoading(true);
    setError('');
    const res = await authApi.updateProfile({ avatarUrl: '' }, token);
    setAvatarLoading(false);
    if (res.success && res.data?.user) {
      updateUser(res.data.user);
    } else {
      setError((res as { message?: string }).message ?? 'Failed to remove avatar');
    }
  }

  async function handleSaveName() {
    if (!token || !user || editName.trim() === user.name) {
      setIsEditingName(false);
      return;
    }
    setLoading(true);
    setError('');
    const res = await authApi.updateProfile({ name: editName.trim() }, token);
    setLoading(false);
    if (res.success && res.data?.user) {
      updateUser(res.data.user);
      setIsEditingName(false);
    } else {
      setError((res as { message?: string }).message ?? 'Failed to update name');
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess(false);
    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (!token) {
      setError('Not authenticated');
      return;
    }
    setLoading(true);
    const res = await authApi.changePassword(currentPassword, newPassword, token);
    setLoading(false);
    if (res.success && res.data) {
      const data = res.data as { user: import('../lib/api').AuthUser };
      if (data.user) updateUser(data.user);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(true);
    } else {
      setError((res as { message?: string }).message ?? 'Failed to change password');
    }
  }

  if (!user) return null;

  const avatarFullUrl = getAvatarUrl(user.avatarUrl);
  const initials = getInitials(user.name);

  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 space-y-8 overflow-x-hidden">
      <h1 className="text-2xl font-semibold text-[color:var(--text-primary)]">Profile</h1>

      {/* Hero / Avatar section */}
      <div className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6">
        <div
          className="relative group outline-none rounded-full focus-visible:ring-2 focus-visible:ring-[color:var(--accent)]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg-surface)]"
          tabIndex={0}
          onPaste={handleAvatarPaste}
          onDrop={handleAvatarDrop}
          onDragOver={handleAvatarDragOver}
          aria-label="Profile photo — paste or drop an image when focused"
        >
          <div className="w-28 h-28 rounded-full overflow-hidden bg-[color:var(--bg-page)] border-2 border-[color:var(--border-subtle)] flex items-center justify-center text-2xl font-semibold text-[color:var(--text-muted)] shrink-0">
            {avatarFullUrl ? (
              <img src={avatarFullUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <div className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={handleAvatarUpload}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarLoading}
              className="px-3 py-1.5 rounded-md bg-[color:var(--bg-surface)] text-[color:var(--text-primary)] text-xs font-medium border border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-page)] disabled:opacity-50"
            >
              {avatarLoading ? 'Uploading…' : 'Upload'}
            </button>
            {avatarFullUrl && (
              <button
                type="button"
                onClick={handleRemoveAvatar}
                disabled={avatarLoading}
                className="px-3 py-1.5 rounded-md bg-red-500/90 text-white text-xs font-medium hover:bg-red-500 disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>
          {/* Visible on touch devices / when hover overlay is not shown */}
          <div className="mt-2 flex justify-center gap-2 sm:hidden">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarLoading}
              className="text-xs text-[color:var(--accent)] hover:underline"
            >
              {avatarLoading ? 'Uploading…' : 'Change photo'}
            </button>
            {avatarFullUrl && (
              <button
                type="button"
                onClick={handleRemoveAvatar}
                disabled={avatarLoading}
                className="text-xs text-red-400 hover:underline"
              >
                Remove
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 text-center sm:text-left min-w-0">
          {isEditingName ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') {
                    setEditName(user.name);
                    setIsEditingName(false);
                  }
                }}
                autoFocus
                className="px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-lg font-medium focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/50"
              />
              <button
                type="button"
                onClick={handleSaveName}
                disabled={loading}
                className="px-3 py-2 rounded-lg bg-[color:var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditName(user.name);
                  setIsEditingName(false);
                }}
                className="px-3 py-2 rounded-lg text-[color:var(--text-muted)] text-sm hover:bg-[color:var(--bg-page)]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditName(user.name);
                setIsEditingName(true);
              }}
              className="text-xl font-semibold text-[color:var(--text-primary)] hover:underline"
            >
              {user.name}
            </button>
          )}
          <p className="text-sm text-[color:var(--text-muted)] mt-1">{user.email}</p>
          <div className="flex flex-wrap gap-3 mt-2 text-xs text-[color:var(--text-muted)]">
            {user.roleName && (
              <span className="px-2 py-0.5 rounded-md bg-[color:var(--bg-page)]">{user.roleName}</span>
            )}
          </div>
        </div>
      </div>

      {/* Quick links & Projects */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6">
          <h2 className="text-base font-medium text-[color:var(--text-primary)] mb-4">Quick links</h2>
          <div className="flex flex-wrap gap-3">
            <Link
              to="/issues?quick=my"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[color:var(--accent)]/10 text-[color:var(--accent)] text-sm font-medium hover:bg-[color:var(--accent)]/20 transition"
            >
              My assigned issues
            </Link>
            <Link
              to="/issues"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm font-medium hover:bg-[color:var(--bg-surface)] transition"
            >
              All issues
            </Link>
            <Link
              to="/inbox"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm font-medium hover:bg-[color:var(--bg-surface)] transition"
            >
              Inbox
            </Link>
            <Link
              to="/workload"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm font-medium hover:bg-[color:var(--bg-surface)] transition"
            >
              Workload
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6">
          <h2 className="text-base font-medium text-[color:var(--text-primary)] mb-4">Projects I&apos;m in</h2>
          {projects.length ? (
            <ul className="space-y-2">
              {projects.slice(0, 8).map((p) => (
                <li key={p._id}>
                  <Link
                    to={`/projects/${p._id}/dashboard`}
                    className="text-sm text-[color:var(--accent)] hover:underline"
                  >
                    {p.name} ({p.key})
                  </Link>
                </li>
              ))}
              {projects.length > 8 && (
                <li>
                  <Link to="/projects" className="text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]">
                    View all {projects.length} projects
                  </Link>
                </li>
              )}
            </ul>
          ) : (
            <p className="text-sm text-[color:var(--text-muted)]">No projects yet.</p>
          )}
        </div>
      </div>

      {/* Recent activity */}
      {stats && stats.recentIssues.length > 0 && (
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6">
          <h2 className="text-base font-medium text-[color:var(--text-primary)] mb-4">Recent activity</h2>
          <ul className="space-y-2">
            {stats.recentIssues.slice(0, 5).map((issue) => (
              <li key={issue._id}>
                <Link
                  to={issue.project ? `/projects/${issue.project}/issues/${encodeURIComponent(issue.key ?? issue._id)}` : `/issues`}
                  className="flex items-center justify-between gap-2 text-sm text-[color:var(--text-primary)] hover:text-[color:var(--accent)]"
                >
                  <span className="truncate">{getIssueKey(issue)} — {issue.title}</span>
                  <span className="text-xs text-[color:var(--text-muted)] shrink-0">{issue.status}</span>
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/issues" className="mt-3 inline-block text-sm text-[color:var(--accent)] hover:underline">
            View all issues
          </Link>
        </div>
      )}

      {/* Notification preferences */}
      <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6">
        <h2 className="text-base font-medium text-[color:var(--text-primary)] mb-2">Notification preferences</h2>
        <p className="text-sm text-[color:var(--text-muted)] mb-4">
          Configure methods per event in a dedicated notification settings screen.
        </p>
        <Link
          to="/profile/notifications"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[color:var(--accent)] text-white text-sm font-medium hover:opacity-90"
        >
          Open notification settings
        </Link>
      </div>

      {/* Profile details grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6">
          <h2 className="text-base font-medium text-[color:var(--text-primary)] mb-4">Account details</h2>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-[color:var(--text-muted)] mb-0.5">Name</dt>
              <dd className="text-[color:var(--text-primary)] font-medium">{user.name}</dd>
            </div>
            <div>
              <dt className="text-[color:var(--text-muted)] mb-0.5">Email</dt>
              <dd className="text-[color:var(--text-primary)] font-medium">{user.email}</dd>
            </div>
            <div>
              <dt className="text-[color:var(--text-muted)] mb-0.5">Role</dt>
              <dd className="text-[color:var(--text-primary)] font-medium">{user.roleName ?? user.role}</dd>
            </div>
            <div>
              <dt className="text-[color:var(--text-muted)] mb-0.5">Member since</dt>
              <dd className="text-[color:var(--text-primary)] font-medium">{formatDate(user.createdAt)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6">
          <h2 className="text-base font-medium text-[color:var(--text-primary)] mb-4">Change password</h2>
          <form onSubmit={handleChangePassword} className="space-y-4">
            {error && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm"
              >
                {error}
              </div>
            )}
            {success && (
              <div
                role="status"
                className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm"
              >
                Password updated successfully.
              </div>
            )}
            <div>
              <label htmlFor="current" className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">
                Current password
              </label>
              <input
                id="current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
              />
            </div>
            <div>
              <label htmlFor="new" className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">
                New password
              </label>
              <input
                id="new"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
              />
            </div>
            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">
                Confirm new password
              </label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
                className="w-full px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-[color:var(--accent)] text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Updating…' : 'Update password'}
            </button>
          </form>
        </div>
      </div>

      <TwoFactorCard />
      <LanguageCard />

      {token && <ApiTokensCard token={token} />}

      {/* Security note */}
      <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6">
        <h2 className="text-base font-medium text-[color:var(--text-primary)] mb-2">Security</h2>
        <p className="text-sm text-[color:var(--text-muted)]">
          Keep your account secure by using a strong, unique password. If you suspect unauthorized access, change
          your password immediately and contact your administrator.
        </p>
      </div>
    </div>
  );
}
