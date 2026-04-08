import { useParams, useNavigate, Link } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useAuth } from '../contexts/AuthContext';
import DateInputDDMMYYYY from '../components/DateInputDDMMYYYY';
import { formatDateDDMMYYYY } from '../lib/dateFormat';
import { useEffect, useState, useRef } from 'react';
import type { IconType } from 'react-icons';
import {
  FiCircle,
  FiAlertCircle,
  FiAlertTriangle,
  FiArrowUp,
  FiArrowDown,
  FiArrowLeft,
  FiArrowRight,
  FiCheck,
  FiX,
  FiStar,
  FiHeart,
  FiFlag,
  FiBell,
  FiCalendar,
  FiClock,
  FiTag,
  FiInfo,
  FiHash,
  FiAtSign,
  FiGithub,
  FiGitBranch,
  FiGitCommit,
  FiGitMerge,
  FiGitPullRequest,
  FiLayers,
  FiLayout,
  FiList,
  FiMenu,
  FiMessageCircle,
  FiMessageSquare,
  FiMoreHorizontal,
  FiMoreVertical,
  FiNavigation,
  FiPaperclip,
  FiPlay,
  FiPause,
  FiRepeat,
  FiRefreshCw,
  FiSearch,
  FiSettings,
  FiShield,
  FiSliders,
  FiPlus,
  FiEdit2,
  FiSun,
  FiMoon,
  FiTerminal,
  FiTrash2,
  FiTrendingUp,
  FiTrendingDown,
  FiUser,
  FiUsers,
  FiZap,
  FiCloud,
  FiDatabase,
  FiFileText,
  FiFolder,
  FiInbox,
  FiLock,
  FiUnlock,
  FiMapPin,
  FiMonitor,
  FiMinus,
} from 'react-icons/fi';
import {
  projectsApi,
  usersApi,
  milestonesApi,
  type Project,
  type ProjectStatus,
  type ProjectIssueType,
  type ProjectPriority,
  type ProjectCustomField,
  type ProjectEnvironment,
  type ProjectReleaseRule,
  type ProjectMember,
  type ProjectInvitation,
  type ProjectDesignation,
  type CustomFieldType,
  type Milestone,
} from '../lib/api';
import { EditIcon, TrashIcon } from '../components/icons/NavigationIcons';
import { userHasPermission } from '../utils/permissions';
import { PROJECT_PERMISSIONS } from '@shared/constants/permissions';

type TabId =
  | 'general'
  | 'statuses'
  | 'issueTypes'
  | 'priorities'
  | 'customFields'
  | 'environments'
  | 'releaseRules'
  | 'milestones'
  | 'members'
  | 'designations';

const ICON_COMPONENTS = {
  circle: FiCircle,
  alertCircle: FiAlertCircle,
  alertTriangle: FiAlertTriangle,
  arrowUp: FiArrowUp,
  arrowDown: FiArrowDown,
  arrowLeft: FiArrowLeft,
  arrowRight: FiArrowRight,
  check: FiCheck,
  x: FiX,
  star: FiStar,
  heart: FiHeart,
  flag: FiFlag,
  bell: FiBell,
  calendar: FiCalendar,
  clock: FiClock,
  tag: FiTag,
  info: FiInfo,
  hash: FiHash,
  at: FiAtSign,
  github: FiGithub,
  gitBranch: FiGitBranch,
  gitCommit: FiGitCommit,
  gitMerge: FiGitMerge,
  gitPullRequest: FiGitPullRequest,
  layers: FiLayers,
  layout: FiLayout,
  list: FiList,
  menu: FiMenu,
  messageCircle: FiMessageCircle,
  messageSquare: FiMessageSquare,
  moreHorizontal: FiMoreHorizontal,
  moreVertical: FiMoreVertical,
  navigation: FiNavigation,
  paperclip: FiPaperclip,
  play: FiPlay,
  pause: FiPause,
  repeat: FiRepeat,
  refresh: FiRefreshCw,
  search: FiSearch,
  settings: FiSettings,
  shield: FiShield,
  sliders: FiSliders,
  sun: FiSun,
  moon: FiMoon,
  terminal: FiTerminal,
  trash: FiTrash2,
  trendingUp: FiTrendingUp,
  trendingDown: FiTrendingDown,
  user: FiUser,
  users: FiUsers,
  zap: FiZap,
  cloud: FiCloud,
  database: FiDatabase,
  fileText: FiFileText,
  folder: FiFolder,
  inbox: FiInbox,
  lock: FiLock,
  unlock: FiUnlock,
  mapPin: FiMapPin,
  monitor: FiMonitor,
  minus: FiMinus,
} satisfies Record<string, IconType>;

export type MetaIconKey = keyof typeof ICON_COMPONENTS;

export const ICON_OPTIONS: { value: MetaIconKey; label: string }[] = [
  { value: 'circle', label: 'Circle' },
  { value: 'alertCircle', label: 'Alert circle' },
  { value: 'alertTriangle', label: 'Warning triangle' },
  { value: 'arrowUp', label: 'Arrow up' },
  { value: 'arrowDown', label: 'Arrow down' },
  { value: 'arrowLeft', label: 'Arrow left' },
  { value: 'arrowRight', label: 'Arrow right' },
  { value: 'check', label: 'Check' },
  { value: 'x', label: 'X' },
  { value: 'star', label: 'Star' },
  { value: 'heart', label: 'Heart' },
  { value: 'flag', label: 'Flag' },
  { value: 'bell', label: 'Bell' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'clock', label: 'Clock' },
  { value: 'tag', label: 'Tag' },
  { value: 'info', label: 'Info' },
  { value: 'hash', label: 'Hash' },
  { value: 'at', label: 'At sign' },
  { value: 'github', label: 'GitHub' },
  { value: 'gitBranch', label: 'Git branch' },
  { value: 'gitCommit', label: 'Git commit' },
  { value: 'gitMerge', label: 'Git merge' },
  { value: 'gitPullRequest', label: 'Git PR' },
  { value: 'layers', label: 'Layers' },
  { value: 'layout', label: 'Layout' },
  { value: 'list', label: 'List' },
  { value: 'menu', label: 'Menu' },
  { value: 'messageCircle', label: 'Message circle' },
  { value: 'messageSquare', label: 'Message square' },
  { value: 'moreHorizontal', label: 'More (horizontal)' },
  { value: 'moreVertical', label: 'More (vertical)' },
  { value: 'navigation', label: 'Navigation' },
  { value: 'paperclip', label: 'Paperclip' },
  { value: 'play', label: 'Play' },
  { value: 'pause', label: 'Pause' },
  { value: 'repeat', label: 'Repeat' },
  { value: 'refresh', label: 'Refresh' },
  { value: 'search', label: 'Search' },
  { value: 'settings', label: 'Settings' },
  { value: 'shield', label: 'Shield' },
  { value: 'sliders', label: 'Sliders' },
  { value: 'sun', label: 'Sun' },
  { value: 'moon', label: 'Moon' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'trash', label: 'Trash' },
  { value: 'trendingUp', label: 'Trending up' },
  { value: 'trendingDown', label: 'Trending down' },
  { value: 'user', label: 'User' },
  { value: 'users', label: 'Users' },
  { value: 'zap', label: 'Zap' },
  { value: 'cloud', label: 'Cloud' },
  { value: 'database', label: 'Database' },
  { value: 'fileText', label: 'File text' },
  { value: 'folder', label: 'Folder' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'lock', label: 'Lock' },
  { value: 'unlock', label: 'Unlock' },
  { value: 'mapPin', label: 'Map pin' },
  { value: 'monitor', label: 'Monitor' },
  { value: 'minus', label: 'Minus' },
];
const CUSTOM_FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select (single)' },
  { value: 'multiselect', label: 'Multi-select' },
  { value: 'user', label: 'User' },
];

const ALL_PROJECT_PERMISSIONS_LIST = [
  { code: PROJECT_PERMISSIONS.SCOPE.DELETE, label: 'Delete Project' },
  { code: PROJECT_PERMISSIONS.ISSUE.ISSUE.CREATE, label: 'Create Issues' },
  { code: PROJECT_PERMISSIONS.ISSUE.ISSUE.READ, label: 'View Issues' },
  { code: PROJECT_PERMISSIONS.ISSUE.ISSUE.UPDATE, label: 'Update Issues' },
  { code: PROJECT_PERMISSIONS.ISSUE.ISSUE.DELETE, label: 'Delete Issues' },
  { code: PROJECT_PERMISSIONS.ISSUE.COMMENT.CREATE, label: 'Create Comments' },
  { code: PROJECT_PERMISSIONS.ISSUE.COMMENT.READ, label: 'View Comments' },
  { code: PROJECT_PERMISSIONS.ISSUE.COMMENT.UPDATE, label: 'Update Comments' },
  { code: PROJECT_PERMISSIONS.ISSUE.COMMENT.DELETE, label: 'Delete Comments' },
  { code: PROJECT_PERMISSIONS.ISSUE.ATTACHMENT.CREATE, label: 'Upload Attachments' },
  { code: PROJECT_PERMISSIONS.ISSUE.ATTACHMENT.READ, label: 'View Attachments' },
  { code: PROJECT_PERMISSIONS.ISSUE.ATTACHMENT.DELETE, label: 'Delete Attachments' },
  { code: PROJECT_PERMISSIONS.BOARD.BOARD.READ, label: 'View Boards' },
  { code: PROJECT_PERMISSIONS.BOARD.BOARD.UPDATE, label: 'Update Boards' },
  { code: PROJECT_PERMISSIONS.SPRINT.SPRINT.CREATE, label: 'Create Sprints' },
  { code: PROJECT_PERMISSIONS.SPRINT.SPRINT.READ, label: 'View Sprints' },
  { code: PROJECT_PERMISSIONS.SPRINT.SPRINT.UPDATE, label: 'Update Sprints' },
  { code: PROJECT_PERMISSIONS.SPRINT.SPRINT.DELETE, label: 'Delete Sprints' },
  { code: PROJECT_PERMISSIONS.SPRINT.SPRINT.START, label: 'Start Sprints' },
  { code: PROJECT_PERMISSIONS.SPRINT.SPRINT.CLOSE, label: 'Close Sprints' },
  { code: PROJECT_PERMISSIONS.VERSION.VERSION.READ, label: 'View Versions' },
  { code: PROJECT_PERMISSIONS.VERSION.VERSION.UPDATE, label: 'Update Versions' },
  { code: PROJECT_PERMISSIONS.VERSION.VERSION.RELEASE, label: 'Release Versions' },
  { code: PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.READ, label: 'View Settings' },
  { code: PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE, label: 'Update Settings' },
  { code: PROJECT_PERMISSIONS.MEMBER.INVITATIONS_MANAGE, label: 'Manage Invitations' },
];

const TABS: { id: TabId; label: string; description: string }[] = [
  { id: 'general', label: 'General', description: 'Name, key, description & lead' },
  { id: 'statuses', label: 'Statuses', description: 'Workflow states for issues' },
  { id: 'issueTypes', label: 'Issue types', description: 'Task, Bug, Story, etc.' },
  { id: 'priorities', label: 'Priorities', description: 'Low, Medium, High, etc.' },
  { id: 'customFields', label: 'Custom fields', description: 'Extra columns on issues' },
  { id: 'environments', label: 'Environments', description: 'QA, Staging, Production' },
  { id: 'releaseRules', label: 'Release rules', description: 'Env → issue status for releases' },
  { id: 'milestones', label: 'Milestones', description: 'Project milestones for roadmap' },
  { id: 'members', label: 'Members', description: 'Invite and manage people' },
  { id: 'designations', label: 'Designations', description: 'Project-specific roles' },
];

export function MetaIconGlyph({ icon, className }: { icon?: string; className?: string }) {
  if (!icon) return null;
  const key = icon as MetaIconKey;
  const Comp = ICON_COMPONENTS[key];
  if (!Comp) return null;
  return <Comp className={className ?? 'w-3.5 h-3.5'} />;
}

function IconSelect({
  value,
  onChange,
  color,
}: {
  value: MetaIconKey | '';
  onChange: (value: MetaIconKey | '') => void;
  color?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = ICON_OPTIONS.find((o) => o.value === value);

  return (
    <div className="relative text-xs" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify_between gap-2 px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)]"
      >
        <span className="flex items-center gap-1">
          {value ? (
            <>
              <span style={color ? { color } : undefined}>
                <MetaIconGlyph icon={value} className="w-3.5 h-3.5" />
              </span>
              <span className="text-[11px] text-[color:var(--text-muted)]">{current?.label}</span>
            </>
          ) : (
            <span className="text-[11px] text-[color:var(--text-muted)]">None</span>
          )}
        </span>
        <span className="text-[10px] text-[color:var(--text-muted)]">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] shadow-xl max-h-56 overflow-auto">
          <button
            type="button"
            onClick={() => {
              onChange('');
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] text-[color:var(--text-muted)] hover:bg-[color:var(--bg-surface)]"
          >
            <span className="inline-flex w-3.5 h-3.5 items-center justify-center">—</span>
            <span>None</span>
          </button>
          {ICON_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)]"
            >
              <span style={color ? { color } : undefined}>
                <MetaIconGlyph icon={opt.value} className="w-3.5 h-3.5" />
              </span>
              <span className="text-[color:var(--text-muted)]">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function IconButton({
  onClick,
  title,
  disabled,
  variant = 'default',
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  variant?: 'default' | 'danger';
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded-md border transition shrink-0 ${
        variant === 'danger'
          ? 'border-transparent text-[color:var(--text-muted)] hover:text-red-400 hover:bg-red-500/10'
          : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)]'
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  );
}

function MilestonesTab({
  projectId,
  milestones,
  setMilestones,
  token,
}: {
  projectId: string;
  milestones: Milestone[];
  setMilestones: (m: Milestone[] | ((prev: Milestone[]) => Milestone[])) => void;
  token: string | null;
}) {
  const [newName, setNewName] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !newName.trim()) return;
    setSaving(true);
    const res = await milestonesApi.create(projectId, { name: newName.trim(), dueDate: newDueDate || undefined }, token);
    setSaving(false);
    if (res.success && res.data) {
      setMilestones((prev) => [...prev, res.data!]);
      setNewName('');
      setNewDueDate('');
    }
  }

  async function handleDelete(m: Milestone) {
    if (!token || !confirm(`Delete milestone "${m.name}"?`)) return;
    const res = await milestonesApi.delete(projectId, m._id, token);
    if (res.success) setMilestones((prev) => prev.filter((x) => x._id !== m._id));
  }

  return (
    <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
      <div className="p-6 border-b border-[color:var(--border-subtle)]">
        <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Milestones</h2>
        <p className="text-[color:var(--text-muted)] text-xs mt-0.5">
          Add milestones to group issues and track progress on the roadmap.
        </p>
      </div>
      <div className="p-6 space-y-6">
        <form onSubmit={handleCreate} className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs text-[color:var(--text-muted)] mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Q1 Release"
              className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-40"
            />
          </div>
          <div>
            <label className="block text-xs text-[color:var(--text-muted)] mb-1">Due date</label>
            <DateInputDDMMYYYY
              value={newDueDate}
              onChange={setNewDueDate}
              allowEmpty
              className="px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-sm w-[11rem]"
            />
          </div>
          <button
            type="submit"
            disabled={saving || !newName.trim()}
            className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs font-medium disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add milestone'}
          </button>
        </form>
        <div>
          {milestones.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] p-8 text-center text-[color:var(--text-muted)] text-xs">
              No milestones yet. Add one above.
            </div>
          ) : (
            <ul className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden divide-y divide-[color:var(--border-subtle)]/70">
              {milestones.map((m) => (
                <li key={m._id} className="flex items-center justify-between px-4 py-3 bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)] group">
                  <span className="font-medium text-[color:var(--text-primary)] text-sm">{m.name}</span>
                  <span className="text-[color:var(--text-muted)] text-xs">
                    {m.dueDate ? formatDateDDMMYYYY(m.dueDate) : '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDelete(m)}
                    className="p-1 rounded text-[color:var(--text-muted)] hover:text-red-500 opacity-0 group-hover:opacity-100"
                    title="Delete"
                  >
                    <FiTrash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ProjectSettings() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [users, setUsers] = useState<{ _id: string; name: string; email: string }[]>([]);
  const [tab, setTab] = useState<TabId>('general');
  const [form, setForm] = useState({ name: '', key: '', description: '', lead: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [statusEdit, setStatusEdit] = useState<ProjectStatus | null>(null);
  const [statusForm, setStatusForm] = useState({ name: '', icon: '', color: '', isClosed: false });

  const [issueTypes, setIssueTypes] = useState<ProjectIssueType[]>([]);
  const [issueTypeEdit, setIssueTypeEdit] = useState<ProjectIssueType | null>(null);
  const [issueTypeForm, setIssueTypeForm] = useState({ name: '', icon: '', color: '' });

  const [priorities, setPriorities] = useState<ProjectPriority[]>([]);
  const [priorityEdit, setPriorityEdit] = useState<ProjectPriority | null>(null);
  const [priorityForm, setPriorityForm] = useState({ name: '', icon: '', color: '' });

  const [customFields, setCustomFields] = useState<ProjectCustomField[]>([]);
  const [customFieldEdit, setCustomFieldEdit] = useState<ProjectCustomField | null>(null);
  const [customFieldForm, setCustomFieldForm] = useState({
    key: '',
    label: '',
    fieldType: 'text' as CustomFieldType,
    required: false,
    options: '',
  });

  const [environments, setEnvironments] = useState<ProjectEnvironment[]>([]);
  const [releaseRules, setReleaseRules] = useState<ProjectReleaseRule[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [environmentEdit, setEnvironmentEdit] = useState<ProjectEnvironment | null>(null);
  const [environmentForm, setEnvironmentForm] = useState({ name: '' });
  const [releaseRuleEdit, setReleaseRuleEdit] = useState<ProjectReleaseRule | null>(null);
  const [releaseRuleForm, setReleaseRuleForm] = useState({
    environmentId: '',
    statusName: '',
    assigneeId: '',
    notifyUserIds: [] as string[],
    notifyChannels: [] as ('email' | 'in_app' | 'third_party')[],
  });
  const [releaseRuleModalOpen, setReleaseRuleModalOpen] = useState(false);

  const [projectPermissions, setProjectPermissions] = useState<string[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [designations, setDesignations] = useState<ProjectDesignation[]>([]);
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteDesignationId, setInviteDesignationId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [cancelLoadingId, setCancelLoadingId] = useState<string | null>(null);
  const [inviteAutocompleteOpen, setInviteAutocompleteOpen] = useState(false);
  const inviteAutocompleteRef = useRef<HTMLDivElement>(null);

  // Designation management
  const [designationEdit, setDesignationEdit] = useState<ProjectDesignation | null>(null);
  const [designationForm, setDesignationForm] = useState({ name: '', permissions: [] as string[] });
  const [designationModalOpen, setDesignationModalOpen] = useState(false);
  const [designationSaving, setDesignationSaving] = useState(false);
  const [designationError, setDesignationError] = useState('');

  // Member update
  const [memberEdit, setMemberEdit] = useState<ProjectMember | null>(null);
  const [memberEditDesignationId, setMemberEditDesignationId] = useState('');
  const [memberSaving, setMemberEditSaving] = useState(false);
  const [memberError, setMemberEditError] = useState('');

  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [saveTemplateDescription, setSaveTemplateDescription] = useState('');
  const [saveTemplateSaving, setSaveTemplateSaving] = useState(false);
  const [saveTemplateError, setSaveTemplateError] = useState('');

  function inferClosedFromStatusName(name: string): boolean {
    const lower = String(name ?? '').trim().toLowerCase();
    return lower === 'done' || lower === 'closed' || lower === 'clossed' || lower === 'resolved' || lower.includes('completed');
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (inviteAutocompleteRef.current && !inviteAutocompleteRef.current.contains(e.target as Node)) {
        setInviteAutocompleteOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!token || !projectId) return;
    setLoading(true);
    projectsApi.get(projectId, token).then((res) => {
      setLoading(false);
      if (res.success && res.data) {
        const p = res.data;
        setProject(p);
        setForm({
          name: p.name,
          key: p.key,
          description: p.description ?? '',
          lead: typeof p.lead === 'object' && p.lead ? p.lead._id : '',
        });
        setStatuses((p.statuses ?? []).map((s) => ({ ...s, isClosed: s.isClosed ?? inferClosedFromStatusName(s.name) })));
        setIssueTypes(p.issueTypes ?? []);
        setPriorities(p.priorities ?? []);
        setCustomFields(p.customFields ?? []);
        setEnvironments(p.environments ?? []);
        setReleaseRules(p.releaseRules ?? []);
      } else setProject(null);
    });
  }, [token, projectId]);

  useEffect(() => {
    if (!token || !projectId) return;
    milestonesApi.list(projectId, token).then((res) => {
      if (res.success && res.data) setMilestones(Array.isArray(res.data) ? res.data : []);
    });
  }, [token, projectId]);

  useEffect(() => {
    if (!projectId || !token) return;
    projectsApi.getMyPermissions(projectId, token).then((res) => {
      if (res.success && res.data && 'permissions' in res.data) {
        setProjectPermissions((res.data as { permissions: string[] }).permissions ?? []);
      } else setProjectPermissions([]);
    });
  }, [projectId, token]);

  useEffect(() => {
    if (!projectId || !token || (tab !== 'members' && tab !== 'designations')) return;
    setMembersLoading(true);
    setInviteError('');
    Promise.all([
      projectsApi.getMembers(projectId, token),
      projectsApi.getInvitations(projectId, token),
      projectsApi.listDesignations(projectId, token),
    ]).then(([membersRes, invitationsRes, designationsRes]) => {
      setMembersLoading(false);
      if (membersRes.success && membersRes.data) setMembers(Array.isArray(membersRes.data) ? membersRes.data : []);
      else setMembers([]);
      if (invitationsRes.success && invitationsRes.data) setInvitations(Array.isArray(invitationsRes.data) ? invitationsRes.data : []);
      else setInvitations([]);
      if (designationsRes.success && designationsRes.data) {
        setDesignations(Array.isArray(designationsRes.data) ? designationsRes.data : []);
        if (designationsRes.data.length > 0 && !inviteDesignationId) {
          const def = designationsRes.data.find(d => d.code === 'project_member');
          setInviteDesignationId(def ? def._id : designationsRes.data[0]._id);
        }
      }
      else setDesignations([]);
    });
  }, [projectId, token, tab]);

  useEffect(() => {
    if (!token) return;
    usersApi.list(1, 100, token).then((res) => {
      if (res.success && res.data) setUsers(res.data.data);
    });
  }, [token]);

  // When modal opens for edit, ensure form is synced from the rule being edited
  useEffect(() => {
    if (releaseRuleModalOpen && releaseRuleEdit) {
      setReleaseRuleForm({
        environmentId: releaseRuleEdit.environmentId,
        statusName: releaseRuleEdit.statusName,
        assigneeId: releaseRuleEdit.assigneeId ?? '',
        notifyUserIds: releaseRuleEdit.notifyUserIds ?? [],
        notifyChannels: releaseRuleEdit.notifyChannels ?? [],
      });
    }
  }, [releaseRuleModalOpen, releaseRuleEdit]);

  function showSaved() {
    setSaved(true);
    const t = setTimeout(() => setSaved(false), 2000);
    return () => clearTimeout(t);
  }

  async function handleSubmitGeneral(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !projectId) return;
    setSaving(true);
    setError('');
    const res = await projectsApi.update(
      projectId,
      { name: form.name, key: form.key.toUpperCase(), description: form.description || undefined, lead: form.lead },
      token
    );
    setSaving(false);
    if (res.success && res.data) {
      setProject(res.data);
      showSaved();
    } else setError((res as { message?: string }).message ?? 'Update failed');
  }

  async function saveStatuses() {
    if (!token || !projectId) return;
    setSaving(true);
    setError('');
    const normalizedStatuses = statuses.map((s) => ({ ...s, isClosed: s.isClosed ?? inferClosedFromStatusName(s.name) }));
    const res = await projectsApi.update(projectId, { statuses: normalizedStatuses }, token);
    setSaving(false);
    if (res.success && res.data) {
      setProject(res.data);
      setStatuses(res.data.statuses ?? []);
      setStatusEdit(null);
      setStatusForm({ name: '', icon: '', color: '', isClosed: false });
      showSaved();
    } else setError((res as { message?: string }).message ?? 'Save failed');
  }

  async function saveIssueTypes() {
    if (!token || !projectId) return;
    setSaving(true);
    setError('');
    const res = await projectsApi.update(projectId, { issueTypes }, token);
    setSaving(false);
    if (res.success && res.data) {
      setProject(res.data);
      setIssueTypes(res.data.issueTypes ?? []);
      setIssueTypeEdit(null);
      setIssueTypeForm({ name: '', icon: '', color: '' });
      showSaved();
    } else setError((res as { message?: string }).message ?? 'Save failed');
  }

  async function saveCustomFields() {
    if (!token || !projectId) return;
    setSaving(true);
    setError('');
    const res = await projectsApi.update(projectId, { customFields }, token);
    setSaving(false);
    if (res.success && res.data) {
      setProject(res.data);
      setCustomFields(res.data.customFields ?? []);
      setCustomFieldEdit(null);
      setCustomFieldForm({ key: '', label: '', fieldType: 'text', required: false, options: '' });
      showSaved();
    } else setError((res as { message?: string }).message ?? 'Save failed');
  }

  function addStatus() {
    const name = statusForm.name.trim();
    if (!name) return;
    setStatuses((prev) => [...prev, { id: generateId(), name, order: prev.length, isClosed: statusForm.isClosed, icon: statusForm.icon || undefined, color: statusForm.color || undefined }]);
    setStatusForm({ name: '', icon: '', color: '', isClosed: false });
  }
  function updateStatusItem() {
    if (!statusEdit) return;
    const name = statusForm.name.trim();
    if (!name) return;
    setStatuses((prev) => prev.map((s) => (s.id === statusEdit.id ? { ...s, name, isClosed: statusForm.isClosed, icon: statusForm.icon || undefined, color: statusForm.color || undefined } : s)));
    setStatusEdit(null);
    setStatusForm({ name: '', icon: '', color: '', isClosed: false });
  }
  function removeStatus(id: string) {
    setStatuses((prev) => prev.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })));
  }
  function moveStatus(id: string, dir: 1 | -1) {
    setStatuses((prev) => {
      const i = prev.findIndex((s) => s.id === id);
      if (i === -1 || (dir === -1 && i === 0) || (dir === 1 && i === prev.length - 1)) return prev;
      const next = [...prev];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next.map((s, idx) => ({ ...s, order: idx }));
    });
  }

  function addIssueType() {
    const name = issueTypeForm.name.trim();
    if (!name) return;
    setIssueTypes((prev) => [...prev, { id: generateId(), name, order: prev.length, icon: issueTypeForm.icon || undefined, color: issueTypeForm.color || undefined }]);
    setIssueTypeForm({ name: '', icon: '', color: '' });
  }
  function updateIssueTypeItem() {
    if (!issueTypeEdit) return;
    const name = issueTypeForm.name.trim();
    if (!name) return;
    setIssueTypes((prev) => prev.map((t) => (t.id === issueTypeEdit.id ? { ...t, name, icon: issueTypeForm.icon || undefined, color: issueTypeForm.color || undefined } : t)));
    setIssueTypeEdit(null);
    setIssueTypeForm({ name: '', icon: '', color: '' });
  }
  function removeIssueType(id: string) {
    setIssueTypes((prev) => prev.filter((t) => t.id !== id).map((t, i) => ({ ...t, order: i })));
  }
  function moveIssueType(id: string, dir: 1 | -1) {
    setIssueTypes((prev) => {
      const i = prev.findIndex((t) => t.id === id);
      if (i === -1 || (dir === -1 && i === 0) || (dir === 1 && i === prev.length - 1)) return prev;
      const next = [...prev];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next.map((t, idx) => ({ ...t, order: idx }));
    });
  }

  function addPriority() {
    const name = priorityForm.name.trim();
    if (!name) return;
    setPriorities((prev) => [...prev, { id: generateId(), name, order: prev.length, icon: priorityForm.icon || undefined, color: priorityForm.color || undefined }]);
    setPriorityForm({ name: '', icon: '', color: '' });
  }
  function updatePriorityItem() {
    if (!priorityEdit) return;
    const name = priorityForm.name.trim();
    if (!name) return;
    setPriorities((prev) => prev.map((p) => (p.id === priorityEdit.id ? { ...p, name, icon: priorityForm.icon || undefined, color: priorityForm.color || undefined } : p)));
    setPriorityEdit(null);
    setPriorityForm({ name: '', icon: '', color: '' });
  }
  function removePriority(id: string) {
    setPriorities((prev) => prev.filter((p) => p.id !== id).map((p, i) => ({ ...p, order: i })));
  }
  function movePriority(id: string, dir: 1 | -1) {
    setPriorities((prev) => {
      const i = prev.findIndex((p) => p.id === id);
      if (i === -1 || (dir === -1 && i === 0) || (dir === 1 && i === prev.length - 1)) return prev;
      const next = [...prev];
      [next[i], next[i + dir]] = [next[i + dir], next[i]];
      return next.map((p, idx) => ({ ...p, order: idx }));
    });
  }
  async function savePriorities() {
    if (!token || !projectId) return;
    setSaving(true);
    setError('');
    const res = await projectsApi.update(projectId, { priorities }, token);
    setSaving(false);
    if (res.success && res.data) {
      setProject(res.data);
      setPriorities(res.data.priorities ?? []);
      setPriorityEdit(null);
      setPriorityForm({ name: '', icon: '', color: '' });
      showSaved();
    } else setError((res as { message?: string }).message ?? 'Save failed');
  }

  function addCustomField() {
    const key = customFieldForm.key.trim().replace(/\s+/g, '_').replace(/^[^a-zA-Z]/, 'f_');
    const label = customFieldForm.label.trim() || key;
    if (!key) return;
    const options =
      customFieldForm.fieldType === 'select' || customFieldForm.fieldType === 'multiselect'
        ? customFieldForm.options.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
        : undefined;
    const exists = customFields.some((f) => f.key.toLowerCase() === key.toLowerCase());
    if (exists) {
      setError(`Key "${key}" already exists`);
      return;
    }
    setError('');
    setCustomFields((prev) => [
      ...prev,
      { id: generateId(), key, label, fieldType: customFieldForm.fieldType, required: customFieldForm.required, options, order: prev.length },
    ]);
    setCustomFieldForm({ key: '', label: '', fieldType: 'text', required: false, options: '' });
  }
  function updateCustomFieldItem() {
    if (!customFieldEdit) return;
    const key = customFieldForm.key.trim().replace(/\s+/g, '_').replace(/^[^a-zA-Z]/, 'f_');
    const label = customFieldForm.label.trim() || key;
    if (!key) return;
    const options =
      customFieldForm.fieldType === 'select' || customFieldForm.fieldType === 'multiselect'
        ? customFieldForm.options.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
        : undefined;
    setCustomFields((prev) =>
      prev.map((f) =>
        f.id === customFieldEdit.id ? { ...f, key, label, fieldType: customFieldForm.fieldType, required: customFieldForm.required, options } : f
      )
    );
    setCustomFieldEdit(null);
    setCustomFieldForm({ key: '', label: '', fieldType: 'text', required: false, options: '' });
    setError('');
  }
  function removeCustomField(id: string) {
    setCustomFields((prev) => prev.filter((f) => f.id !== id).map((f, i) => ({ ...f, order: i })));
  }

  function addEnvironment() {
    const name = environmentForm.name.trim();
    if (!name) return;
    const next = [...environments, { id: generateId(), name, order: environments.length }];
    setEnvironments(next);
    setEnvironmentForm({ name: '' });
    setEnvironmentEdit(null);
    saveEnvironments(next);
  }
  function updateEnvironmentItem() {
    if (!environmentEdit) return;
    const name = environmentForm.name.trim();
    if (!name) return;
    const next = environments.map((e) => (e.id === environmentEdit.id ? { ...e, name } : e));
    setEnvironments(next);
    setEnvironmentEdit(null);
    setEnvironmentForm({ name: '' });
    saveEnvironments(next);
  }
  function removeEnvironment(envId: string) {
    const next = environments.filter((e) => e.id !== envId).map((e, i) => ({ ...e, order: i }));
    const nextRules = releaseRules.filter((r) => r.environmentId !== envId);
    setEnvironments(next);
    setReleaseRules(nextRules);
    if (environmentEdit?.id === envId) {
      setEnvironmentEdit(null);
      setEnvironmentForm({ name: '' });
    }
    if (!token || !projectId) return;
    setSaving(true);
    setError('');
    projectsApi.update(projectId, { environments: next, releaseRules: nextRules }, token).then((res) => {
      setSaving(false);
      if (res.success && res.data) {
        setProject(res.data);
        setEnvironments(res.data.environments ?? []);
        setReleaseRules(res.data.releaseRules ?? []);
        showSaved();
      } else setError((res as { message?: string }).message ?? 'Save failed');
    });
  }

  function addReleaseRule() {
    const { environmentId, statusName, assigneeId, notifyUserIds, notifyChannels } = releaseRuleForm;
    if (!environmentId || !statusName) return;
    if (releaseRules.some((r) => r.environmentId === environmentId)) {
      setError('A rule for this environment already exists. Edit or delete it first.');
      return;
    }
    setError('');
    const next: ProjectReleaseRule[] = [
      ...releaseRules,
      {
        environmentId,
        statusName,
        assigneeId: assigneeId || undefined,
        notifyUserIds: notifyUserIds.length > 0 ? notifyUserIds : undefined,
        notifyChannels: notifyChannels.length > 0 ? notifyChannels : undefined,
      },
    ];
    setReleaseRules(next);
    setReleaseRuleForm({ environmentId: '', statusName: '', assigneeId: '', notifyUserIds: [], notifyChannels: [] });
    setReleaseRuleEdit(null);
    setReleaseRuleModalOpen(false);
    saveReleaseRules(next);
  }
  function updateReleaseRuleItem() {
    if (!releaseRuleEdit) return;
    const { environmentId, statusName, assigneeId, notifyUserIds, notifyChannels } = releaseRuleForm;
    if (!environmentId || !statusName) return;
    const next: ProjectReleaseRule[] = releaseRules.map((r) =>
      r.environmentId === releaseRuleEdit.environmentId
        ? {
            environmentId,
            statusName,
            assigneeId: assigneeId || undefined,
            notifyUserIds: notifyUserIds.length > 0 ? notifyUserIds : undefined,
            notifyChannels: notifyChannels.length > 0 ? notifyChannels : undefined,
          }
        : r
    );
    setReleaseRules(next);
    setReleaseRuleEdit(null);
    setReleaseRuleForm({ environmentId: '', statusName: '', assigneeId: '', notifyUserIds: [], notifyChannels: [] });
    setError('');
    setReleaseRuleModalOpen(false);
    saveReleaseRules(next);
  }
  function removeReleaseRule(environmentId: string) {
    const next = releaseRules.filter((r) => r.environmentId !== environmentId);
    setReleaseRules(next);
    if (releaseRuleEdit?.environmentId === environmentId) {
      setReleaseRuleEdit(null);
      setReleaseRuleForm({ environmentId: '', statusName: '', assigneeId: '', notifyUserIds: [], notifyChannels: [] });
      setReleaseRuleModalOpen(false);
    }
    saveReleaseRules(next);
  }
  function openReleaseRuleModal() {
    setReleaseRuleEdit(null);
    setReleaseRuleForm({ environmentId: '', statusName: '', assigneeId: '', notifyUserIds: [], notifyChannels: [] });
    setError('');
    setReleaseRuleModalOpen(true);
  }
  function closeReleaseRuleModal() {
    setReleaseRuleModalOpen(false);
    setReleaseRuleEdit(null);
    setReleaseRuleForm({ environmentId: '', statusName: '', assigneeId: '', notifyUserIds: [], notifyChannels: [] });
    setError('');
  }
  function toggleNotifyChannel(ch: 'email' | 'in_app' | 'third_party') {
    setReleaseRuleForm((f) => ({
      ...f,
      notifyChannels: f.notifyChannels.includes(ch) ? f.notifyChannels.filter((c) => c !== ch) : [...f.notifyChannels, ch],
    }));
  }
  function toggleNotifyUser(userId: string) {
    setReleaseRuleForm((f) => ({
      ...f,
      notifyUserIds: f.notifyUserIds.includes(userId) ? f.notifyUserIds.filter((id) => id !== userId) : [...f.notifyUserIds, userId],
    }));
  }

  async function saveEnvironments(next?: ProjectEnvironment[]) {
    const toSave = next ?? environments;
    if (!token || !projectId) return;
    setSaving(true);
    setError('');
    const res = await projectsApi.update(projectId, { environments: toSave }, token);
    setSaving(false);
    if (res.success && res.data) {
      setProject(res.data);
      setEnvironments(res.data.environments ?? []);
      setEnvironmentEdit(null);
      setEnvironmentForm({ name: '' });
      showSaved();
    } else setError((res as { message?: string }).message ?? 'Save failed');
  }
  async function saveReleaseRules(next?: ProjectReleaseRule[]) {
    const toSave = next ?? releaseRules;
    if (!token || !projectId) return;
    setSaving(true);
    setError('');
    const res = await projectsApi.update(projectId, { releaseRules: toSave }, token);
    setSaving(false);
    if (res.success && res.data) {
      setProject(res.data);
      setReleaseRules(res.data.releaseRules ?? []);
      setReleaseRuleEdit(null);
      setReleaseRuleForm({ environmentId: '', statusName: '', assigneeId: '', notifyUserIds: [], notifyChannels: [] });
      showSaved();
    } else setError((res as { message?: string }).message ?? 'Save failed');
  }

  async function handleInviteMember(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !projectId || !inviteEmail.trim()) return;
    setInviting(true);
    setInviteError('');
    const res = await projectsApi.inviteMember(projectId, { email: inviteEmail.trim(), designationId: inviteDesignationId || undefined }, token);
    setInviting(false);
    if (res.success) {
      setInviteEmail('');
      const [membersRes, invitationsRes] = await Promise.all([
        projectsApi.getMembers(projectId, token),
        projectsApi.getInvitations(projectId, token),
      ]);
      if (membersRes.success && membersRes.data) setMembers(Array.isArray(membersRes.data) ? membersRes.data : []);
      if (invitationsRes.success && invitationsRes.data) setInvitations(Array.isArray(invitationsRes.data) ? invitationsRes.data : []);
    } else setInviteError((res as { message?: string }).message ?? 'Invite failed');
  }

  async function handleUpdateMember() {
    if (!token || !projectId || !memberEdit) return;
    setMemberEditSaving(true);
    setMemberEditError('');
    const res = await projectsApi.updateMember(projectId, memberEdit._id, { designationId: memberEditDesignationId }, token);
    setMemberEditSaving(false);
    if (res.success) {
      setMemberEdit(null);
      const membersRes = await projectsApi.getMembers(projectId, token);
      if (membersRes.success && membersRes.data) setMembers(membersRes.data);
    } else setMemberEditError((res as { message?: string }).message ?? 'Update failed');
  }

  async function handleRemoveMember(memberId: string) {
    if (!token || !projectId) return;
    const res = await projectsApi.removeMember(projectId, memberId, token);
    if (res.success) {
      const membersRes = await projectsApi.getMembers(projectId, token);
      if (membersRes.success && membersRes.data) setMembers(membersRes.data);
    }
  }

  async function saveDesignation() {
    if (!token || !projectId) return;
    setDesignationSaving(true);
    setDesignationError('');
    const res = designationEdit
      ? await projectsApi.updateDesignation(projectId, designationEdit._id, designationForm, token)
      : await projectsApi.createDesignation(projectId, designationForm, token);
    setDesignationSaving(false);
    if (res.success) {
      setDesignationModalOpen(false);
      setDesignationEdit(null);
      const desigRes = await projectsApi.listDesignations(projectId, token);
      if (desigRes.success && desigRes.data) setDesignations(desigRes.data);
    } else setDesignationError((res as { message?: string }).message ?? 'Save failed');
  }

  async function removeDesignation(id: string) {
    if (!token || !projectId) return;
    const res = await projectsApi.deleteDesignation(projectId, id, token);
    if (res.success) {
      const desigRes = await projectsApi.listDesignations(projectId, token);
      if (desigRes.success && desigRes.data) setDesignations(desigRes.data);
      // Refresh members as some might have been reassigned
      const membersRes = await projectsApi.getMembers(projectId, token);
      if (membersRes.success && membersRes.data) setMembers(membersRes.data);
    }
  }

  async function handleCancelInvitation(invitationId: string) {
    if (!token || !projectId) return;
    setCancelLoadingId(invitationId);
    const res = await projectsApi.cancelInvitation(projectId, invitationId, token);
    setCancelLoadingId(null);
    if (res.success) {
      const invitationsRes = await projectsApi.getInvitations(projectId, token);
      if (invitationsRes.success && invitationsRes.data) setInvitations(Array.isArray(invitationsRes.data) ? invitationsRes.data : []);
    }
  }

  async function handleSaveAsTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !projectId || !saveTemplateName.trim()) return;
    setSaveTemplateSaving(true);
    setSaveTemplateError('');
    const res = await projectsApi.saveSettingsTemplate(
      projectId,
      { name: saveTemplateName.trim(), description: saveTemplateDescription.trim() || undefined },
      token
    );
    setSaveTemplateSaving(false);
    if (res.success) {
      setSaveTemplateOpen(false);
      setSaveTemplateName('');
      setSaveTemplateDescription('');
    } else setSaveTemplateError(res.message ?? 'Failed to save template');
  }

  if (!projectId) return null;

  if (loading) {
    return (
      <div className="min-h-screen bg-[color:var(--bg-page)]">
        <div className="p-6 lg:p-10 max-w-6xl mx-auto">
          <div className="h-6 w-40 bg-[color:var(--bg-surface)] rounded-lg animate-pulse mb-6" />
          <div className="flex gap-8">
            <div className="w-56 h-64 bg-[color:var(--bg-surface)] rounded-2xl animate-pulse" />
            <div className="flex-1 h-64 bg-[color:var(--bg-surface)] rounded-2xl animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-[color:var(--bg-page)] flex items-center justify-center p-8">
        <div className="text-center">
          <p className="text-[color:var(--text-muted)] text-sm">Project not found.</p>
          <Link to="/projects" className="mt-4 inline-block text-xs text-[color:var(--text-primary)] hover:underline">
            ← Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const inputClass =
    'w-full px-3 py-1.5 rounded-md bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-xs placeholder-[color:var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent)]/40 transition';
  const labelClass = 'block text-xs font-medium text-[color:var(--text-primary)] mb-1.5';

  return (
    <div className="min-h-screen bg-[color:var(--bg-page)]">
      <div className="p-6 lg:p-10 max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link
            to={`/projects/${projectId}/dashboard`}
            className="inline-flex items-center gap-2 text-xs text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] font-medium mb-4 transition"
          >
            <span>←</span> Back to project
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-xl lg:text-2xl font-semibold text-[color:var(--text-primary)] tracking-tight">Project settings</h1>
              <p className="text-[color:var(--text-muted)] text-sm mt-1">Manage how this project works for your team.</p>
              {userHasPermission(projectPermissions, PROJECT_PERMISSIONS.SETTING.PROJECT_SETTING.UPDATE) && (
                <div className="flex flex-wrap items-center gap-3 mt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setSaveTemplateOpen(true);
                      setSaveTemplateError('');
                      setSaveTemplateName(`${project.name} workflow`);
                      setSaveTemplateDescription('');
                    }}
                    className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] text-xs font-medium text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] transition"
                  >
                    Save workflow as template
                  </button>
                  <Link
                    to="/project-templates"
                    className="text-xs text-[color:var(--accent)] hover:underline font-medium"
                  >
                    View all templates
                  </Link>
                </div>
              )}
            </div>
            {saved && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/15 text-emerald-400 text-sm font-medium border border-emerald-500/30">
                <span>✓</span> Saved
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar nav */}
          <nav className="lg:w-56 shrink-0">
            <div className="flex lg:flex-col gap-1 p-1 rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-x-auto lg:overflow-visible">
              {TABS.filter(
                (t) =>
                  t.id !== 'members' ||
                  userHasPermission(projectPermissions, PROJECT_PERMISSIONS.MEMBER.INVITATIONS_MANAGE)
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setTab(t.id); setError(''); }}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl text-left transition whitespace-nowrap ${
                    tab === t.id
                      ? 'bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] border border-[color:var(--border-subtle)]'
                      : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)]'
                  }`}
                >
                  <div>
                    <div className="font-medium text-sm">{t.label}</div>
                    <div className="text-[11px] text-[color:var(--text-muted)]">{t.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </nav>

          {/* Content */}
          <main className="flex-1 min-w-0">
            {error && (
              <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                {error}
              </div>
            )}

            {tab === 'general' && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
                <div className="p-6 border-b border-[color:var(--border-subtle)]">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">General</h2>
                  <p className="text-[color:var(--text-muted)] text-xs mt-0.5">Basic project identity and ownership.</p>
                </div>
                <form onSubmit={handleSubmitGeneral} className="p-6 space-y-4">
                  <div>
                    <label className={labelClass}>Project name</label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      required
                      placeholder="e.g. Super 20"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Key</label>
                    <input
                      type="text"
                      value={form.key}
                      onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase() }))}
                      required
                      maxLength={10}
                      placeholder="e.g. S20"
                      className={`${inputClass} font-mono uppercase`}
                    />
                    <p className="text-[color:var(--text-muted)] text-[11px] mt-1">Short code used in ticket IDs (e.g. S20-1).</p>
                  </div>
                  <div>
                    <label className={labelClass}>Description</label>
                    <textarea
                      value={form.description}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      rows={3}
                      placeholder="What is this project about?"
                      className={`${inputClass} resize-y`}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Project lead</label>
                    <select
                      value={form.lead}
                      onChange={(e) => setForm((f) => ({ ...f, lead: e.target.value }))}
                      className={inputClass}
                    >
                      {users.map((u) => (
                        <option key={u._id} value={u._id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-3 pt-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-4 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)] disabled:opacity-50 transition"
                    >
                      {saving ? 'Saving…' : 'Save changes'}
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/projects/${projectId}/dashboard`)}
                      className="px-4 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)] font-medium hover:bg-[color:var(--bg-page)] transition"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {tab === 'statuses' && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
                <div className="p-6 border-b border-[color:var(--border-subtle)]">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Statuses</h2>
                  <p className="text-[color:var(--text-muted)] text-xs mt-0.5">Workflow states for issues (e.g. Backlog → Done). Reorder to match your process.</p>
                </div>
                <div className="p-6 space-y-6">
                    <div className="flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[200px]">
                      <label className={labelClass}>Add or edit status</label>
                      <input
                        type="text"
                        value={statusForm.name}
                        onChange={(e) => setStatusForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. In review"
                        className={inputClass}
                        onKeyDown={(e) => e.key === 'Enter' && (statusEdit ? updateStatusItem() : addStatus())}
                      />
                    </div>
                    <div className="w-32">
                      <label className={labelClass}>Icon</label>
                      <IconSelect
                        value={statusForm.icon as MetaIconKey | ''}
                        onChange={(val) => setStatusForm((f) => ({ ...f, icon: val }))}
                        color={statusForm.color || undefined}
                      />
                    </div>
                    <div className="w-36">
                      <label className={labelClass}>Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={statusForm.color || '#ffffff'}
                          onChange={(e) => setStatusForm((f) => ({ ...f, color: e.target.value }))}
                          className="h-8 w-8 rounded-md border border-[color:var(--border-subtle)] bg-transparent cursor-pointer"
                        />
                        <input
                          type="text"
                          value={statusForm.color}
                          onChange={(e) => setStatusForm((f) => ({ ...f, color: e.target.value }))}
                          placeholder="#ffffff"
                          className={`${inputClass} w-28`}
                        />
                      </div>
                    </div>
                    <div className="w-44">
                      <label className={labelClass}>Issue state</label>
                      <select
                        value={statusForm.isClosed ? 'closed' : 'open'}
                        onChange={(e) => setStatusForm((f) => ({ ...f, isClosed: e.target.value === 'closed' }))}
                        className={inputClass}
                      >
                        <option value="open">Open</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>
                    {statusEdit ? (
                      <>
                        <button type="button" onClick={updateStatusItem} className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)]">
                          Update
                        </button>
                        <button type="button" onClick={() => { setStatusEdit(null); setStatusForm({ name: '', icon: '', color: '', isClosed: false }); }} className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)]">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={addStatus} className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)]">
                        Add status
                      </button>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-[color:var(--text-muted)]">Current statuses</span>
                      {statuses.length > 0 && (
                        <span className="text-xs text-[color:var(--text-muted)]">{statuses.length} status{statuses.length !== 1 ? 'es' : ''}</span>
                      )}
                    </div>
                    {statuses.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-8 text-center text-[color:var(--text-muted)] text-xs">
                        No statuses yet. Add one above to get started.
                      </div>
                    ) : (
                      <ul className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden divide-y divide-[color:var(--border-subtle)]/70">
                        {statuses.map((s, idx) => (
                          <li key={s.id} className="flex items-center justify-between gap-2 px-4 py-3 bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)] transition group">
                            <span className="flex items-center gap-2">
                              {s.icon && (
                                <span style={s.color ? { color: s.color } : undefined}>
                                  <MetaIconGlyph icon={s.icon} className="w-3.5 h-3.5" />
                                </span>
                              )}
                              {s.color && <span className="w-4 h-4 rounded border border-[color:var(--border-subtle)] shrink-0" style={{ backgroundColor: s.color }} />}
                              <span className="font-medium text-[color:var(--text-primary)] text-sm">{s.name}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] border ${s.isClosed ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' : 'text-sky-300 border-sky-500/40 bg-sky-500/10'}`}>
                                {s.isClosed ? 'Closed' : 'Open'}
                              </span>
                            </span>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                              <IconButton title="Move up" onClick={() => moveStatus(s.id, -1)} disabled={idx === 0}>
                                ↑
                              </IconButton>
                              <IconButton
                                title="Move down"
                                onClick={() => moveStatus(s.id, 1)}
                                disabled={idx === statuses.length - 1}
                              >
                                ↓
                              </IconButton>
                              <IconButton
                                title="Edit"
                                onClick={() => {
                                  setStatusEdit(s);
                                  setStatusForm({ name: s.name, icon: s.icon ?? '', color: s.color ?? '', isClosed: Boolean(s.isClosed) });
                                }}
                              >
                                <EditIcon className="w-3.5 h-3.5" />
                              </IconButton>
                              <IconButton title="Delete" variant="danger" onClick={() => removeStatus(s.id)}>
                                <TrashIcon className="w-3.5 h-3.5" />
                              </IconButton>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={saveStatuses}
                    disabled={saving || statuses.length === 0}
                    className="px-4 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)] disabled:opacity-50 transition"
                  >
                    {saving ? 'Saving…' : 'Save statuses'}
                  </button>
                </div>
              </div>
            )}

            {tab === 'issueTypes' && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
                <div className="p-6 border-b border-[color:var(--border-subtle)]">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Issue types</h2>
                  <p className="text-[color:var(--text-muted)] text-xs mt-0.5">Types of work (Task, Bug, Story, Epic). Customize to match your team.</p>
                </div>
                <div className="p-6 space-y-6">
                  <div className="flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[200px]">
                      <label className={labelClass}>Add or edit issue type</label>
                      <input
                        type="text"
                        value={issueTypeForm.name}
                        onChange={(e) => setIssueTypeForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Spike"
                        className={inputClass}
                        onKeyDown={(e) => e.key === 'Enter' && (issueTypeEdit ? updateIssueTypeItem() : addIssueType())}
                      />
                    </div>
                    <div className="w-32">
                      <label className={labelClass}>Icon</label>
                      <IconSelect
                        value={issueTypeForm.icon as MetaIconKey | ''}
                        onChange={(val) => setIssueTypeForm((f) => ({ ...f, icon: val }))}
                        color={issueTypeForm.color || undefined}
                      />
                    </div>
                    <div className="w-36">
                      <label className={labelClass}>Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={issueTypeForm.color || '#ffffff'}
                          onChange={(e) => setIssueTypeForm((f) => ({ ...f, color: e.target.value }))}
                          className="h-8 w-8 rounded-md border border-[color:var(--border-subtle)] bg-transparent cursor-pointer"
                        />
                        <input
                          type="text"
                          value={issueTypeForm.color}
                          onChange={(e) => setIssueTypeForm((f) => ({ ...f, color: e.target.value }))}
                          placeholder="#ffffff"
                          className={`${inputClass} w-28`}
                        />
                      </div>
                    </div>
                    {issueTypeEdit ? (
                      <>
                        <button
                          type="button"
                          onClick={updateIssueTypeItem}
                          className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)]"
                        >
                          Update
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIssueTypeEdit(null);
                            setIssueTypeForm({ name: '', icon: '', color: '' });
                          }}
                          className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)]"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={addIssueType}
                        className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)]"
                      >
                        Add type
                      </button>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-[color:var(--text-muted)]">Current types</span>
                      {issueTypes.length > 0 && (
                        <span className="text-xs text-[color:var(--text-muted)]">
                          {issueTypes.length} type{issueTypes.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {issueTypes.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-8 text-center text-[color:var(--text-muted)] text-xs">
                        No issue types yet. Add one above.
                      </div>
                    ) : (
                      <ul className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden divide-y divide-[color:var(--border-subtle)]/70">
                        {issueTypes.map((t, idx) => (
                          <li
                            key={t.id}
                            className="flex items-center justify-between gap-2 px-4 py-3 bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)] transition group"
                          >
                            <span className="flex items-center gap-2">
                              {t.icon && (
                                <span style={t.color ? { color: t.color } : undefined}>
                                  <MetaIconGlyph icon={t.icon} className="w-3.5 h-3.5" />
                                </span>
                              )}
                              {t.color && (
                                <span
                                  className="w-4 h-4 rounded border border-[color:var(--border-subtle)] shrink-0"
                                  style={{ backgroundColor: t.color }}
                                />
                              )}
                              <span className="font-medium text-[color:var(--text-primary)] text-sm">{t.name}</span>
                            </span>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                              <IconButton title="Move up" onClick={() => moveIssueType(t.id, -1)} disabled={idx === 0}>
                                ↑
                              </IconButton>
                              <IconButton
                                title="Move down"
                                onClick={() => moveIssueType(t.id, 1)}
                                disabled={idx === issueTypes.length - 1}
                              >
                                ↓
                              </IconButton>
                              <IconButton
                                title="Edit"
                                onClick={() => {
                                  setIssueTypeEdit(t);
                                  setIssueTypeForm({ name: t.name, icon: t.icon ?? '', color: t.color ?? '' });
                                }}
                              >
                                <EditIcon className="w-3.5 h-3.5" />
                              </IconButton>
                              <IconButton title="Delete" variant="danger" onClick={() => removeIssueType(t.id)}>
                                <TrashIcon className="w-3.5 h-3.5" />
                              </IconButton>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={saveIssueTypes}
                    disabled={saving || issueTypes.length === 0}
                    className="px-4 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)] disabled:opacity-50 transition"
                  >
                    {saving ? 'Saving…' : 'Save issue types'}
                  </button>
                </div>
              </div>
            )}

            {tab === 'priorities' && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
                <div className="p-6 border-b border-[color:var(--border-subtle)]">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Priorities</h2>
                  <p className="text-[color:var(--text-muted)] text-xs mt-0.5">Priority levels for issues (e.g. Low, Medium, High). Choose icon and color for each.</p>
                </div>
                <div className="p-6 space-y-6">
                  <div className="flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[200px]">
                      <label className={labelClass}>Add or edit priority</label>
                      <input
                        type="text"
                        value={priorityForm.name}
                        onChange={(e) => setPriorityForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Critical"
                        className={inputClass}
                        onKeyDown={(e) => e.key === 'Enter' && (priorityEdit ? updatePriorityItem() : addPriority())}
                      />
                    </div>
                    <div className="w-32">
                      <label className={labelClass}>Icon</label>
                      <IconSelect
                        value={priorityForm.icon as MetaIconKey | ''}
                        onChange={(val) => setPriorityForm((f) => ({ ...f, icon: val }))}
                        color={priorityForm.color || undefined}
                      />
                    </div>
                    <div className="w-36">
                      <label className={labelClass}>Color</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={priorityForm.color || '#ffffff'}
                          onChange={(e) => setPriorityForm((f) => ({ ...f, color: e.target.value }))}
                          className="h-8 w-8 rounded-md border border-[color:var(--border-subtle)] bg-transparent cursor-pointer"
                        />
                        <input
                          type="text"
                          value={priorityForm.color}
                          onChange={(e) => setPriorityForm((f) => ({ ...f, color: e.target.value }))}
                          placeholder="#ffffff"
                          className={`${inputClass} w-28`}
                        />
                      </div>
                    </div>
                    {priorityEdit ? (
                      <>
                        <button
                          type="button"
                          onClick={updatePriorityItem}
                          className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)]"
                        >
                          Update
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPriorityEdit(null);
                            setPriorityForm({ name: '', icon: '', color: '' });
                          }}
                          className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)]"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={addPriority}
                        className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)]"
                      >
                        Add priority
                      </button>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-[color:var(--text-muted)]">Current priorities</span>
                      {priorities.length > 0 && (
                        <span className="text-xs text-[color:var(--text-muted)]">
                          {priorities.length} priorit{priorities.length !== 1 ? 'ies' : 'y'}
                        </span>
                      )}
                    </div>
                    {priorities.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-8 text-center text-[color:var(--text-muted)] text-xs">
                        No priorities yet. Add one above. Defaults (Lowest, Low, Medium, High, Highest) are used until you configure these.
                      </div>
                    ) : (
                      <ul className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden divide-y divide-[color:var(--border-subtle)]/70">
                        {priorities.map((p, idx) => (
                          <li
                            key={p.id}
                            className="flex items-center justify-between gap-2 px-4 py-3 bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)] transition group"
                          >
                            <span className="flex items-center gap-2">
                              {p.icon && (
                                <span style={p.color ? { color: p.color } : undefined}>
                                  <MetaIconGlyph icon={p.icon} className="w-3.5 h-3.5" />
                                </span>
                              )}
                              {p.color && (
                                <span
                                  className="w-4 h-4 rounded border border-[color:var(--border-subtle)] shrink-0"
                                  style={{ backgroundColor: p.color }}
                                />
                              )}
                              <span className="font-medium text-[color:var(--text-primary)] text-sm">{p.name}</span>
                            </span>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                              <IconButton title="Move up" onClick={() => movePriority(p.id, -1)} disabled={idx === 0}>
                                ↑
                              </IconButton>
                              <IconButton
                                title="Move down"
                                onClick={() => movePriority(p.id, 1)}
                                disabled={idx === priorities.length - 1}
                              >
                                ↓
                              </IconButton>
                              <IconButton
                                title="Edit"
                                onClick={() => {
                                  setPriorityEdit(p);
                                  setPriorityForm({ name: p.name, icon: p.icon ?? '', color: p.color ?? '' });
                                }}
                              >
                                <EditIcon className="w-3.5 h-3.5" />
                              </IconButton>
                              <IconButton title="Delete" variant="danger" onClick={() => removePriority(p.id)}>
                                <TrashIcon className="w-3.5 h-3.5" />
                              </IconButton>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={savePriorities}
                    disabled={saving || priorities.length === 0}
                    className="px-4 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)] disabled:opacity-50 transition"
                  >
                    {saving ? 'Saving…' : 'Save priorities'}
                  </button>
                </div>
              </div>
            )}

            {tab === 'customFields' && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
                <div className="p-6 border-b border-[color:var(--border-subtle)]">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Custom fields</h2>
                  <p className="text-[color:var(--text-muted)] text-xs mt-0.5">
                    Add extra columns to issues (e.g. story points, component). Key must be unique and start with a letter.
                  </p>
                </div>
                <div className="p-6 space-y-6">
                  <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5 space-y-4">
                    <h3 className="text-sm font-medium text-[color:var(--text-primary)]">
                      {customFieldEdit ? 'Edit field' : 'New field'}
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className={labelClass}>Key</label>
                        <input
                          type="text"
                          value={customFieldForm.key}
                          onChange={(e) => setCustomFieldForm((f) => ({ ...f, key: e.target.value }))}
                          placeholder="e.g. story_points"
                          className={`${inputClass} font-mono text-sm`}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Label</label>
                        <input
                          type="text"
                          value={customFieldForm.label}
                          onChange={(e) => setCustomFieldForm((f) => ({ ...f, label: e.target.value }))}
                          placeholder="e.g. Story points"
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-6 items-center">
                      <div>
                        <label className={labelClass}>Type</label>
                        <select
                          value={customFieldForm.fieldType}
                          onChange={(e) => setCustomFieldForm((f) => ({ ...f, fieldType: e.target.value as CustomFieldType }))}
                          className={inputClass}
                        >
                          {CUSTOM_FIELD_TYPES.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer mt-6">
                        <input
                          type="checkbox"
                          checked={customFieldForm.required}
                          onChange={(e) => setCustomFieldForm((f) => ({ ...f, required: e.target.checked }))}
                          className="rounded border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-[color:var(--accent)] focus:ring-[color:var(--accent)]"
                        />
                        <span className="text-[color:var(--text-primary)] text-xs">Required</span>
                      </label>
                    </div>
                    {(customFieldForm.fieldType === 'select' || customFieldForm.fieldType === 'multiselect') && (
                      <div>
                        <label className={labelClass}>Options (one per line or comma-separated)</label>
                        <textarea
                          value={customFieldForm.options}
                          onChange={(e) => setCustomFieldForm((f) => ({ ...f, options: e.target.value }))}
                          rows={2}
                          placeholder="Option 1&#10;Option 2"
                          className={`${inputClass} text-sm resize-y`}
                        />
                      </div>
                    )}
                    <div className="flex gap-3">
                      {customFieldEdit ? (
                        <>
                          <button
                            type="button"
                            onClick={updateCustomFieldItem}
                            className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)]"
                          >
                            Update field
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCustomFieldEdit(null);
                              setCustomFieldForm({
                                key: '',
                                label: '',
                                fieldType: 'text',
                                required: false,
                                options: '',
                              });
                              setError('');
                            }}
                            className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)]"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={addCustomField}
                          className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)]"
                        >
                          Add field
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-[color:var(--text-muted)]">Current fields</span>
                      {customFields.length > 0 && (
                        <span className="text-xs text-[color:var(--text-muted)]">
                          {customFields.length} field{customFields.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {customFields.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-8 text-center text-[color:var(--text-muted)] text-xs">
                        No custom fields yet. Add one above to show extra columns on issues.
                      </div>
                    ) : (
                      <ul className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden divide-y divide-[color:var(--border-subtle)]/70">
                        {customFields.map((f) => (
                          <li
                            key={f.id}
                            className="flex items-center justify-between gap-2 px-4 py-3 bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)] transition group"
                          >
                            <div className="min-w-0">
                              <span className="font-medium text-[color:var(--text-primary)] text-sm">{f.label}</span>
                              <span className="text-[color:var(--text-muted)] font-mono text-xs ml-2">{f.key}</span>
                              <span className="text-[color:var(--text-muted)] text-[11px] ml-2">
                                · {f.fieldType}
                                {f.required ? ', required' : ''}
                              </span>
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition">
                              <IconButton
                                title="Edit"
                                onClick={() => {
                                  setCustomFieldEdit(f);
                                  setCustomFieldForm({
                                    key: f.key,
                                    label: f.label,
                                    fieldType: f.fieldType,
                                    required: f.required,
                                    options: f.options?.join('\n') ?? '',
                                  });
                                }}
                              >
                                <EditIcon className="w-3.5 h-3.5" />
                              </IconButton>
                              <IconButton title="Delete" variant="danger" onClick={() => removeCustomField(f.id)}>
                                <TrashIcon className="w-3.5 h-3.5" />
                              </IconButton>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={saveCustomFields}
                    disabled={saving}
                    className="px-4 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)] disabled:opacity-50 transition"
                  >
                    {saving ? 'Saving…' : 'Save custom fields'}
                  </button>
                </div>
              </div>
            )}

            {tab === 'environments' && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
                <div className="p-6 border-b border-[color:var(--border-subtle)]">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Environments</h2>
                  <p className="text-[color:var(--text-muted)] text-xs mt-0.5">
                    Define deployment environments (e.g. QA, Staging, Production). Use these on the Versions page when releasing.
                  </p>
                </div>
                <div className="p-6 space-y-6">
                  <div className="flex flex-wrap gap-3 items-end">
                    <div className="flex-1 min-w-[200px]">
                      <label className={labelClass}>Add or edit environment</label>
                      <input
                        type="text"
                        value={environmentForm.name}
                        onChange={(e) => setEnvironmentForm({ name: e.target.value })}
                        placeholder="e.g. QA, Staging, Production"
                        className={inputClass}
                        onKeyDown={(e) => e.key === 'Enter' && (environmentEdit ? updateEnvironmentItem() : addEnvironment())}
                      />
                    </div>
                    {environmentEdit ? (
                      <>
                        <button
                          type="button"
                          onClick={updateEnvironmentItem}
                          className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)]"
                        >
                          Update
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEnvironmentEdit(null);
                            setEnvironmentForm({ name: '' });
                          }}
                          className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)]"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={addEnvironment}
                        className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)]"
                      >
                        Add environment
                      </button>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-[color:var(--text-muted)]">Current environments</span>
                      {environments.length > 0 && (
                        <span className="text-xs text-[color:var(--text-muted)]">
                          {environments.length} environment{environments.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {environments.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-8 text-center text-[color:var(--text-muted)] text-xs">
                        No environments yet. Add one above.
                      </div>
                    ) : (
                      <ul className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden divide-y divide-[color:var(--border-subtle)]/70">
                        {environments.map((env) => (
                          <li
                            key={env.id}
                            className="flex items-center justify-between gap-2 px-4 py-3 bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)] transition group"
                          >
                            <span className="font-medium text-[color:var(--text-primary)] text-sm">{env.name}</span>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                              <IconButton
                                title="Edit"
                                onClick={() => {
                                  setEnvironmentEdit(env);
                                  setEnvironmentForm({ name: env.name });
                                }}
                              >
                                <EditIcon className="w-3.5 h-3.5" />
                              </IconButton>
                              <IconButton title="Delete" variant="danger" onClick={() => removeEnvironment(env.id)}>
                                <TrashIcon className="w-3.5 h-3.5" />
                              </IconButton>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === 'releaseRules' && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
                <div className="p-6 border-b border-[color:var(--border-subtle)]">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Release rules</h2>
                  <p className="text-[color:var(--text-muted)] text-xs mt-0.5">
                    For each environment, set which issue status to apply when you release a version to that environment from the Versions page.
                  </p>
                </div>
                <div className="p-6 space-y-6">
                  <button
                    type="button"
                    onClick={openReleaseRuleModal}
                    className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)]"
                  >
                    Add rule
                  </button>
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-[color:var(--text-muted)]">Current rules</span>
                      {releaseRules.length > 0 && (
                        <span className="text-xs text-[color:var(--text-muted)]">
                          {releaseRules.length} rule{releaseRules.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    {releaseRules.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-8 text-center text-[color:var(--text-muted)] text-xs">
                        No release rules yet. Add environments first, then add a rule above.
                      </div>
                    ) : (
                      <ul className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden divide-y divide-[color:var(--border-subtle)]/70">
                        {releaseRules.map((r) => {
                          const env = environments.find((e) => e.id === r.environmentId);
                          const envName = env?.name ?? r.environmentId;
                          const notifyOn = (r.notifyUserIds?.length ?? 0) > 0 || (r.notifyChannels?.length ?? 0) > 0;
                          const notifyNote = notifyOn
                            ? [
                                r.notifyChannels?.length ? r.notifyChannels.map((c) => (c === 'email' ? 'Email' : c === 'in_app' ? 'In app' : 'Third-party')).join(', ') : null,
                                r.notifyUserIds?.length ? `${r.notifyUserIds.length} user(s)` : null,
                              ].filter(Boolean).join(' · ')
                            : 'Off';
                          return (
                            <li
                              key={r.environmentId}
                              className="flex flex-wrap items-center justify_between gap-x-4 gap-y-2 px-4 py-3 bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)] transition group"
                            >
                              <div className="flex flex-wrap items-center gap-2 min-w-0">
                                <span className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
                                  Environment
                                </span>
                                <span className="font-medium text-[color:var(--text-primary)] text-sm">{envName}</span>
                                <span className="text-[color:var(--text-muted)] text-xs">→</span>
                                <span className="text-[color:var(--text-muted)] text-xs">{r.statusName}</span>
                                <span className="text-[color:var(--text-muted)] text-xs">|</span>
                                <span className="text-[11px] font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
                                  Notify
                                </span>
                                <span
                                  className={`text-xs ${
                                    notifyOn ? 'text-[color:var(--accent)]' : 'text-[color:var(--text-muted)]'
                                  }`}
                                >
                                  {notifyOn ? 'On' : 'Off'}
                                  {notifyOn && notifyNote && (
                                    <span className="text-[color:var(--text-muted)] font-normal ml-1">
                                      ({notifyNote})
                                    </span>
                                  )}
                                </span>
                              </div>
                              <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition">
                                <IconButton
                                  title="Edit"
                                  onClick={() => {
                                    setReleaseRuleEdit(r);
                                    setReleaseRuleForm({
                                      environmentId: r.environmentId,
                                      statusName: r.statusName,
                                      assigneeId: r.assigneeId ?? '',
                                      notifyUserIds: r.notifyUserIds ?? [],
                                      notifyChannels: r.notifyChannels ?? [],
                                    });
                                    setReleaseRuleModalOpen(true);
                                  }}
                                >
                                  <EditIcon className="w-3.5 h-3.5" />
                                </IconButton>
                                <IconButton title="Delete" variant="danger" onClick={() => removeReleaseRule(r.environmentId)}>
                                  <TrashIcon className="w-3.5 h-3.5" />
                                </IconButton>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === 'milestones' && (
              <MilestonesTab
                projectId={projectId}
                milestones={milestones}
                setMilestones={setMilestones}
                token={token}
              />
            )}

            {tab === 'members' && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
                <div className="p-6 border-b border-[color:var(--border-subtle)]">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Members</h2>
                  <p className="text-[color:var(--text-muted)] text-xs mt-0.5">
                    Invite people by email and manage pending invitations.
                  </p>
                </div>
                <div className="p-6 space-y-6">
                  <section>
                    <h3 className="text-xs font-medium text-[color:var(--text-muted)] mb-2">Invite by email</h3>
                    <form onSubmit={handleInviteMember} className="space-y-2">
                      <div className="flex flex-wrap gap-3 items-center">
                        <div className="flex-1 min-w-[200px] relative" ref={inviteAutocompleteRef}>
                          <input
                            type="text"
                            autoComplete="off"
                            value={inviteEmail}
                            onChange={(e) => {
                              setInviteEmail(e.target.value);
                              setInviteError('');
                              setInviteAutocompleteOpen(true);
                            }}
                            onFocus={() => setInviteAutocompleteOpen(true)}
                            placeholder="Search by name or email…"
                            className={inputClass}
                          />
                          {inviteAutocompleteOpen && (() => {
                            const memberEmails = new Set(
                              members
                                .map((m) => typeof m.user === 'object' && m.user && 'email' in m.user ? (m.user as { email: string }).email : null)
                                .filter(Boolean) as string[]
                            );
                            const invitedEmails = new Set(
                              invitations
                                .map((inv) => typeof inv.user === 'object' && inv.user && 'email' in inv.user ? (inv.user as { email: string }).email : null)
                                .filter(Boolean) as string[]
                            );
                            const q = inviteEmail.trim().toLowerCase();
                            const inviteable = users
                              .filter((u) => u.email && !memberEmails.has(u.email) && !invitedEmails.has(u.email))
                              .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
                              .slice(0, 8);
                            if (inviteable.length === 0) return null;
                            return (
                              <div className="absolute z-20 mt-1 w-full rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-xl overflow-hidden max-h-56 overflow-y-auto">
                                {inviteable.map((u) => (
                                  <button
                                    key={u._id}
                                    type="button"
                                    onClick={() => {
                                      setInviteEmail(u.email);
                                      setInviteAutocompleteOpen(false);
                                    }}
                                    className="w-full px-3 py-2 text-left text-xs text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] transition flex flex-col items-start"
                                  >
                                    <span className="font-medium">{u.name}</span>
                                    <span className="text-[color:var(--text-muted)] text-[11px]">{u.email}</span>
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                        <button
                          type="submit"
                          disabled={inviting || !inviteEmail.trim()}
                          className="shrink-0 px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs text-[color:var(--text-primary)] font-medium hover:bg-[color:var(--bg-surface)] disabled:opacity-50 transition"
                        >
                          {inviting ? 'Inviting…' : 'Invite'}
                        </button>
                      </div>
                      <p className="text-[color:var(--text-muted)] text-[11px]">
                        User must have a TaskFlow account. Select from the list or type email.
                      </p>
                    </form>
                    {inviteError && (
                      <p className="mt-2 text-red-400 text-sm">{inviteError}</p>
                    )}
                  </section>
                  <section>
                    <h3 className="text-xs font-medium text-[color:var(--text-muted)] mb-2">Current members</h3>
                    {membersLoading ? (
                      <p className="text-[color:var(--text-muted)] text-xs">Loading…</p>
                    ) : members.length === 0 ? (
                      <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 text-center text-[color:var(--text-muted)] text-xs">
                        No members yet.
                      </div>
                    ) : (
                      <div className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden">
                        <table className="w-full text-left text-sm">
                          <thead>
                            <tr className="border-b border-[color:var(--border-subtle)]/80 bg-[color:var(--bg-page)]">
                              <th className="px-4 py-2 text-[11px] font-medium text-[color:var(--text-muted)] uppercase tracking-wide">Member</th>
                              <th className="px-4 py-2 text-[11px] font-medium text-[color:var(--text-muted)] uppercase tracking-wide">Designation</th>
                              <th className="px-4 py-2 text-[11px] font-medium text-[color:var(--text-muted)] uppercase tracking-wide">Joined</th>
                              <th className="px-4 py-2 text-[11px] font-medium text-[color:var(--text-muted)] uppercase tracking-wide text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[color:var(--border-subtle)]/70">
                            {members.map((m) => (
                              <tr key={m._id} className="bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)] transition">
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-full bg-[color:var(--accent)]/20 flex items-center justify-center text-xs font-semibold text-[color:var(--accent)] shrink-0">
                                      {m.user.avatarUrl ? (
                                        <img src={m.user.avatarUrl} alt={m.user.name} className="w-8 h-8 rounded-full object-cover" />
                                      ) : m.user.name.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="min-w-0">
                                      <p className="font-medium text-[color:var(--text-primary)] truncate">{m.user.name}</p>
                                      <p className="text-[11px] text-[color:var(--text-muted)] truncate">{m.user.email}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[color:var(--bg-page)] text-[color:var(--text-primary)] border border-[color:var(--border-subtle)]">
                                    {typeof m.designationId === 'object' && m.designationId !== null ? (m.designationId.name ?? 'No Designation') : 'No Designation'}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-[color:var(--text-muted)] text-xs whitespace-nowrap">
                                  {m.createdAt ? formatDateDDMMYYYY(m.createdAt) : '—'}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setMemberEdit(m);
                                        setMemberEditDesignationId(typeof m.designationId === 'object' ? m.designationId._id : (m.designationId || ''));
                                        setMemberEditError('');
                                      }}
                                      className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-page)] transition"
                                      title="Update role"
                                    >
                                      <FiEdit2 className="w-3.5 h-3.5" />
                                    </button>
                                    {project.lead && String(project.lead._id) !== String(m.user._id) && (
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveMember(m._id)}
                                        className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition"
                                        title="Remove member"
                                      >
                                        <FiTrash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                  <section>
                    <h3 className="text-xs font-medium text-[color:var(--text-muted)] mb-2">Pending invitations</h3>
                    {membersLoading ? (
                      <p className="text-[color:var(--text-muted)] text-xs">Loading…</p>
                    ) : invitations.length === 0 ? (
                      <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 text-center text-[color:var(--text-muted)] text-xs">
                        No pending invitations.
                      </div>
                    ) : (
                      <ul className="rounded-xl border border-[color:var(--border-subtle)] overflow-hidden divide-y divide-[color:var(--border-subtle)]/70">
                        {invitations.map((inv) => (
                          <li
                            key={inv._id}
                            className="flex items-center justify-between gap-4 px-4 py-3 bg-[color:var(--bg-surface)] hover:bg-[color:var(--bg-elevated)] transition"
                          >
                            <div>
                              <span className="font-medium text-[color:var(--text-primary)] text-sm">
                                {typeof inv.user === 'object' && inv.user ? inv.user.name : '-'}
                              </span>
                              <span className="text-[color:var(--text-muted)] text-xs ml-2">
                                {typeof inv.user === 'object' && inv.user && 'email' in inv.user ? inv.user.email : ''}
                              </span>
                              <span className="text-[color:var(--text-muted)] text-[11px] block">
                                Invited by{' '}
                                {typeof inv.invitedBy === 'object' && inv.invitedBy ? inv.invitedBy.name : '-'}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleCancelInvitation(inv._id)}
                              disabled={cancelLoadingId === inv._id}
                              className="px-3 py-1.5 rounded-md text-xs text-[color:var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50 transition"
                            >
                              {cancelLoadingId === inv._id ? 'Cancelling…' : 'Cancel invite'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </div>
            )}

            {tab === 'designations' && (
              <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
                <div className="p-6 border-b border-[color:var(--border-subtle)] flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Designations</h2>
                    <p className="text-[color:var(--text-muted)] text-xs mt-0.5">Define project-specific roles and their permissions.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDesignationEdit(null);
                      setDesignationForm({ name: '', permissions: [] });
                      setDesignationModalOpen(true);
                    }}
                    className="btn-primary text-xs flex items-center gap-2"
                  >
                    <FiPlus /> Add Designation
                  </button>
                </div>
                <div className="p-6 space-y-3">
                  {designations.map((d) => (
                    <div key={d._id} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-4 flex items-start justify-between gap-4 group">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold text-[color:var(--text-primary)] text-sm">{d.name}</p>
                          {d.isSystem && (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[color:var(--accent)]/10 text-[color:var(--accent)] uppercase tracking-wider">System</span>
                          )}
                        </div>
                        <p className="text-xs text-[color:var(--text-muted)]">
                          {d.permissions.length} permission{d.permissions.length !== 1 ? 's' : ''}
                        </p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {d.permissions.slice(0, 5).map((p: string) => (
                            <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] text-[color:var(--text-muted)] font-mono">
                              {p.split('.').pop()}
                            </span>
                          ))}
                          {d.permissions.length > 5 && (
                            <span className="text-[10px] text-[color:var(--text-muted)] font-medium">+{d.permissions.length - 5} more</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                        <button
                          onClick={() => {
                            setDesignationEdit(d);
                            setDesignationForm({ name: d.name, permissions: d.permissions });
                            setDesignationModalOpen(true);
                          }}
                          className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] hover:bg-[color:var(--bg-surface)] transition"
                        >
                          <FiEdit2 className="w-3.5 h-3.5" />
                        </button>
                        {!d.isSystem && (
                          <button
                            onClick={() => removeDesignation(d._id)}
                            className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition"
                          >
                            <FiTrash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </main>

          {/* Designation Modal */}
          {designationModalOpen && createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setDesignationModalOpen(false)}>
              <div className="w-full max-w-2xl bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl shadow-2xl animate-scale-in flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b border-[color:var(--border-subtle)] flex items-center justify-between shrink-0">
                  <h3 className="text-lg font-semibold text-[color:var(--text-primary)]">
                    {designationEdit ? `Edit Designation — ${designationEdit.name}` : 'Create Designation'}
                  </h3>
                  <button onClick={() => setDesignationModalOpen(false)} className="text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"><FiX /></button>
                </div>
                <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                  {designationError && (
                    <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                      {designationError}
                    </div>
                  )}
                  <div className="space-y-6">
                    <div>
                      <label className={labelClass}>Designation Name</label>
                      <input
                        type="text"
                        value={designationForm.name}
                        onChange={e => setDesignationForm(f => ({ ...f, name: e.target.value }))}
                        disabled={designationEdit?.isSystem}
                        className={inputClass}
                        placeholder="e.g. Quality Analyst"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Permissions</label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                        {ALL_PROJECT_PERMISSIONS_LIST.map(p => (
                          <label key={p.code} className="flex items-center gap-2.5 cursor-pointer group">
                            <input
                              type="checkbox"
                              checked={designationForm.permissions.includes(p.code)}
                              onChange={() => {
                                setDesignationForm(f => ({
                                  ...f,
                                  permissions: f.permissions.includes(p.code)
                                    ? f.permissions.filter(x => x !== p.code)
                                    : [...f.permissions, p.code]
                                }));
                              }}
                              className="w-4 h-4 rounded border-[color:var(--border-subtle)] accent-[color:var(--accent)]"
                            />
                            <div className="min-w-0">
                              <p className="text-sm text-[color:var(--text-primary)] group-hover:text-[color:var(--accent)] transition">{p.label}</p>
                              <p className="text-[10px] text-[color:var(--text-muted)] font-mono truncate">{p.code}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="p-6 border-t border-[color:var(--border-subtle)] flex justify-end gap-3 shrink-0">
                  <button onClick={() => setDesignationModalOpen(false)} className="btn-secondary text-sm">Cancel</button>
                  <button onClick={saveDesignation} disabled={designationSaving || !designationForm.name.trim()} className="btn-primary text-sm min-w-[100px]">
                    {designationSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}

          {/* Member Edit Modal */}
          {memberEdit && createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setMemberEdit(null)}>
              <div className="w-full max-w-md bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl shadow-2xl animate-scale-in p-6" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-semibold text-[color:var(--text-primary)] mb-1">Update Member</h3>
                <p className="text-sm text-[color:var(--text-muted)] mb-6">{memberEdit.user.name} ({memberEdit.user.email})</p>
                
                <div className="space-y-4">
                  <div>
                    <label className={labelClass}>Project Designation</label>
                    <select
                      value={memberEditDesignationId}
                      onChange={e => setMemberEditDesignationId(e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Select a designation…</option>
                      {designations.map(d => (
                        <option key={d._id} value={d._id}>{d.name}</option>
                      ))}
                    </select>
                  </div>
                  {memberError && <p className="text-xs text-red-400">{memberError}</p>}
                  <div className="flex justify-end gap-3 pt-2">
                    <button onClick={() => setMemberEdit(null)} className="btn-secondary text-sm">Cancel</button>
                    <button onClick={handleUpdateMember} disabled={memberSaving || !memberEditDesignationId} className="btn-primary text-sm min-w-[100px]">
                      {memberSaving ? 'Updating…' : 'Update'}
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}

          {saveTemplateOpen &&
            createPortal(
              <div
                className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                onClick={() => !saveTemplateSaving && setSaveTemplateOpen(false)}
              >
                <div
                  className="w-full max-w-md rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)] shadow-xl p-6"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h3 className="text-sm font-semibold text-[color:var(--text-primary)]">Save workflow as template</h3>
                  <p className="text-xs text-[color:var(--text-muted)] mt-1">
                    Stores current statuses, issue types, and priorities. Use when creating or editing projects.
                  </p>
                  <form onSubmit={handleSaveAsTemplate} className="mt-4 space-y-3">
                    {saveTemplateError && (
                      <p className="text-xs text-red-500">{saveTemplateError}</p>
                    )}
                    <div>
                      <label className={labelClass}>Template name</label>
                      <input
                        type="text"
                        value={saveTemplateName}
                        onChange={(e) => setSaveTemplateName(e.target.value)}
                        required
                        className={inputClass}
                        placeholder="e.g. Scrum board preset"
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Description (optional)</label>
                      <textarea
                        value={saveTemplateDescription}
                        onChange={(e) => setSaveTemplateDescription(e.target.value)}
                        rows={2}
                        className={`${inputClass} resize-y`}
                        placeholder="When to use this template"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        disabled={saveTemplateSaving}
                        onClick={() => setSaveTemplateOpen(false)}
                        className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] text-xs text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={saveTemplateSaving || !saveTemplateName.trim()}
                        className="px-3 py-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-xs font-medium text-[color:var(--text-primary)] disabled:opacity-50"
                      >
                        {saveTemplateSaving ? 'Saving…' : 'Save template'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>,
              document.body
            )}

          {/* Release rule modal: Add / Edit rule */}
          {releaseRuleModalOpen && createPortal(
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm overflow-auto" onClick={closeReleaseRuleModal}>
              <div
                className="bg-[color:var(--bg-modal)] border border-[color:var(--border-subtle)] rounded-2xl shadow-2xl w-full max-h-[90vh] overflow-auto"
                style={{ maxWidth: 'min(28rem, calc(100vw - 2rem))' }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-6 pt-6 pb-4 border-b border-[color:var(--border-subtle)]">
                  <h3 className="text-lg font-semibold text-white">{releaseRuleEdit ? 'Edit release rule' : 'New release rule'}</h3>
                  <p className="text-[color:var(--text-muted)] text-sm mt-1">Set environment, auto status, and optional assignee & notifications.</p>
                </div>
                <div className="p-6 space-y-5">
                  <div>
                    <label className={labelClass}>Environment</label>
                    <select
                      value={releaseRuleForm.environmentId}
                      onChange={(e) => setReleaseRuleForm((f) => ({ ...f, environmentId: e.target.value }))}
                      className={inputClass}
                      disabled={!!releaseRuleEdit}
                    >
                      <option value="">Select environment</option>
                      {environments.map((e) => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Auto status update (set issues to)</label>
                    <select
                      value={releaseRuleForm.statusName}
                      onChange={(e) => setReleaseRuleForm((f) => ({ ...f, statusName: e.target.value }))}
                      className={inputClass}
                    >
                      {!releaseRuleForm.statusName && <option value="">Select status</option>}
                      {releaseRuleForm.statusName && !statuses.some((s) => s.name === releaseRuleForm.statusName) && (
                        <option value={releaseRuleForm.statusName}>{releaseRuleForm.statusName}</option>
                      )}
                      {statuses.map((s) => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Assign to person (optional)</label>
                    <select
                      value={releaseRuleForm.assigneeId}
                      onChange={(e) => setReleaseRuleForm((f) => ({ ...f, assigneeId: e.target.value }))}
                      className={inputClass}
                    >
                      <option value="">No specific assignee</option>
                      {users.map((u) => (
                        <option key={u._id} value={u._id}>{u.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Who to notify (optional)</label>
                    <p className="text-[color:var(--text-muted)] text-xs mb-2">Select users to notify when a version is released to this environment.</p>
                    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-3 space-y-2 max-h-32 overflow-auto">
                      {users.length === 0 ? (
                        <p className="text-[color:var(--text-muted)] text-sm">No users loaded.</p>
                      ) : (
                        users.map((u) => (
                          <label key={u._id} className="flex items-center gap-2 cursor-pointer text-[color:var(--text-primary)] text-sm">
                            <input
                              type="checkbox"
                              checked={releaseRuleForm.notifyUserIds.includes(u._id)}
                              onChange={() => toggleNotifyUser(u._id)}
                              className="rounded border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-indigo-500"
                            />
                            {u.name}
                          </label>
                        ))
                      )}
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>How to notify (optional)</label>
                    <p className="text-[color:var(--text-muted)] text-xs mb-2">Channels for notifications.</p>
                    <div className="flex flex-wrap gap-4">
                      {(['email', 'in_app', 'third_party'] as const).map((ch) => (
                        <label key={ch} className="flex items-center gap-2 cursor-pointer text-[color:var(--text-primary)] text-sm">
                          <input
                            type="checkbox"
                            checked={releaseRuleForm.notifyChannels.includes(ch)}
                            onChange={() => toggleNotifyChannel(ch)}
                            className="rounded border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-indigo-500"
                          />
                          {ch === 'email' ? 'Email' : ch === 'in_app' ? 'In app' : 'Third-party messaging'}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-3 pt-2">
                    {releaseRuleEdit ? (
                      <>
                        <button type="button" onClick={updateReleaseRuleItem} disabled={!releaseRuleForm.environmentId || !releaseRuleForm.statusName} className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 disabled:opacity-50">Update rule</button>
                        <button type="button" onClick={closeReleaseRuleModal} className="px-5 py-2.5 rounded-xl btn-secondary border text-[color:var(--text-primary)]">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={addReleaseRule} disabled={!releaseRuleForm.environmentId || !releaseRuleForm.statusName} className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-500 disabled:opacity-50">Add rule</button>
                        <button type="button" onClick={closeReleaseRuleModal} className="px-5 py-2.5 rounded-xl btn-secondary border text-[color:var(--text-primary)]">Cancel</button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>
    </div>
  );
}
