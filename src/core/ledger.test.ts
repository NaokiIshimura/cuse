import { describe, expect, it } from 'vitest';
import { parseLedger, readLedger } from './ledger.js';

const worker = {
  name: 'tests',
  shortId: 'a1b2c3',
  sessionId: 'session-tests',
  task: 'テストの追加',
  cwd: '/work/app',
  worktree: '/work/app/.claude/worktrees/tests',
  startedAt: '2026-11-21T09:00:00Z',
  endedAt: null,
  endReason: null,
  promptCount: 0,
};

describe('parseLedger', () => {
  it('引継書の例の形を読める', () => {
    const result = parseLedger({
      version: 1,
      leader: { sessionId: 'session-leader', name: 'cuse-leader', startedAt: '2026-11-21T09:00:00Z' },
      workers: [worker],
    });
    expect(result).toEqual({
      kind: 'ok',
      ledger: {
        version: 1,
        leader: { sessionId: 'session-leader', name: 'cuse-leader', startedAt: '2026-11-21T09:00:00Z' },
        workers: [worker],
      },
    });
  });

  it('sessionId の無い配下は突き合わせられないので捨てる', () => {
    const result = parseLedger({ version: 1, workers: [{ name: 'x' }, worker] });
    expect(result.kind === 'ok' && result.ledger.workers.map((w) => w.name)).toEqual(['tests']);
  });

  it('知らない項目は無視する', () => {
    const result = parseLedger({ version: 1, workers: [], extra: true });
    expect(result).toEqual({ kind: 'ok', ledger: { version: 1, leader: null, workers: [] } });
  });

  it('新しすぎる version は読まない', () => {
    expect(parseLedger({ version: 2, workers: [] }).kind).toBe('invalid');
  });

  it('version が無ければ invalid', () => {
    expect(parseLedger({ workers: [] }).kind).toBe('invalid');
    expect(parseLedger([]).kind).toBe('invalid');
  });
});

describe('readLedger', () => {
  it('~/.cuse/ledger.json を読む', async () => {
    const paths: string[] = [];
    const result = await readLedger({
      home: '/home/u',
      read: async (path) => {
        paths.push(path);
        return JSON.stringify({ version: 1, workers: [] });
      },
    });
    expect(paths).toEqual(['/home/u/.cuse/ledger.json']);
    expect(result.kind).toBe('ok');
  });

  it('ファイルが無ければ missing', async () => {
    const result = await readLedger({
      home: '/home/u',
      read: async () => {
        throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
      },
    });
    expect(result).toEqual({ kind: 'missing' });
  });

  it('壊れた JSON は invalid', async () => {
    const result = await readLedger({ home: '/home/u', read: async () => '{' });
    expect(result.kind).toBe('invalid');
  });
});
