import { describe, expect, it } from 'vitest';
import { bgCalls, createFakeWorld } from '../../test/support/fakeClaude.js';
import { makeLeader, makeLedger, makeWorker } from '../../test/support/ledger.js';
import { hashLeaderToken, LEADER_TOKEN_ENV } from '../core/leaderToken.js';
import type { RawAgent } from '../types/agent.js';
import { skillPath } from './installSkill.js';
import { runStart } from './start.js';

const leaderAgent = (overrides: Partial<RawAgent> = {}): RawAgent => ({
  kind: 'background',
  id: 'leader01',
  sessionId: 'leader-session',
  name: 'cuse-leader',
  cwd: '/Users/example/project',
  startedAt: 1,
  state: 'working',
  status: 'idle',
  pid: 7,
  ...overrides,
});

/** トークンを --settings の JSON から取り出す。 */
const tokenOf = (args: readonly string[]): string => {
  const index = args.indexOf('--settings');
  return (JSON.parse(args[index + 1] ?? '{}') as { env: Record<string, string> }).env[LEADER_TOKEN_ENV] ?? '';
};

describe('runStart', () => {
  it('指揮役がいなければ、編集系ツールを外し心得とトークンを渡して起動する', async () => {
    const w = createFakeWorld({ env: { PATH: '/bin' } });
    const outcome = await runStart({ permissionMode: 'acceptEdits' }, w.deps);

    expect(outcome.ok && outcome.value).toMatchObject({
      action: 'started',
      leader: { name: 'cuse-leader', shortId: '0001beef', cwd: '/Users/example/project', permissionMode: 'acceptEdits' },
      skill: { status: 'installed' },
    });
    const [call] = bgCalls(w);
    const args = call?.args ?? [];
    expect(args.slice(0, 5)).toEqual(['--bg', '--name', 'cuse-leader', '--permission-mode', 'acceptEdits']);
    const toolsAt = args.indexOf('--disallowedTools');
    expect(args.slice(toolsAt + 1, toolsAt + 4)).toEqual(['Edit', 'Write', 'NotebookEdit']);
    expect(args[toolsAt + 4]).toBe('--append-system-prompt');
    expect(args[toolsAt + 5]).toContain('cuse 指揮役の心得');

    // トークンは環境変数でだけ渡し、台帳にはハッシュだけを残す
    const token = tokenOf(args);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(call?.env).toEqual({ PATH: '/bin', [LEADER_TOKEN_ENV]: token });
    expect(w.ledger.leader).toMatchObject({
      name: 'cuse-leader',
      shortId: '0001beef',
      tokenHash: hashLeaderToken(token),
      permissionMode: 'acceptEdits',
    });
    expect(JSON.stringify(w.ledger)).not.toContain(token);

    // cuse スキルを置く
    expect(w.files.get(skillPath('/Users/example'))).toContain('name: cuse');
  });

  it('指揮役が動いていれば 2 人目を起こさない', async () => {
    const w = createFakeWorld({
      agents: [leaderAgent()],
      ledger: makeLedger({ leader: makeLeader() }),
    });
    const outcome = await runStart({}, w.deps);
    expect(outcome.ok && outcome.value.action).toBe('opened');
    expect(bgCalls(w)).toEqual([]);
  });

  it('止まっていれば claude --resume で同じ会話を再開し、トークンを作り直す', async () => {
    const w = createFakeWorld({
      agents: [leaderAgent({ state: 'stopped', status: 'idle' })].map(({ pid: _pid, ...rest }) => rest),
      ledger: makeLedger({
        leader: makeLeader({ permissionMode: 'auto', tokenHash: 'old', cwd: '/w' }),
        workers: [makeWorker({ name: 'tests' })],
      }),
    });
    const outcome = await runStart({}, w.deps);
    expect(outcome.ok && outcome.value.action).toBe('resumed');
    const [call] = bgCalls(w);
    expect(call?.args.slice(0, 5)).toEqual(['--resume', 'leader-session', '--bg', '--permission-mode', 'auto']);
    expect(call?.cwd).toBe('/w');
    expect(w.ledger.leader?.tokenHash).toBe(hashLeaderToken(tokenOf(call?.args ?? [])));
    expect(w.ledger.leader?.shortId).toBe('0001beef');
    // 配下はそのまま
    expect(w.ledger.workers.map((worker) => worker.name)).toEqual(['tests']);
  });

  it('--new なら前の指揮役を止めて作り直す（配下は引き継ぐ）', async () => {
    const w = createFakeWorld({
      agents: [leaderAgent()],
      ledger: makeLedger({ leader: makeLeader(), workers: [makeWorker({ name: 'tests' })] }),
    });
    const outcome = await runStart({ new: true }, w.deps);
    expect(outcome.ok && outcome.value.action).toBe('recreated');
    expect(w.calls.filter((call) => call.args[0] === 'stop').map((call) => call.args)).toEqual([['stop', 'leader01']]);
    expect(bgCalls(w)[0]?.args.slice(0, 3)).toEqual(['--bg', '--name', 'cuse-leader']);
    expect(w.ledger.workers.map((worker) => worker.name)).toEqual(['tests']);
  });

  it('Claude Code が cross-session messaging より古ければ断る', async () => {
    const w = createFakeWorld();
    w.version = '2.1.200';
    const outcome = await runStart({}, w.deps);
    expect(!outcome.ok && outcome.error.kind).toBe('version');
    expect(bgCalls(w)).toEqual([]);
  });

  it('権限確認を飛ばすモードは受け付けない', async () => {
    const w = createFakeWorld();
    const outcome = await runStart({ permissionMode: 'bypassPermissions' }, w.deps);
    expect(!outcome.ok && outcome.error.kind).toBe('usage');
  });

  it('人が書き換えたスキルは上書きせず、警告だけ出す', async () => {
    const w = createFakeWorld();
    w.files.set(skillPath('/Users/example'), '自分で書いた内容');
    const outcome = await runStart({}, w.deps);
    expect(outcome.ok).toBe(true);
    expect(outcome.warnings[0]).toContain('--force');
    expect(w.files.get(skillPath('/Users/example'))).toBe('自分で書いた内容');
  });
});
