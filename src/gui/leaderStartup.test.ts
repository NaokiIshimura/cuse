import { describe, expect, it } from 'vitest';
import { failure, success } from '../commands/outcome.js';
import type { StartResult } from '../commands/start.js';
import { createLeaderStartup, startupCwd } from './leaderStartup.js';

const result = (action: StartResult['action']): StartResult => ({
  action,
  leader: { name: 'cuse-leader', shortId: 'x', sessionId: 's', cwd: '/w', permissionMode: null },
  skill: { path: '/p', status: 'unchanged' },
});

describe('startupCwd', () => {
  it('.app を Finder から開いたとき（/）はホーム、端末からならそのディレクトリ', () => {
    expect(startupCwd('/', '/Users/u')).toBe('/Users/u');
    expect(startupCwd('', '/Users/u')).toBe('/Users/u');
    expect(startupCwd('/Users/u/repo', '/Users/u')).toBe('/Users/u/repo');
  });
});

describe('createLeaderStartup', () => {
  it('はじめは起動中、終わったら結果になる', async () => {
    const changes: string[] = [];
    const startup = createLeaderStartup(
      async () => success(result('started'), 'ok', ['warn']),
      (status) => changes.push(status.kind),
    );
    expect(startup.status()).toEqual({ kind: 'starting' });
    expect(await startup.ensure()).toEqual({ kind: 'ready', action: 'started', warnings: ['warn'] });
    expect(changes).toEqual(['starting', 'ready']);
  });

  it('失敗は理由を持つ', async () => {
    const startup = createLeaderStartup(async () =>
      failure({ kind: 'version', message: 'Claude Code が古い' }),
    );
    expect(await startup.ensure()).toEqual({ kind: 'failed', message: 'Claude Code が古い' });
  });

  it('例外も失敗として扱う', async () => {
    const startup = createLeaderStartup(async () => {
      throw new Error('boom');
    });
    expect((await startup.ensure()).kind).toBe('failed');
  });

  it('走っている間に頼まれても重ねて走らせない（指揮役を 2 人起こさない）', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const startup = createLeaderStartup(async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return success(result('started'), 'ok');
    });
    const first = startup.ensure();
    const second = startup.ensure();
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);

    // 終わった後なら、もう一度走らせられる（「もう一度」ボタン）
    const third = startup.ensure();
    release();
    await third;
    expect(calls).toBe(2);
  });
});
