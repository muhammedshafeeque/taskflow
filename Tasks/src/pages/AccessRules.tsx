import { CrudPage, type Row } from '../components/CrudPage';

/** Team and level rules: roles people get on top of their own, from their team and seniority. */
export default function AccessRules() {
  return (
    <CrudPage
      title="Team & level rules"
      subtitle="People in a team and/or at a level get these roles on top of their own role. Team leads can get extra roles. Changes apply within a minute."
      endpoint="/roles/access-rules"
      managePermissions={['auth.role.manage_all']}
      createLabel="New rule"
      emptyText="No rules yet. Example: team “Sales”, level “Senior” → role “Sales Senior”."
      columns={[
        { header: 'Rule', render: (r: Row) => <span className="font-medium">{String(r.name)}</span> },
        { header: 'Team', render: (r: Row) => String(r.teamName ?? 'Any team') },
        { header: 'Level', render: (r: Row) => String(r.level ?? 'Any level') },
        { header: 'Who', render: (r: Row) => (r.leadsOnly ? 'Team leads' : 'Everyone matching') },
        { header: 'Gives roles', render: (r: Row) => ((r.roleNames as string[]) ?? []).join(', ') },
        { header: 'People now', render: (r: Row) => String(r.active === false ? 'off' : (r.people ?? 0)) },
      ]}
      fields={[
        { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Sales seniors' },
        { key: 'teamId', label: 'Team', type: 'select', optionsFrom: { endpoint: '/resources/teams', value: 'id', label: 'name' }, help: 'Leave empty for any team.' },
        { key: 'level', label: 'Level', placeholder: 'e.g. Senior', help: 'As set on the employee; the choices are in HR settings. Leave empty for any level.' },
        { key: 'leadsOnly', label: 'Team leads only', type: 'checkbox' },
        { key: 'roleIds', label: 'Roles to give', type: 'multiselect', required: true, optionsFrom: { endpoint: '/roles', label: 'name' } },
        { key: 'active', label: 'Active', type: 'checkbox', defaultValue: true },
      ]}
    />
  );
}
