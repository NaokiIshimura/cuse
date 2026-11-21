import { describe, expect, it } from 'vitest';
import { bgCalls, createFakeWorld } from '../../test/support/fakeClaude.js';
import { makeLeader, makeLedger, makeWorker } from '../../test/support/ledger.js';
import { hashLeaderToken, LEADER_TOKEN_ENV } from '../core/leaderToken.js';
import { runSpawn } from './spawn.js';

const TOKEN = 'leader-token';

/** 指揮役として呼ぶ世界。 */
const leaderWorld = (options: Parameters<typeof createFakeWorld>[0] = {}) =>
  createFakeWorld({
    ledger: makeLedger({
      leader: makeLeader({ tokenHash: hashLeaderToken(TOKEN), permissionMode: 'acceptEdits' }),
    }),
    env: { [LEADER_TOKEN_ENV]: TOKEN, PATH: '/bin' },
    ...options,
  });

describe('runSpawn', () => {
  it('claude --bg --name で起動し、台帳に記録する', async () => {
    const world = leaderWorld();
    const outcome = await runSpawn({ task: 'テストを追加して', name: 'tests' }, world.deps);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toMatchObject({
      name: 'tests',
      renamed: false,
      shortId: '0001beef',
      sessionId: '0001beef-0000-4000-8000-000000000000',
      cwd: '/Users/example/project',
      gitRepository: true,
    });
    expect(world.ledger.workers).toEqual([
      {
        name: 'tests',
        shortId: '0001beef',
        sessionId: '0001beef-0000-4000-8000-000000000000',
        task: 'テストを追加して',
        cwd: '/Users/example/project',
        worktree: null,
        startedAt: '2026-11-21T09:00:00.000Z',
        endedAt: null,
        endReason: null,
        promptCount: 0,
        cleanedAt: null,
      },
    ]);
  });

  it('指揮役と同じ権限モードで、配下の心得を付けて起動する', async () => {
    const world = leaderWorld();
    await runSpawn({ task: 'タスク', name: 'tests', agent: 'reviewer', model: 'sonnet' }, world.deps);
    const [call] = bgCalls(world);
    expect(call?.args.slice(0, 9)).toEqual([
      '--bg',
      '--name',
      'tests',
      '--permission-mode',
      'acceptEdits',
      '--agent',
      'reviewer',
      '--model',
      'sonnet',
    ]);
    expect(call?.args).toContain('--append-system-prompt');
    expect(call?.args.at(-1)).toBe('タスク');
    expect(call?.args.join(' ')).not.toContain('dangerously');
  });

  it('指揮役のトークンを配下に渡さない', async () => {
    const world = leaderWorld();
    await runSpawn({ task: 'タスク', name: 'tests' }, world.deps);
    const [call] = bgCalls(world);
    expect(call?.env).toEqual({ PATH: '/bin' });
  });

  it('--cwd は呼び出し元からの相対パスも受ける', async () => {
    const world = leaderWorld();
    const outcome = await runSpawn({ task: 't', name: 'tests', cwd: '../other' }, world.deps);
    expect(outcome.ok && outcome.value.cwd).toBe('/Users/example/other');
    expect(bgCalls(world)[0]?.cwd).toBe('/Users/example/other');
  });

  it('指揮役の居場所（~/.cuse）では配下を起こさない（--cwd を求める）', async () => {
    const world = leaderWorld({ cwd: '/Users/example/.cuse/leader' });
    const outcome = await runSpawn({ task: 't', name: 'tests' }, world.deps);
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'usage' } });
    expect(!outcome.ok && outcome.error.message).toContain('--cwd');
    expect(bgCalls(world)).toEqual([]);
    const withCwd = await runSpawn({ task: 't', name: 'tests', cwd: '/Users/example/work/app' }, world.deps);
    expect(withCwd.ok).toBe(true);
  });

  it('git リポジトリでなければ警告を返す（起動はする）', async () => {
    const world = leaderWorld();
    world.nonRepositories.add('/Users/example/project');
    const outcome = await runSpawn({ task: 't', name: 'tests' }, world.deps);
    expect(outcome.ok).toBe(true);
    expect(outcome.warnings[0]).toContain('git リポジトリではありません');
  });

  it('同名の生きたセッションがあれば、変えられた名前を記録する', async () => {
    const world = leaderWorld({
      agents: [
        { kind: 'interactive', sessionId: 'hand', name: 'tests', cwd: '/w', startedAt: 1, status: 'busy', pid: 1 },
      ],
    });
    const outcome = await runSpawn({ task: 't', name: 'tests' }, world.deps);
    expect(outcome.ok && outcome.value).toMatchObject({ name: 'tests (2)', renamed: true });
    expect(outcome.ok && outcome.text).toContain('tests (2)');
    expect(world.ledger.workers[0]?.name).toBe('tests (2)');
  });

  it('指揮役でなければ断る（claude は呼ばない）', async () => {
    const world = leaderWorld({ env: {} });
    const outcome = await runSpawn({ task: 't', name: 'tests' }, world.deps);
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.error.kind).toBe('denied');
    expect(bgCalls(world)).toEqual([]);
  });

  it('同時に動かせる数の上限を超えたら断る', async () => {
    const world = leaderWorld();
    for (const name of ['a', 'b', 'c']) {
      expect((await runSpawn({ task: 't', name }, world.deps)).ok).toBe(true);
    }
    const outcome = await runSpawn({ task: 't', name: 'd' }, world.deps);
    expect(!outcome.ok && outcome.error.kind).toBe('limit');
    expect(bgCalls(world)).toHaveLength(3);
  });

  it('止まった配下は数に入れない', async () => {
    const world = leaderWorld({
      agents: [
        { kind: 'background', id: 'a-id', sessionId: 'a-session', name: 'a', cwd: '', startedAt: 1, state: 'done' },
        { kind: 'background', id: 'b-id', sessionId: 'b-session', name: 'b', cwd: '', startedAt: 1, state: 'stopped' },
        { kind: 'background', id: 'c-id', sessionId: 'c-session', name: 'c', cwd: '', startedAt: 1, state: 'done' },
      ],
    });
    world.ledger = { ...world.ledger, workers: ['a', 'b', 'c'].map((name) => makeWorker({ name })) };
    const outcome = await runSpawn({ task: 't', name: 'd' }, world.deps);
    expect(outcome.ok).toBe(true);
  });

  it('同じ名前の配下が動いていれば断る', async () => {
    const world = leaderWorld();
    await runSpawn({ task: 't', name: 'tests' }, world.deps);
    const outcome = await runSpawn({ task: 't', name: 'tests' }, world.deps);
    expect(!outcome.ok && outcome.error.kind).toBe('conflict');
  });

  it('使えない名前・空のタスクは使い方のエラー', async () => {
    const world = leaderWorld();
    expect(await runSpawn({ task: 't', name: 'has space' }, world.deps)).toMatchObject({
      ok: false,
      error: { kind: 'usage' },
    });
    expect(await runSpawn({ task: ' ', name: 'tests' }, world.deps)).toMatchObject({
      ok: false,
      error: { kind: 'usage' },
    });
  });
});
