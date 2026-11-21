import { describe, expect, it } from 'vitest';
import { failure, success, type Outcome } from '../commands/outcome.js';
import type { StartResult } from '../commands/start.js';
import { createLeaderStartup, startupCwd, type LeaderStartupOptions } from './leaderStartup.js';

const result = (action: StartResult['action']): StartResult => ({
  action,
  leader: { name: 'cuse-leader', shortId: 'x', sessionId: 's', cwd: '/w', permissionMode: null },
  skill: { path: '/p', status: 'unchanged' },
});

const setup = (overrides: Partial<LeaderStartupOptions> = {}) => {
  const starts: (string | undefined)[] = [];
  const changes: string[] = [];
  const startup = createLeaderStartup({
    start: async (cwd) => {
      starts.push(cwd);
      return success(result('started'), 'ok');
    },
    hasLeader: async () => false,
    initialCwd: '/Users/u/repo',
    onChange: (status) => changes.push(status.kind),
    ...overrides,
  });
  return { startup, starts, changes };
};

describe('startupCwd', () => {
  it('Finder から開いたとき（/）とホームは使わない。端末からならそのディレクトリ', () => {
    expect(startupCwd('/', '/Users/u')).toBeNull();
    expect(startupCwd('', '/Users/u')).toBeNull();
    expect(startupCwd('/Users/u', '/Users/u')).toBeNull();
    expect(startupCwd('/Users/u/repo', '/Users/u')).toBe('/Users/u/repo');
  });
});

describe('createLeaderStartup', () => {
  it('はじめは起動中、終わったら結果になる', async () => {
    const { startup, starts, changes } = setup();
    expect(startup.status()).toEqual({ kind: 'starting' });
    expect(await startup.ensure()).toEqual({ kind: 'ready', action: 'started', warnings: [] });
    expect(starts).toEqual(['/Users/u/repo']);
    expect(changes).toEqual(['starting', 'ready']);
  });

  it('指揮役がいなくて置き場所も決まっていなければ、起こさずにフォルダを選んでもらう', async () => {
    const { startup, starts } = setup({ initialCwd: null });
    expect(await startup.ensure()).toEqual({ kind: 'needs-folder' });
    expect(starts).toEqual([]);
  });

  it('選んだフォルダで起こす', async () => {
    const { startup, starts } = setup({ initialCwd: null });
    await startup.ensure();
    expect((await startup.ensure('/Users/u/picked')).kind).toBe('ready');
    expect(starts).toEqual(['/Users/u/picked']);
  });

  it('台帳に指揮役がいれば、置き場所が決まっていなくてもそろえる（台帳の場所で再開する）', async () => {
    const { startup, starts } = setup({ initialCwd: null, hasLeader: async () => true });
    expect((await startup.ensure()).kind).toBe('ready');
    expect(starts).toEqual([undefined]);
  });

  it('失敗は理由を持ち、信頼されていないフォルダかどうかを見分ける', async () => {
    const untrusted = setup({
      start: async (): Promise<Outcome<StartResult>> => failure({ kind: 'untrusted', message: '信頼されていません' }),
    });
    expect(await untrusted.startup.ensure()).toEqual({ kind: 'failed', message: '信頼されていません', untrusted: true });
    const other = setup({
      start: async (): Promise<Outcome<StartResult>> => failure({ kind: 'version', message: '古い' }),
    });
    expect(await other.startup.ensure()).toEqual({ kind: 'failed', message: '古い', untrusted: false });
  });

  it('例外も失敗として扱う', async () => {
    const { startup } = setup({
      start: async () => {
        throw new Error('boom');
      },
    });
    expect((await startup.ensure()).kind).toBe('failed');
  });

  it('走っている間に頼まれても重ねて走らせない（指揮役を 2 人起こさない）', async () => {
    let release: () => void = () => undefined;
    const { startup, starts } = setup({
      start: async (cwd) => {
        starts.push(cwd);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return success(result('started'), 'ok');
      },
    });
    const first = startup.ensure();
    const second = startup.ensure('/Users/u/other');
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([first, second]);
    expect(starts).toEqual(['/Users/u/repo']);
  });
});
