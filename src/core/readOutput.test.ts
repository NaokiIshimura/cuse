import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readLastReport, readLogs, readTail, tailLines } from './readOutput.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('readTail', () => {
  it('末尾だけを読み、途中で切れた先頭行は捨てる', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cuse-'));
    dirs.push(dir);
    const path = join(dir, 'a.jsonl');
    await writeFile(path, 'first line\nsecond\nthird\n');
    expect(await readTail(path, 13)).toBe('third\n');
    expect(await readTail(path, 1000)).toBe('first line\nsecond\nthird\n');
  });
});

describe('readLastReport', () => {
  it('~/.claude/projects の transcript から最後の発言を読む', async () => {
    const paths: string[] = [];
    const report = await readLastReport(
      { cwd: '/w/app', sessionId: 's1' },
      {
        home: '/h',
        read: async (path) => {
          paths.push(path);
          return JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '完了' }] } });
        },
      },
    );
    expect(paths).toEqual(['/h/.claude/projects/-w-app/s1.jsonl']);
    expect(report).toBe('完了');
  });

  it('読めなければ null', async () => {
    const report = await readLastReport(
      { cwd: '/w/app', sessionId: 's1' },
      {
        home: '/h',
        read: async () => {
          throw new Error('ENOENT');
        },
      },
    );
    expect(report).toBeNull();
  });
});

describe('tailLines', () => {
  it('末尾 N 行。末尾の改行は数えない', () => {
    expect(tailLines('a\nb\nc\n\n', 2)).toEqual(['b', 'c']);
    expect(tailLines('', 5)).toEqual([]);
    expect(tailLines('a\nb', 0)).toEqual([]);
  });
});

describe('readLogs', () => {
  it('短縮 ID で claude logs を呼ぶ', async () => {
    const calls: string[][] = [];
    const result = await readLogs(
      { kind: 'background', id: 'abcd1234' },
      {
        lines: 2,
        runner: async (command, args) => {
          calls.push([command, ...args]);
          return '1\n2\n3\n';
        },
      },
    );
    expect(calls).toEqual([['claude', 'logs', 'abcd1234']]);
    expect(result).toEqual({ ok: true, lines: ['2', '3'] });
  });

  it('interactive セッションは呼ばずに理由を返す', async () => {
    const result = await readLogs(
      { kind: 'interactive', id: undefined },
      {
        lines: 2,
        runner: async () => {
          throw new Error('呼ばれないはず');
        },
      },
    );
    expect(result.ok).toBe(false);
  });

  it('失敗は理由にして返す', async () => {
    const result = await readLogs(
      { kind: 'background', id: 'x' },
      {
        lines: 2,
        runner: async () => {
          throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
        },
      },
    );
    expect(result).toEqual({
      ok: false,
      message: 'claude コマンドが見つかりません。PATH を確認してください。',
    });
  });
});
