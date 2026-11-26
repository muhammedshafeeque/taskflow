import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { hrmsApi, type HrmsEmployee } from '../../lib/api';
import { SectionPage } from '../../components/moduleKit';
import { ModuleLoader } from '../../components/loaders/ModuleLoader';
import { buildOrgTree, type OrgNode } from './orgTree';

function Branch({ node }: { node: OrgNode<HrmsEmployee> }) {
  const [open, setOpen] = useState(true);
  const { person, reports, total } = node;
  return (
    <li>
      <div className="flex items-center gap-2 rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2 w-fit min-w-[16rem]">
        <div className="min-w-0 flex-1">
          <Link to={`/employees/${person._id}`} className="text-sm font-medium hover:underline">
            {person.name}
          </Link>
          <p className="text-[11px] text-[color:var(--text-muted)]">{[person.designation, person.department].filter(Boolean).join(' · ') || '—'}</p>
        </div>
        {reports.length > 0 && (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} people under ${person.name}`}
            onClick={() => setOpen(!open)}
            className="rounded-full px-2 py-0.5 text-[11px] bg-[color:var(--bg-elevated)] text-[color:var(--text-muted)]"
          >
            {total} {open ? '−' : '+'}
          </button>
        )}
      </div>
      {open && reports.length > 0 && (
        <ul className="mt-2 ml-4 pl-4 space-y-2 border-l border-[color:var(--border-subtle)]">
          {reports.map((r) => (
            <Branch key={r.person._id} node={r} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Who reports to whom. */
export default function OrgChart() {
  const { token } = useAuth();
  const [rows, setRows] = useState<HrmsEmployee[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!token) return;
    let live = true;
    void hrmsApi.listEmployees(token).then((r) => {
      if (!live) return;
      if (r.success && r.data) setRows(r.data);
      else setError(r.message ?? 'Could not load employees');
    });
    return () => {
      live = false;
    };
  }, [token]);
  const tree = useMemo(() => buildOrgTree(rows ?? []), [rows]);

  return (
    <SectionPage title="Org chart" subtitle="Who reports to whom. Set it with “Reports to” on an employee.">
      {error ? (
        <p className="text-sm text-rose-500">{error}</p>
      ) : !rows ? (
        <ModuleLoader size="block" label="Loading org chart…" />
      ) : tree.length === 0 ? (
        <p className="text-sm text-[color:var(--text-muted)]">No employees yet.</p>
      ) : (
        <ul className="space-y-3 overflow-x-auto">
          {tree.map((n) => (
            <Branch key={n.person._id} node={n} />
          ))}
        </ul>
      )}
    </SectionPage>
  );
}
