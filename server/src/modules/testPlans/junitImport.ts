import mongoose from 'mongoose';
import { TestCycle } from './testCycle.model';
import { TestPlan } from './testPlan.model';
import { TestRun, type TestRunStatus } from './testRun.model';
import { TestCase } from '../testCases/testCase.model';
import { ApiError } from '../../utils/ApiError';

export type JUnitCase = { name: string; classname?: string; status: Exclude<TestRunStatus, 'pending' | 'blocked'>; message?: string; timeSec?: number };

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`));
  return m ? decode(m[2] ?? m[3] ?? '') : undefined;
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

/** Minimal JUnit XML reader (Jest, pytest, JUnit, Playwright, Cypress reporters). */
export function parseJUnit(xml: string): JUnitCase[] {
  const out: JUnitCase[] = [];
  const rx = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(xml))) {
    const head = `<testcase ${m[1]}>`;
    const inner = m[3] ?? '';
    const name = attr(head, 'name');
    if (!name) continue;
    const failure = inner.match(/<(failure|error)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/);
    const skipped = /<skipped\b/.test(inner);
    const message = failure ? attr(`<x ${failure[2]}>`, 'message') ?? decode((failure[4] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '')).trim().slice(0, 2000) : undefined;
    const time = Number(attr(head, 'time'));
    out.push({
      name,
      classname: attr(head, 'classname'),
      status: failure ? 'fail' : skipped ? 'skip' : 'pass',
      message: message || undefined,
      timeSec: Number.isFinite(time) ? time : undefined,
    });
  }
  return out;
}

/**
 * Record a CI run into a test cycle. Cases are matched by title
 * ("classname › name" or just name); missing ones are created as automated
 * cases unless createMissing=false.
 */
export async function importJUnit(
  projectId: string,
  planId: string,
  cycleId: string,
  xml: string,
  opts: { createMissing?: boolean; actorId?: string } = {}
) {
  const plan = await TestPlan.findOne({ _id: planId, project: projectId }).lean();
  if (!plan) throw new ApiError(404, 'Test plan not found');
  const cycle = await TestCycle.findOne({ _id: cycleId, testPlan: planId });
  if (!cycle) throw new ApiError(404, 'Test cycle not found');
  const cases = parseJUnit(xml);
  if (!cases.length) throw new ApiError(400, 'No <testcase> elements found');

  const existing = await TestCase.find({ project: projectId }).select('_id title').lean();
  const byTitle = new Map(existing.map((c) => [c.title.trim().toLowerCase(), c._id as mongoose.Types.ObjectId]));
  const summary = { total: cases.length, pass: 0, fail: 0, skip: 0, created: 0, unmatched: 0 };
  for (const c of cases) {
    const full = c.classname ? `${c.classname} › ${c.name}` : c.name;
    let caseId = byTitle.get(full.toLowerCase()) ?? byTitle.get(c.name.toLowerCase());
    if (!caseId) {
      if (opts.createMissing === false) {
        summary.unmatched++;
        continue;
      }
      const created = await TestCase.create({ project: projectId, title: full.slice(0, 500), type: 'automated', status: 'active' });
      caseId = created._id as mongoose.Types.ObjectId;
      byTitle.set(full.toLowerCase(), caseId);
      summary.created++;
    }
    summary[c.status]++;
    const result = [c.message, c.timeSec !== undefined ? `(${c.timeSec}s)` : ''].filter(Boolean).join(' ') || undefined;
    await TestRun.updateOne(
      { testCycle: cycle._id, testCase: caseId },
      { $set: { status: c.status, result, executedAt: new Date(), ...(opts.actorId ? { assignee: opts.actorId } : {}) } },
      { upsert: true }
    );
  }
  if (cycle.status === 'draft') {
    cycle.status = 'in_progress';
    await cycle.save();
  }
  return summary;
}
