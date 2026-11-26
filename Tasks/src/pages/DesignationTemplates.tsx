import { CrudPage, type Row } from '../components/CrudPage';
import { ALL_PROJECT_PERMISSIONS } from '@shared/constants/permissions';
import { ALL_PROJECT_PERMISSIONS_LIST } from '../lib/projectPermissionList';

const LABELS = new Map<string, string>(ALL_PROJECT_PERMISSIONS_LIST.map((p) => [p.code, p.label]));
const label = (code: string) =>
  LABELS.get(code) ??
  code
    .split('.')
    .slice(-2)
    .map((w) => w.replace(/_/g, ' '))
    .reverse()
    .join(' ')
    .replace(/^\w/, (c) => c.toUpperCase());
const PERMISSION_OPTIONS = ALL_PROJECT_PERMISSIONS.map((code) => ({ value: code, label: label(code) }));

/** Company-wide project designations: copied into new projects, and suggested when inviting people. */
export default function DesignationTemplates() {
  return (
    <CrudPage
      title="Designation templates"
      subtitle="Company-wide project roles (Dev Lead, QA, Intern…). New projects get the ticked ones; inviting someone suggests one from their HR job title, department or level. Projects keep their own copy, so editing a template does not change existing projects."
      endpoint="/project-designation-templates"
      managePermissions={['project.designation.create', 'project.designation.update', 'project.designation.delete']}
      createLabel="New template"
      emptyText="No templates. Add one, e.g. “QA Engineer” for job titles containing “qa” or “test”."
      columns={[
        { header: 'Designation', render: (r: Row) => <span className="font-medium">{String(r.name)}</span> },
        { header: 'Suggested for', render: (r: Row) => [...((r.levels as string[]) ?? []).map((l) => `level ${l}`), ...((r.keywords as string[]) ?? []).map((k) => `“${k}”`)].join(', ') || '—' },
        { header: 'Permissions', render: (r: Row) => String(((r.permissions as string[]) ?? []).length) },
        { header: 'New projects', render: (r: Row) => (r.active === false ? 'Off' : r.addToNewProjects ? 'Added' : 'Optional') },
      ]}
      fields={[
        { key: 'name', label: 'Name', required: true, placeholder: 'e.g. QA Engineer' },
        { key: 'description', label: 'Description', type: 'textarea' },
        { key: 'levels', label: 'Suggest for levels', type: 'list', help: 'Employee levels from HR settings, comma separated (e.g. Senior). Used when the job title matches nothing.' },
        { key: 'keywords', label: 'Suggest for job titles containing', type: 'list', help: 'Comma separated words matched against the HR job title and department (e.g. qa, test). The longest match wins.' },
        { key: 'permissions', label: 'Project permissions', type: 'multiselect', options: PERMISSION_OPTIONS },
        { key: 'addToNewProjects', label: 'Add to new projects by default', type: 'checkbox', defaultValue: true },
        { key: 'active', label: 'Active', type: 'checkbox', defaultValue: true },
      ]}
    />
  );
}
