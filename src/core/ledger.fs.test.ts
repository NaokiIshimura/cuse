import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { updateLedger } from './ledger.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('updateLedger（本物のファイル）', () => {
  it('同時に書いても記録が消えない', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cuse-ledger-'));
    dirs.push(home);
    const names = Array.from({ length: 8 }, (_, index) => `w${index}`);
    await Promise.all(
      names.map((name) =>
        updateLedger(
          (ledger) => ({
            ...ledger,
            workers: [
              ...ledger.workers,
              {
                name,
                shortId: null,
                sessionId: `${name}-session`,
                task: '',
                cwd: '',
                worktree: null,
                startedAt: '',
                endedAt: null,
                endReason: null,
                promptCount: 0,
                cleanedAt: null,
              },
            ],
          }),
          { home },
        ),
      ),
    );
    const saved = JSON.parse(await readFile(join(home, '.cuse', 'ledger.json'), 'utf8'));
    expect(saved.workers.map((w: { name: string }) => w.name).sort()).toEqual(names);
    // 一時ファイルもロックも残さない
    expect(await readdir(join(home, '.cuse'))).toEqual(['ledger.json']);
  });
});
