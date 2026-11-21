import { describe, expect, it } from 'vitest';
import {
  activeLedgerWorkers,
  emptyLedger,
  parseLedger,
  readLedger,
  updateLedger,
  type LedgerFileSystem,
} from './ledger.js';

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
  cleanedAt: null,
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
        leader: {
          sessionId: 'session-leader',
          name: 'cuse-leader',
          startedAt: '2026-11-21T09:00:00Z',
          shortId: null,
          cwd: '',
          permissionMode: null,
          tokenHash: null,
        },
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

/** メモリ上の偽のファイルシステム。書いた内容と、ロックの取り外しを記録する。 */
const memoryFs = (initial?: string) => {
  const files = new Map<string, string>();
  if (initial !== undefined) {
    files.set('/home/u/.cuse/ledger.json', initial);
  }
  const events: string[] = [];
  const fs: LedgerFileSystem = {
    read: async (path) => {
      const value = files.get(path);
      if (value === undefined) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
      return value;
    },
    writeAtomic: async (path, data) => {
      events.push('write');
      files.set(path, data);
    },
    lock: async () => {
      events.push('lock');
      return async () => {
        events.push('unlock');
      };
    },
  };
  return { fs, files, events };
};

describe('updateLedger', () => {
  it('台帳が無ければ空から作り、ロックの中で書く', async () => {
    const { fs, files, events } = memoryFs();
    const next = await updateLedger(
      (ledger) => ({ ...ledger, workers: [...ledger.workers, worker] }),
      { home: '/home/u', fs },
    );
    expect(next.workers).toEqual([worker]);
    expect(JSON.parse(files.get('/home/u/.cuse/ledger.json') ?? '')).toEqual(next);
    expect(events).toEqual(['lock', 'write', 'unlock']);
  });

  it('壊れた台帳は上書きせず例外にする（ロックは外す）', async () => {
    const { fs, files, events } = memoryFs('{');
    await expect(updateLedger((ledger) => ledger, { home: '/home/u', fs })).rejects.toThrow(
      '台帳を書き換えられません',
    );
    expect(files.get('/home/u/.cuse/ledger.json')).toBe('{');
    expect(events).toEqual(['lock', 'unlock']);
  });
});

describe('activeLedgerWorkers', () => {
  it('終わっていない配下だけを返す', () => {
    const ledger = {
      ...emptyLedger(),
      workers: [worker, { ...worker, name: 'old', endedAt: '2026-11-21T10:00:00Z' }],
    };
    expect(activeLedgerWorkers(ledger).map((w) => w.name)).toEqual(['tests']);
  });
});
