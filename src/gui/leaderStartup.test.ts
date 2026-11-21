import { describe, expect, it } from 'vitest';
import { failure, success, type Outcome } from '../commands/outcome.js';
import type { StartResult } from '../commands/start.js';
import { createLeaderStartup } from './leaderStartup.js';

const result = (action: StartResult['action']): StartResult => ({
  action,
  leader: { name: 'cuse-leader', shortId: 'x', sessionId: 's', cwd: '/w', permissionMode: null },
  skill: { path: '/p', status: 'unchanged' },
});

describe('createLeaderStartup', () => {
  it('はじめは起動中、終わったら結果になる。置き場所は runStart に任せる', async () => {
    const starts: (string | undefined)[] = [];
    const changes: string[] = [];
    const startup = createLeaderStartup(
      async (cwd) => {
        starts.push(cwd);
        return success(result('started'), 'ok', ['warn']);
      },
      (status) => changes.push(status.kind),
    );
    expect(startup.status()).toEqual({ kind: 'starting' });
    expect(await startup.ensure()).toEqual({ kind: 'ready', action: 'started', warnings: ['warn'] });
    expect(starts).toEqual([undefined]);
    expect(changes).toEqual(['starting', 'ready']);
  });

  it('選んだフォルダで起こし、以後もそのフォルダを使う', async () => {
    const starts: (string | undefined)[] = [];
    const startup = createLeaderStartup(async (cwd) => {
      starts.push(cwd);
      return success(result('started'), 'ok');
    });
    await startup.ensure('/Users/u/picked');
    await startup.ensure();
    expect(starts).toEqual(['/Users/u/picked', '/Users/u/picked']);
  });

  it('信頼されていないフォルダで断られたら、そのフォルダを持つ', async () => {
    const startup = createLeaderStartup(
      async (): Promise<Outcome<StartResult>> =>
        failure({ kind: 'untrusted', message: '初回だけ信頼してください', folder: '/Users/u/.cuse/leader' }),
    );
    expect(await startup.ensure()).toEqual({
      kind: 'failed',
      message: '初回だけ信頼してください',
      untrustedFolder: '/Users/u/.cuse/leader',
    });
  });

  it('ほかの失敗はフォルダを持たない。例外も失敗として扱う', async () => {
    const version = createLeaderStartup(
      async (): Promise<Outcome<StartResult>> => failure({ kind: 'version', message: '古い' }),
    );
    expect(await version.ensure()).toEqual({ kind: 'failed', message: '古い', untrustedFolder: null });
    const thrown = createLeaderStartup(async () => {
      throw new Error('boom');
    });
    expect((await thrown.ensure()).kind).toBe('failed');
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
    const second = startup.ensure('/Users/u/other');
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
  });
});
