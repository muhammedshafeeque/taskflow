import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  adminCustomerApi,
  projectsApi,
  type CustomerOrg,
  type ProjectMapping,
  type CustomerMember,
  type CustomerRole,
  type CustomerRequest,
  type Project,
} from '../../lib/api';
import {
  FiArrowLeft,
  FiEdit2,
  FiSave,
  FiX,
  FiPlus,
  FiTrash2,
  FiBriefcase,
} from 'react-icons/fi';
import RecordLinksPanel from '../../components/RecordLinksPanel';

type Tab = 'overview' | 'projects' | 'members' | 'requests';

function statusBadge(status: string, kind: 'org' | 'request' | 'member' = 'org'): string {
  if (kind === 'request') {
    switch (status) {
      case 'draft': return 'bg-gray-500/15 text-gray-400';
      case 'submitted':
      case 'pending_customer_approval':
      case 'pending_taskflow_approval': return 'bg-yellow-500/15 text-yellow-400';
      case 'approved':
      case 'ticket_created':
      case 'in_progress': return 'bg-blue-500/15 text-blue-400';
      case 'resolved':
      case 'closed': return 'bg-green-500/15 text-green-400';
      case 'rejected': return 'bg-red-500/15 text-red-400';
      default: return 'bg-gray-500/15 text-gray-400';
    }
  }
  switch (status) {
    case 'active': return 'bg-green-500/15 text-green-400';
    case 'inactive': return 'bg-gray-500/15 text-gray-400';
    case 'suspended': return 'bg-red-500/15 text-red-400';
    case 'invited': return 'bg-yellow-500/15 text-yellow-400';
    default: return 'bg-gray-500/15 text-gray-400';
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getRoleName(member: CustomerMember): string {
  if (typeof member.roleId === 'object' && 'name' in member.roleId) return (member.roleId as { name: string }).name;
  return '—';
}

function getMemberRoleId(member: CustomerMember): string {
  if (typeof member.roleId === 'object' && '_id' in member.roleId) return (member.roleId as { _id: string })._id;
  return typeof member.roleId === 'string' ? member.roleId : '';
}

function getMemberRolePermissions(member: CustomerMember): string[] {
  if (typeof member.roleId === 'object' && 'permissions' in member.roleId) {
    return (member.roleId as { permissions: string[] }).permissions ?? [];
  }
  return [];
}

const CUSTOMER_PERMISSIONS_LIST = [
  { code: 'requests:create', label: 'Raise new requests' },
  { code: 'requests:view_own', label: 'View own requests' },
  { code: 'requests:view_all', label: 'View all org requests' },
  { code: 'requests:approve', label: 'Approve / reject member requests' },
  { code: 'team:view', label: 'View team members' },
  { code: 'team:invite', label: 'Invite team members' },
  { code: 'team:manage', label: 'Manage team members' },
  { code: 'roles:manage', label: 'Manage custom roles' },
  { code: 'projects:view', label: 'View linked projects' },
] as const;

const ALL_REQUEST_TYPES = ['bug', 'feature', 'suggestion', 'concern', 'other'];

export default function CustomerOrgDetail() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Org
  const [org, setOrg] = useState<CustomerOrg | null>(null);
  const [projectCount, setProjectCount] = useState(0);
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgError, setOrgError] = useState('');

  // Edit org
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', contactEmail: '', contactPhone: '', description: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Projects
  const [mappings, setMappings] = useState<ProjectMapping[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(false);
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [addProjectId, setAddProjectId] = useState('');
  const [addAllowedTypes, setAddAllowedTypes] = useState<string[]>([]);
  const [addingProject, setAddingProject] = useState(false);
  const [addProjectError, setAddProjectError] = useState('');
  const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);

  // Members
  const [members, setMembers] = useState<CustomerMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [orgRoles, setOrgRoles] = useState<CustomerRole[]>([]);

  // Edit member
  const [editMember, setEditMember] = useState<CustomerMember | null>(null);
  const [memberEditTab, setMemberEditTab] = useState<'details' | 'permissions'>('details');
  const [memberEditForm, setMemberEditForm] = useState({ roleId: '', status: 'active' });
  const [memberEditError, setMemberEditError] = useState('');
  const [memberEditSubmitting, setMemberEditSubmitting] = useState(false);
  const [memberPermGranted, setMemberPermGranted] = useState<string[]>([]);
  const [memberPermRevoked, setMemberPermRevoked] = useState<string[]>([]);
  const [memberPermSaving, setMemberPermSaving] = useState(false);
  const [memberPermError, setMemberPermError] = useState('');

  // Requests
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);

  useEffect(() => {
    if (!token || !id) return;
    setOrgLoading(true);
    adminCustomerApi.getOrg(id, token).then((res) => {
      setOrgLoading(false);
      if (res.success && res.data) {
        setOrg(res.data.org);
        setEditForm({
          name: res.data.org.name,
          contactEmail: res.data.org.contactEmail,
          contactPhone: res.data.org.contactPhone ?? '',
          description: res.data.org.description ?? '',
        });
        adminCustomerApi.listProjects(id, token).then((pRes) => {
          if (pRes.success && pRes.data) setProjectCount(pRes.data.mappings?.length ?? 0);
        });
      } else {
        setOrgError((res as { message?: string }).message ?? 'Failed to load organisation');
      }
    });
  }, [token, id]);

  useEffect(() => {
    if (activeTab === 'projects' && token && id) {
      setMappingsLoading(true);
      adminCustomerApi.listProjects(id, token).then((res) => {
        setMappingsLoading(false);
        if (res.success && res.data) setMappings(res.data.mappings || []);
      });
      projectsApi.list(1, 200, token).then((res) => {
        if (res.success && res.data) setAllProjects(res.data.data || []);
      });
    }
    if (activeTab === 'members' && token && id) {
      setMembersLoading(true);
      Promise.all([
        adminCustomerApi.listMembers(id, token),
        adminCustomerApi.listOrgRoles(id, token),
      ]).then(([mRes, rRes]) => {
        setMembersLoading(false);
        if (mRes.success && mRes.data) setMembers(mRes.data.members || []);
        if (rRes.success && rRes.data) setOrgRoles(rRes.data.roles || []);
      });
    }
    if (activeTab === 'requests' && token) {
      setRequestsLoading(true);
      // Filter by org — backend should handle this, using general pending list as proxy
      adminCustomerApi.listPendingRequests(token).then((res) => {
        setRequestsLoading(false);
        if (res.success && res.data) setRequests(res.data.requests || []);
      });
    }
  }, [activeTab, token, id]);

  async function handleEditSave() {
    if (!token || !id) return;
    setEditSaving(true);
    setEditError('');
    const res = await adminCustomerApi.updateOrg(id, {
      name: editForm.name,
      contactEmail: editForm.contactEmail,
      contactPhone: editForm.contactPhone || undefined,
      description: editForm.description || undefined,
    }, token);
    setEditSaving(false);
    if (res.success) {
      setEditing(false);
      // Refresh org
      adminCustomerApi.getOrg(id, token).then((r) => {
        if (r.success && r.data) setOrg(r.data.org);
      });
    } else {
      setEditError((res as { message?: string }).message ?? 'Update failed');
    }
  }

  async function handleAddProject() {
    if (!token || !id || !addProjectId) return;
    setAddingProject(true);
    setAddProjectError('');
    const res = await adminCustomerApi.addProject(
      id,
      { projectId: addProjectId, allowedRequestTypes: addAllowedTypes.length > 0 ? addAllowedTypes : undefined },
      token
    );
    setAddingProject(false);
    if (res.success) {
      setAddProjectId('');
      setAddAllowedTypes([]);
      adminCustomerApi.listProjects(id, token).then((r) => {
        if (r.success && r.data) setMappings(r.data.mappings);
      });
    } else {
      setAddProjectError((res as { message?: string }).message ?? 'Failed to add project');
    }
  }

  async function handleRemoveProject(projectId: string) {
    if (!token || !id) return;
    setRemovingProjectId(projectId);
    await adminCustomerApi.removeProject(id, projectId, token);
    setRemovingProjectId(null);
    adminCustomerApi.listProjects(id, token).then((r) => {
      if (r.success && r.data) setMappings(r.data.mappings);
    });
  }

  function openEditMember(m: CustomerMember) {
    setEditMember(m);
    setMemberEditTab('details');
    setMemberEditForm({ roleId: getMemberRoleId(m), status: m.status });
    setMemberEditError('');
    setMemberPermGranted(m.permissionOverrides?.granted ?? []);
    setMemberPermRevoked(m.permissionOverrides?.revoked ?? []);
    setMemberPermError('');
  }

  async function handleSaveMemberDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !id || !editMember) return;
    setMemberEditSubmitting(true);
    setMemberEditError('');
    const res = await adminCustomerApi.updateMember(id, editMember._id, {
      roleId: memberEditForm.roleId || undefined,
      status: memberEditForm.status,
    }, token);
    setMemberEditSubmitting(false);
    if (res.success) {
      setMembers((prev) => prev.map((m) => m._id === editMember._id ? { ...m, ...(res.data as CustomerMember) } : m));
      setEditMember(null);
    } else {
      setMemberEditError((res as { message?: string }).message ?? 'Update failed');
    }
  }

  async function handleSaveMemberPermissions() {
    if (!token || !id || !editMember) return;
    setMemberPermSaving(true);
    setMemberPermError('');
    const res = await adminCustomerApi.updateMemberPermissions(id, editMember._id, {
      granted: memberPermGranted,
      revoked: memberPermRevoked,
    }, token);
    setMemberPermSaving(false);
    if (res.success && res.data) {
      setMembers((prev) => prev.map((m) => m._id === editMember._id ? { ...m, permissionOverrides: (res.data as CustomerMember).permissionOverrides } : m));
    } else {
      setMemberPermError((res as { message?: string }).message ?? 'Failed to save permissions');
    }
  }

  function getMemberEffectiveChecked(code: string): boolean {
    if (memberPermRevoked.includes(code)) return false;
    if (memberPermGranted.includes(code)) return true;
    return (editMember ? getMemberRolePermissions(editMember) : []).includes(code);
  }

  function getMemberPermSource(code: string): 'role' | 'granted' | 'revoked' | 'none' {
    const rolePerms = editMember ? getMemberRolePermissions(editMember) : [];
    if (memberPermRevoked.includes(code)) return 'revoked';
    if (memberPermGranted.includes(code)) return 'granted';
    if (rolePerms.includes(code)) return 'role';
    return 'none';
  }

  function toggleMemberPermission(code: string) {
    const rolePerms = editMember ? getMemberRolePermissions(editMember) : [];
    const inRole = rolePerms.includes(code);
    const currentlyChecked = getMemberEffectiveChecked(code);

    if (currentlyChecked) {
      if (inRole) {
        setMemberPermGranted((g) => g.filter((p) => p !== code));
        setMemberPermRevoked((r) => [...r.filter((p) => p !== code), code]);
      } else {
        setMemberPermGranted((g) => g.filter((p) => p !== code));
      }
    } else {
      if (inRole && memberPermRevoked.includes(code)) {
        setMemberPermRevoked((r) => r.filter((p) => p !== code));
      } else {
        setMemberPermRevoked((r) => r.filter((p) => p !== code));
        setMemberPermGranted((g) => [...g.filter((p) => p !== code), code]);
      }
    }
  }

  const mappedProjectIds = new Set((mappings || []).map((m) => m?.projectId?._id).filter(Boolean));
  const unmappedProjects = (allProjects || []).filter((p) => p && !mappedProjectIds.has(p._id));

  const inputClass =
    'w-full rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] px-4 py-3 text-sm text-[color:var(--text-primary)] placeholder-[color:var(--text-muted)] transition focus:border-[color:var(--accent)] focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/30';

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'projects', label: 'Projects' },
    { key: 'members', label: 'Members' },
    { key: 'requests', label: 'Requests' },
  ];

  return (
    <div className="p-8 animate-fade-in">
      <button
        type="button"
        onClick={() => navigate('/admin/customer-orgs')}
        className="flex items-center gap-2 text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] transition mb-6"
      >
        <FiArrowLeft /> Back to Organisations
      </button>

      {orgLoading ? (
        <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-12 text-center text-[color:var(--text-muted)] animate-pulse">Loading…</div>
      ) : orgError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-400">{orgError}</div>
      ) : org ? (
        <>
          {/* Header */}
          <div className="flex items-start gap-4 mb-6 flex-wrap">
            <div className="w-12 h-12 rounded-xl bg-[color:var(--accent)]/10 flex items-center justify-center text-[color:var(--accent)] shrink-0">
              <FiBriefcase className="text-xl" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-semibold text-[color:var(--text-primary)]">{org.name}</h1>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(org.status)}`}>
                  {org.status}
                </span>
              </div>
              <p className="text-sm text-[color:var(--text-muted)] mt-1">{org.contactEmail}</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-[color:var(--border-subtle)] mb-6">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${
                  activeTab === tab.key
                    ? 'border-[color:var(--accent)] text-[color:var(--accent)]'
                    : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="max-w-2xl space-y-4">
              {(org.linkedLead || (org.linkedDeals && org.linkedDeals.length > 0)) && (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-3">CRM records</h2>
                  <dl className="space-y-2 text-sm">
                    {org.linkedLead && (
                      <div>
                        <dt className="text-[color:var(--text-muted)] text-xs">Linked lead</dt>
                        <dd className="mt-0.5">
                          <Link to={`/crm/leads/${org.linkedLead._id}`} className="text-[color:var(--accent)] hover:underline">
                            {org.linkedLead.title}
                          </Link>
                          <span className="text-[color:var(--text-muted)]"> · {org.linkedLead.status}</span>
                        </dd>
                      </div>
                    )}
                    {org.linkedDeals && org.linkedDeals.length > 0 && (
                      <div>
                        <dt className="text-[color:var(--text-muted)] text-xs">Linked deals</dt>
                        <dd className="mt-1 space-y-1">
                          {org.linkedDeals.map((d) => (
                            <div key={d._id}>
                              <Link to="/crm/deals" className="text-[color:var(--accent)] hover:underline">{d.title}</Link>
                              <span className="text-[color:var(--text-muted)]"> · {d.status}</span>
                            </div>
                          ))}
                        </dd>
                      </div>
                    )}
                    {org.linkedAccount && (
                      <div>
                        <dt className="text-[color:var(--text-muted)] text-xs">CRM account</dt>
                        <dd className="mt-0.5 text-[color:var(--text-primary)]">
                          {org.linkedAccount.name}
                          {org.linkedAccount.type ? (
                            <span className="text-[color:var(--text-muted)]"> · {org.linkedAccount.type}</span>
                          ) : null}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              )}

              <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
                <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-3">Onboarding checklist</h2>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-center gap-2 text-green-400">
                    <span aria-hidden>✓</span>
                    <span>Portal admin invited by email</span>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className={org.linkedAccount || org.crmAccountId ? 'text-green-400' : 'text-[color:var(--text-primary)]'}>
                      {org.linkedAccount || org.crmAccountId ? '✓' : '○'} CRM account linked
                    </span>
                    {(org.linkedAccount || org.crmAccountId) && (
                      <span className="text-xs text-[color:var(--text-muted)]">{org.linkedAccount?.name ?? 'Synced'}</span>
                    )}
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className={projectCount > 0 ? 'text-green-400' : 'text-[color:var(--text-primary)]'}>
                      {projectCount > 0 ? '✓' : '○'} Map at least one project
                    </span>
                    <button type="button" onClick={() => setActiveTab('projects')} className="text-xs text-[color:var(--accent)] hover:underline">
                      {projectCount > 0 ? 'View projects' : 'Add project'}
                    </button>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className="text-[color:var(--text-primary)]">○ Create commercial agreement</span>
                    <Link to="/crm/contracts" className="text-xs text-[color:var(--accent)] hover:underline">CRM contracts</Link>
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Organisation Details</h2>
                  {!editing && (
                    <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-xs text-[color:var(--accent)] hover:underline">
                      <FiEdit2 /> Edit
                    </button>
                  )}
                </div>

                {!editing ? (
                  <dl className="space-y-3 text-sm">
                    <div><dt className="text-[color:var(--text-muted)]">Name</dt><dd className="text-[color:var(--text-primary)] font-medium mt-0.5">{org.name}</dd></div>
                    <div><dt className="text-[color:var(--text-muted)]">Slug</dt><dd className="text-[color:var(--text-primary)] font-mono mt-0.5">{org.slug}</dd></div>
                    <div><dt className="text-[color:var(--text-muted)]">Contact Email</dt><dd className="text-[color:var(--text-primary)] mt-0.5">{org.contactEmail}</dd></div>
                    <div><dt className="text-[color:var(--text-muted)]">Phone</dt><dd className="text-[color:var(--text-primary)] mt-0.5">{org.contactPhone ?? '—'}</dd></div>
                    <div><dt className="text-[color:var(--text-muted)]">Description</dt><dd className="text-[color:var(--text-primary)] mt-0.5">{org.description ?? '—'}</dd></div>
                    <div><dt className="text-[color:var(--text-muted)]">Created</dt><dd className="text-[color:var(--text-primary)] mt-0.5">{formatDate(org.createdAt)}</dd></div>
                  </dl>
                ) : (
                  <div className="space-y-4">
                    {editError && (
                      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{editError}</div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Name</label>
                      <input type="text" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Contact Email</label>
                      <input type="email" value={editForm.contactEmail} onChange={(e) => setEditForm((f) => ({ ...f, contactEmail: e.target.value }))} className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Phone</label>
                      <input type="text" value={editForm.contactPhone} onChange={(e) => setEditForm((f) => ({ ...f, contactPhone: e.target.value }))} className={inputClass} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Description</label>
                      <textarea rows={3} value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} className={`${inputClass} resize-none`} />
                    </div>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => { setEditing(false); setEditError(''); }} className="btn-secondary text-sm flex items-center gap-2"><FiX /> Cancel</button>
                      <button type="button" onClick={handleEditSave} disabled={editSaving} className="btn-primary text-sm flex items-center gap-2">
                        <FiSave /> {editSaving ? 'Saving…' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'overview' && id && <RecordLinksPanel type="customer" id={id} className="mt-6" />}

          {/* Projects Tab */}
          {activeTab === 'projects' && (
            <div className="space-y-4">
              {/* Add project */}
              <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-5">
                <h2 className="text-sm font-semibold text-[color:var(--text-primary)] mb-4">Add Project</h2>
                {addProjectError && (
                  <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">{addProjectError}</div>
                )}
                <div className="flex flex-col gap-3">
                  <select value={addProjectId} onChange={(e) => setAddProjectId(e.target.value)} className={inputClass}>
                    <option value="">Select project to add…</option>
                    {unmappedProjects.map((p) => (
                      <option key={p._id} value={p._id}>{p.name} ({p.key})</option>
                    ))}
                  </select>
                  {addProjectId && (
                    <div>
                      <p className="text-xs font-medium text-[color:var(--text-muted)] mb-2">Allowed request types (leave empty for all):</p>
                      <div className="flex flex-wrap gap-2">
                        {ALL_REQUEST_TYPES.map((t) => (
                          <label key={t} className="flex items-center gap-1.5 cursor-pointer text-sm text-[color:var(--text-primary)]">
                            <input
                              type="checkbox"
                              checked={addAllowedTypes.includes(t)}
                              onChange={() =>
                                setAddAllowedTypes((prev) =>
                                  prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
                                )
                              }
                              className="w-3.5 h-3.5 accent-[color:var(--accent)]"
                            />
                            <span className="capitalize">{t}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <button
                      type="button"
                      onClick={handleAddProject}
                      disabled={!addProjectId || addingProject}
                      className="btn-primary text-sm flex items-center gap-2"
                    >
                      <FiPlus /> {addingProject ? 'Adding…' : 'Add Project'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Mapped projects list */}
              {mappingsLoading ? (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-8 text-center text-[color:var(--text-muted)] animate-pulse">Loading…</div>
              ) : (
                <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
                  {mappings.length === 0 ? (
                    <p className="p-8 text-center text-sm text-[color:var(--text-muted)]">No projects mapped yet.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
                          <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Project</th>
                          <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Allowed Types</th>
                          <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Status</th>
                          <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[color:var(--border-subtle)]">
                        {mappings.map((m) => (
                          <tr key={m._id} className="hover:bg-[color:var(--bg-elevated)] transition">
                            <td className="px-4 py-3">
                              <p className="font-medium text-[color:var(--text-primary)]">{m.projectId.name}</p>
                              <p className="text-xs text-[color:var(--text-muted)] font-mono">{m.projectId.key}</p>
                            </td>
                            <td className="px-4 py-3">
                              {m.allowedRequestTypes.length === 0 ? (
                                <span className="text-xs text-[color:var(--text-muted)]">All types</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {m.allowedRequestTypes.map((t) => (
                                    <span key={t} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs capitalize bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)] border border-[color:var(--border-subtle)]">{t}</span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(m.status)}`}>
                                {m.status}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => handleRemoveProject(m.projectId._id)}
                                disabled={removingProjectId === m.projectId._id}
                                className="p-1.5 rounded-md text-[color:var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition disabled:opacity-50"
                                title="Remove project"
                              >
                                <FiTrash2 className="text-sm" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Members Tab */}
          {activeTab === 'members' && (
            <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
              {membersLoading ? (
                <p className="p-8 text-center text-sm text-[color:var(--text-muted)] animate-pulse">Loading…</p>
              ) : members.length === 0 ? (
                <p className="p-8 text-center text-sm text-[color:var(--text-muted)]">No members found.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-elevated)]">
                      <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Name</th>
                      <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Email</th>
                      <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Role</th>
                      <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Status</th>
                      <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Admin</th>
                      <th className="px-4 py-3 text-right font-medium text-[color:var(--text-muted)]">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--border-subtle)]">
                    {members.map((m) => (
                      <tr key={m._id} className="hover:bg-[color:var(--bg-elevated)] transition">
                        <td className="px-4 py-3 font-medium text-[color:var(--text-primary)]">{m.name}</td>
                        <td className="px-4 py-3 text-[color:var(--text-muted)]">{m.email}</td>
                        <td className="px-4 py-3 text-[color:var(--text-primary)]">{getRoleName(m)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(m.status, 'member')}`}>
                            {m.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[color:var(--text-muted)]">{m.isOrgAdmin ? 'Yes' : '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openEditMember(m)}
                            className="p-1.5 rounded-lg text-[color:var(--text-muted)] hover:text-[color:var(--accent)] hover:bg-[color:var(--bg-page)] transition-colors"
                            title="Edit member"
                          >
                            <FiEdit2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Requests Tab */}
          {activeTab === 'requests' && (
            <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] overflow-hidden">
              {requestsLoading ? (
                <p className="p-8 text-center text-sm text-[color:var(--text-muted)] animate-pulse">Loading…</p>
              ) : requests.length === 0 ? (
                <p className="p-8 text-center text-sm text-[color:var(--text-muted)]">No requests found.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/50">
                      <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Title</th>
                      <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Type</th>
                      <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Priority</th>
                      <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Status</th>
                      <th className="px-4 py-3 text-left font-medium text-[color:var(--text-muted)]">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--border-subtle)]">
                    {requests.map((req) => (
                      <tr key={req._id} className="hover:bg-[color:var(--bg-elevated)] transition">
                        <td className="px-4 py-3 font-medium text-[color:var(--text-primary)] max-w-xs truncate">{req.title}</td>
                        <td className="px-4 py-3 capitalize text-[color:var(--text-muted)]">{req.type}</td>
                        <td className="px-4 py-3 capitalize text-[color:var(--text-muted)]">{req.priority}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(req.status, 'request')}`}>
                            {statusLabel(req.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[color:var(--text-muted)]">{formatDate(req.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      ) : null}

      {/* Edit Member Modal */}
      {editMember && createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
          onClick={() => !memberEditSubmitting && !memberPermSaving && setEditMember(null)}
        >
          <div
            className="bg-[color:var(--bg-elevated)] border border-[color:var(--border-subtle)] rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[90vh] animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-6 pt-6 pb-0 shrink-0">
              <h2 className="text-lg font-semibold text-[color:var(--text-primary)]">Edit member</h2>
              <p className="text-sm text-[color:var(--text-muted)] mt-0.5">{editMember.email}</p>
              {/* Tabs */}
              <div className="flex gap-0 mt-4 border-b border-[color:var(--border-subtle)]">
                {(['details', 'permissions'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setMemberEditTab(tab)}
                    className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition ${
                      memberEditTab === tab
                        ? 'border-[color:var(--accent)] text-[color:var(--accent)]'
                        : 'border-transparent text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {memberEditTab === 'details' && (
                <form id="member-details-form" onSubmit={handleSaveMemberDetails} className="space-y-4">
                  {memberEditError && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                      {memberEditError}
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Role</label>
                    <select
                      value={memberEditForm.roleId}
                      onChange={(e) => setMemberEditForm((f) => ({ ...f, roleId: e.target.value }))}
                      disabled={editMember.isOrgAdmin}
                      className="w-full px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40 disabled:opacity-50"
                    >
                      <option value="">— Select —</option>
                      {orgRoles.map((r) => (
                        <option key={r._id} value={r._id}>{r.name}</option>
                      ))}
                    </select>
                    {editMember.isOrgAdmin && (
                      <p className="text-xs text-[color:var(--text-muted)] mt-1">Role cannot be changed for org admin.</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[color:var(--text-primary)] mb-1.5">Status</label>
                    <select
                      value={memberEditForm.status}
                      onChange={(e) => setMemberEditForm((f) => ({ ...f, status: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg bg-[color:var(--bg-page)] border border-[color:var(--border-subtle)] text-[color:var(--text-primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--accent)]/40"
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="pending">Pending</option>
                    </select>
                  </div>
                </form>
              )}

              {memberEditTab === 'permissions' && (
                <div className="space-y-3">
                  <p className="text-xs text-[color:var(--text-muted)]">
                    Override individual permissions for this member. Changes apply on top of their role.
                  </p>
                  <div className="flex gap-4 text-xs text-[color:var(--text-muted)] mb-1">
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[color:var(--border-subtle)]" />From role</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" />Extra grant</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" />Revoked</span>
                  </div>
                  {memberPermError && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                      {memberPermError}
                    </div>
                  )}
                  <div className="space-y-1">
                    {CUSTOMER_PERMISSIONS_LIST.map((perm) => {
                      const checked = getMemberEffectiveChecked(perm.code);
                      const source = getMemberPermSource(perm.code);
                      return (
                        <label
                          key={perm.code}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[color:var(--bg-page)] cursor-pointer transition"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMemberPermission(perm.code)}
                            className="w-4 h-4 shrink-0 rounded border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] text-[color:var(--accent)] focus:ring-[color:var(--accent)]/40"
                          />
                          <span className="flex-1 min-w-0">
                            <span className="text-sm text-[color:var(--text-primary)]">{perm.label}</span>
                            <span className="ml-2 text-xs text-[color:var(--text-muted)] font-mono">{perm.code}</span>
                          </span>
                          {source === 'granted' && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 shrink-0">+ extra</span>
                          )}
                          {source === 'revoked' && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 shrink-0">revoked</span>
                          )}
                          {source === 'role' && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[color:var(--bg-page)] text-[color:var(--text-muted)] shrink-0">role</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 pb-6 pt-4 border-t border-[color:var(--border-subtle)] shrink-0 flex gap-3">
              {memberEditTab === 'details' ? (
                <>
                  <button
                    type="submit"
                    form="member-details-form"
                    disabled={memberEditSubmitting}
                    className="btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                  >
                    {memberEditSubmitting ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => !memberEditSubmitting && setEditMember(null)}
                    disabled={memberEditSubmitting}
                    className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] disabled:opacity-50"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleSaveMemberPermissions}
                    disabled={memberPermSaving}
                    className="btn-primary px-4 py-2 rounded-lg text-sm disabled:opacity-50"
                  >
                    {memberPermSaving ? 'Saving…' : 'Save permissions'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMemberPermGranted(editMember.permissionOverrides?.granted ?? []);
                      setMemberPermRevoked(editMember.permissionOverrides?.revoked ?? []);
                    }}
                    disabled={memberPermSaving}
                    className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] disabled:opacity-50"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditMember(null)}
                    disabled={memberPermSaving}
                    className="px-4 py-2 rounded-lg border border-[color:var(--border-subtle)] text-sm text-[color:var(--text-muted)] hover:bg-[color:var(--bg-page)] disabled:opacity-50"
                  >
                    Close
                  </button>
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
