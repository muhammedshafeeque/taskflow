import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AppUpdate, UPDATE_TYPES, type AppUpdateType } from './appUpdate.model';

export interface ParsedUpdateEntry {
  updateId: string;
  date: string;
  type: AppUpdateType;
  title: string;
  details: string;
  contentHash: string;
}

export interface UpdatesSyncSummary {
  inserted: number;
  updated: number;
  skipped: number;
}

const VALID_TYPES = new Set<string>(UPDATE_TYPES);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UPDATE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function isValidCalendarDate(dateStr: string): boolean {
  if (!DATE_RE.test(dateStr)) return false;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Stable SHA-256 digest of the user-facing fields used to detect edits. */
export function computeUpdateContentHash(type: string, title: string, details: string): string {
  return crypto.createHash('sha256').update(`${type}\n${title}\n${details}`).digest('hex');
}

export function resolveUpdatesFilePath(explicitPath?: string): string {
  if (explicitPath) return explicitPath;
  const cwdCandidate = path.resolve(process.cwd(), 'updates.txt');
  if (fs.existsSync(cwdCandidate)) return cwdCandidate;
  return path.resolve(__dirname, '../../../updates.txt');
}

/** Parse updates.txt content into validated entries, skipping comments, blanks, malformed lines, and duplicate IDs. */
export function parseUpdatesContent(content: string): { entries: ParsedUpdateEntry[]; skipped: number } {
  const lines = content.split(/\r?\n/);
  const entries: ParsedUpdateEntry[] = [];
  const seenIds = new Set<string>();
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = lines[i].split('|').map((part) => part.trim());
    if (parts.length !== 5) {
      console.warn(`[updates] Line ${lineNum}: expected 5 pipe-separated fields, got ${parts.length}; skipping.`);
      skipped++;
      continue;
    }

    const [updateId, date, rawType, title, details] = parts;
    const type = rawType.toLowerCase();

    if (!UPDATE_ID_RE.test(updateId)) {
      console.warn(`[updates] Line ${lineNum}: invalid UPDATE_ID "${updateId}"; skipping.`);
      skipped++;
      continue;
    }
    if (!isValidCalendarDate(date)) {
      console.warn(`[updates] Line ${lineNum}: invalid DATE "${date}" (expected YYYY-MM-DD); skipping.`);
      skipped++;
      continue;
    }
    if (!VALID_TYPES.has(type)) {
      console.warn(`[updates] Line ${lineNum}: invalid TYPE "${rawType}"; skipping.`);
      skipped++;
      continue;
    }
    if (!title || !details) {
      console.warn(`[updates] Line ${lineNum}: TITLE and DETAILS must not be empty; skipping.`);
      skipped++;
      continue;
    }
    if (seenIds.has(updateId)) {
      console.warn(`[updates] Line ${lineNum}: duplicate UPDATE_ID "${updateId}"; keeping first occurrence and skipping.`);
      skipped++;
      continue;
    }

    seenIds.add(updateId);
    const typed = type as AppUpdateType;
    entries.push({
      updateId,
      date,
      type: typed,
      title,
      details,
      contentHash: computeUpdateContentHash(typed, title, details),
    });
  }

  return { entries, skipped };
}

async function upsertSingleUpdate(entry: ParsedUpdateEntry): Promise<'inserted' | 'updated' | 'skipped'> {
  const existing = await AppUpdate.findOne({ updateId: entry.updateId }).select('contentHash').lean();

  if (!existing) {
    try {
      const res = await AppUpdate.updateOne(
        { updateId: entry.updateId },
        { $setOnInsert: entry },
        { upsert: true }
      );
      if (res.upsertedCount > 0) {
        return 'inserted';
      }
    } catch (err: unknown) {
      if ((err as { code?: number })?.code !== 11000) throw err;
    }
    // Another instance inserted this updateId concurrently; update if content changed.
    const concurrentUpdate = await AppUpdate.updateOne(
      { updateId: entry.updateId, contentHash: { $ne: entry.contentHash } },
      { $set: { date: entry.date, type: entry.type, title: entry.title, details: entry.details, contentHash: entry.contentHash } }
    );
    return concurrentUpdate.modifiedCount > 0 ? 'updated' : 'skipped';
  }

  if (existing.contentHash !== entry.contentHash) {
    await AppUpdate.updateOne(
      { updateId: entry.updateId, contentHash: { $ne: entry.contentHash } },
      { $set: { date: entry.date, type: entry.type, title: entry.title, details: entry.details, contentHash: entry.contentHash } }
    );
    return 'updated';
  }

  return 'skipped';
}

/** Syncs updates.txt into app_updates on startup without resetting user acknowledgements or removing old rows. */
export async function syncUpdatesFromFile(explicitPath?: string): Promise<UpdatesSyncSummary> {
  const filePath = resolveUpdatesFilePath(explicitPath);
  if (!fs.existsSync(filePath)) {
    console.warn(`[updates] Changelog file not found at ${filePath}; skipping sync.`);
    return { inserted: 0, updated: 0, skipped: 0 };
  }

  const content = await fs.promises.readFile(filePath, 'utf8');
  const { entries, skipped: parseSkipped } = parseUpdatesContent(content);

  let inserted = 0;
  let updated = 0;
  let skipped = parseSkipped;

  for (const entry of entries) {
    const outcome = await upsertSingleUpdate(entry);
    if (outcome === 'inserted') inserted++;
    else if (outcome === 'updated') updated++;
    else skipped++;
  }

  console.log(`[updates] Sync complete: ${inserted} inserted, ${updated} updated, ${skipped} skipped`);
  return { inserted, updated, skipped };
}
