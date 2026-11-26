import fs from 'fs';
import os from 'os';
import path from 'path';
import { AppUpdate } from './appUpdate.model';
import {
  computeUpdateContentHash,
  parseUpdatesContent,
  syncUpdatesFromFile,
} from './updates.sync';

describe('updates.sync unit tests', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('parseUpdatesContent', () => {
    it('ignores comments and blank lines and parses valid entries', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const content = [
        '# Header comment',
        '',
        '   # Indented comment',
        'UPD-0001 | 2026-11-26 | feature | New Modal | First point ; Second point',
        'UPD-0002 | 2026-11-27 | FIX | Bug Squashed | Fixed crash on load',
      ].join('\n');

      const { entries, skipped } = parseUpdatesContent(content);

      expect(warnSpy).not.toHaveBeenCalled();
      expect(skipped).toBe(0);
      expect(entries).toHaveLength(2);
      expect(entries[0]).toEqual({
        updateId: 'UPD-0001',
        date: '2026-11-26',
        type: 'feature',
        title: 'New Modal',
        details: 'First point ; Second point',
        contentHash: computeUpdateContentHash('feature', 'New Modal', 'First point ; Second point'),
      });
      expect(entries[1].type).toBe('fix');
    });

    it('skips malformed lines with line-numbered warnings and keeps first duplicate ID', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const content = [
        'UPD-0001 | 2026-11-26 | feature | First | Valid one',
        'bad line without pipes',
        'BAD ID | 2026-11-26 | feature | Title | Details',
        'UPD-0002 | 2026-02-30 | feature | Bad Date | Details',
        'UPD-0003 | 2026-11-26 | unknown_type | Bad Type | Details',
        'UPD-0004 | 2026-11-26 | fix | | Missing title',
        'UPD-0001 | 2026-11-28 | fix | Duplicate | Should be skipped',
      ].join('\n');

      const { entries, skipped } = parseUpdatesContent(content);

      expect(entries).toHaveLength(1);
      expect(entries[0].title).toBe('First');
      expect(skipped).toBe(6);
      expect(warnSpy).toHaveBeenCalledTimes(6);
      expect(warnSpy.mock.calls[0][0]).toContain('Line 2');
      expect(warnSpy.mock.calls[5][0]).toContain('Line 7');
      expect(warnSpy.mock.calls[5][0]).toContain('UPD-0001');
    });
  });

  describe('syncUpdatesFromFile', () => {
    it('warns and continues when updates.txt is missing', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const missingPath = path.join(os.tmpdir(), `nonexistent-updates-${Date.now()}.txt`);

      const summary = await syncUpdatesFromFile(missingPath);

      expect(summary).toEqual({ inserted: 0, updated: 0, skipped: 0 });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('inserts, updates on hash change, skips unchanged, and handles E11000 races', async () => {
      const tmpFile = path.join(os.tmpdir(), `updates-test-${Date.now()}.txt`);
      fs.writeFileSync(
        tmpFile,
        [
          'UPD-0001 | 2026-11-26 | feature | New Feature | Point A',
          'UPD-0002 | 2026-11-26 | fix | Edited Fix | New detail',
          'UPD-0003 | 2026-11-26 | other | Same Update | Unchanged',
          'UPD-0004 | 2026-11-26 | security | Concurrent Insert | Race test',
        ].join('\n'),
        'utf8'
      );

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const hash3 = computeUpdateContentHash('other', 'Same Update', 'Unchanged');

      const findOneMock = jest
        .spyOn(AppUpdate, 'findOne')
        .mockImplementation(((query: { updateId: string }) => ({
          select: () => ({
            lean: async () => {
              if (query.updateId === 'UPD-0002') return { contentHash: 'stale-hash' };
              if (query.updateId === 'UPD-0003') return { contentHash: hash3 };
              return null;
            },
          }),
        })) as never);

      const updateOneMock = jest
        .spyOn(AppUpdate, 'updateOne')
        .mockImplementation((async (filter: { updateId: string; contentHash?: unknown }) => {
          if (filter.updateId === 'UPD-0001') {
            return { upsertedCount: 1, modifiedCount: 0 };
          }
          if (filter.updateId === 'UPD-0002') {
            return { upsertedCount: 0, modifiedCount: 1 };
          }
          if (filter.updateId === 'UPD-0004' && !filter.contentHash) {
            const dupErr = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
            throw dupErr;
          }
          return { upsertedCount: 0, modifiedCount: 0 };
        }) as never);

      try {
        const summary = await syncUpdatesFromFile(tmpFile);
        expect(findOneMock).toHaveBeenCalledTimes(4);
        expect(updateOneMock).toHaveBeenCalled();
        expect(summary).toEqual({ inserted: 1, updated: 1, skipped: 2 });
        expect(logSpy).toHaveBeenCalledWith(
          '[updates] Sync complete: 1 inserted, 1 updated, 2 skipped'
        );
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });
  });
});
