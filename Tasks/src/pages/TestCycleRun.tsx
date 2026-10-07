import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  api,
  testPlansApi,
  projectsApi,
  type CycleRunItem,
  type TestRunStatus,
  type Project,
} from '../lib/api';

const STATUS_OPTIONS: { value: TestRunStatus; label: string; color: string }[] = [
  { value: 'pending', label: 'Pending', color: 'text-[color:var(--text-muted)]' },
  { value: 'pass', label: 'Pass', color: 'text-green-600' },
  { value: 'fail', label: 'Fail', color: 'text-red-600' },
  { value: 'blocked', label: 'Blocked', color: 'text-amber-600' },
  { value: 'skip', label: 'Skip', color: 'text-[color:var(--text-muted)]' },
];

export default function TestCycleRunPage() {
  const { projectId, planId, cycleId } = useParams<{ projectId: string; planId: string; cycleId: string }>();
  const { token } = useAuth();
  const [project, setProject] = useState<Project | null>(null);
  const [runs, setRuns] = useState<CycleRunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [resultByCase, setResultByCase] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!token || !projectId) return;
    projectsApi.get(projectId, token).then((res) => {
      if (res.success && res.data) setProject(res.data);
    });
  }, [token, projectId]);

  useEffect(() => {
    if (!token || !projectId || !planId || !cycleId) return;
    setLoading(true);
    testPlansApi.getCycleRuns(projectId, planId, cycleId, token).then((res) => {
      setLoading(false);
      if (res.success && res.data) setRuns(Array.isArray(res.data) ? res.data : []);
    });
  }, [token, projectId, planId, cycleId]);

  async function handleStatusChange(testCaseId: string, status: TestRunStatus, result?: string) {
    if (!token || !projectId || !planId || !cycleId) return;
    const resultVal = result ?? resultByCase[testCaseId] ?? undefined;
    setUpdating(testCaseId);
    const res = await testPlansApi.updateRunStatus(
      projectId,
      planId,
      cycleId,
      testCaseId,
      { status, result: resultVal },
      token
    );
    setUpdating(null);
    if (res.success) {
      setRuns((prev) =>
        prev.map((r) =>
          r.testCase._id === testCaseId
            ? { ...r, run: { ...r.run, status, result: resultVal, executedAt: new Date().toISOString() } }
            : r
        )
      );
      setResultByCase((prev) => {
        const next = { ...prev };
        delete next[testCaseId];
        return next;
      });
    }
  }

  if (!projectId || !planId || !cycleId) return null;

  const passCount = runs.filter((r) => r.run.status === 'pass').length;
  const failCount = runs.filter((r) => r.run.status === 'fail').length;
  const pendingCount = runs.filter((r) => r.run.status === 'pending').length;

  return (
    <div className="flex-1 min-h-0 flex flex-col p-6">
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <div>
          <Link
            to={`/projects/${projectId}/test-plans`}
            className="text-xs text-[color:var(--accent)] hover:underline mb-1 inline-block"
          >
            ← Back to test plans
          </Link>
          <h1 className="text-lg font-semibold text-[color:var(--text-primary)]">
            Run cycle {project ? `· ${project.name}` : ''}
          </h1>
        </div>
        <div className="flex gap-4 text-sm items-center">
          <label className="cursor-pointer text-xs text-[color:var(--accent)] hover:underline" title="Import results from a CI JUnit XML report (Jest, pytest, JUnit, Playwright, Cypress…)">
            Import JUnit XML
            <input
              type="file"
              accept=".xml,application/xml,text/xml"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file || !token || !projectId || !planId || !cycleId) return;
                const r = await api.post<{ total: number; pass: number; fail: number; skip: number; created: number }>(
                  `/projects/${projectId}/test-plans/${planId}/cycles/${cycleId}/junit`,
                  { xml: await file.text() },
                  token
                );
                e.target.value = '';
                if (!r.success || !r.data) return alert(r.message);
                alert(`Imported ${r.data.total} results: ${r.data.pass} pass, ${r.data.fail} fail, ${r.data.skip} skipped (${r.data.created} new cases).`);
                window.location.reload();
              }}
            />
          </label>
          <span className="text-green-600">Pass: {passCount}</span>
          <span className="text-red-600">Fail: {failCount}</span>
          <span className="text-[color:var(--text-muted)]">Pending: {pendingCount}</span>
        </div>
      </div>

      <div className="rounded-2xl bg-[color:var(--bg-surface)] border border-[color:var(--border-subtle)] overflow-hidden">
        <div className="p-6 border-b border-[color:var(--border-subtle)]">
          <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">Test cases</h2>
          <p className="text-[color:var(--text-muted)] text-xs mt-0.5">
            Record pass/fail/skip for each test case.
          </p>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-6 text-[color:var(--text-muted)] animate-pulse">Loading…</div>
          ) : runs.length === 0 ? (
            <div className="p-8 text-center text-[color:var(--text-muted)] text-xs">
              No test cases in this plan.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[color:var(--border-subtle)]">
                  <th className="text-left px-4 py-3 text-xs font-medium text-[color:var(--text-muted)]">Test case</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[color:var(--text-muted)]">Steps</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[color:var(--text-muted)]">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-[color:var(--text-muted)]">Result</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(({ testCase, run }) => (
                  <tr key={testCase._id} className="border-b border-[color:var(--border-subtle)]/70 hover:bg-[color:var(--bg-elevated)]">
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-[color:var(--text-primary)]">{testCase.title}</span>
                        {testCase.linkedIssueId && (
                          <Link
                            to={`/projects/${projectId}/issues/${encodeURIComponent(testCase.linkedIssueId.key)}`}
                            className="text-xs text-[color:var(--accent)] hover:underline"
                          >
                            {testCase.linkedIssueId.key}
                          </Link>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[color:var(--text-muted)] max-w-xs truncate">
                      {testCase.steps || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {STATUS_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            disabled={updating === testCase._id}
                            onClick={() => handleStatusChange(testCase._id, opt.value)}
                            className={`px-2 py-0.5 rounded text-xs border font-medium ${
                              run.status === opt.value
                                ? 'border-[color:var(--accent)] bg-[color:var(--accent)]/20 text-[color:var(--accent)]'
                                : 'border-[color:var(--border-subtle)] hover:bg-[color:var(--bg-elevated)]'
                            } ${opt.color}`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {run.status === 'fail' || run.status === 'blocked' ? (
                        <input
                          type="text"
                          placeholder="Result / notes"
                          value={resultByCase[testCase._id] ?? run.result ?? ''}
                          onChange={(e) =>
                            setResultByCase((prev) => ({ ...prev, [testCase._id]: e.target.value }))
                          }
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== (run.result ?? '')) {
                              handleStatusChange(testCase._id, run.status, v);
                            }
                          }}
                          className="px-2 py-1 rounded text-xs w-40 border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]"
                        />
                      ) : (
                        <span className="text-xs text-[color:var(--text-muted)]">{run.result || '—'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
