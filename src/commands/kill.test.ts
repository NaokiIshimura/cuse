import { describe, expect, it } from 'vitest';
import { createFakeWorld } from '../../test/support/fakeClaude.js';
import { makeLeader, makeLedger, makeWorker } from '../../test/support/ledger.js';
import { hashLeaderToken, LEADER_TOKEN_ENV } from '../core/leaderToken.js';
import { runKill } from './kill.js';

const TOKEN = 't';

const world = (env: NodeJS.ProcessEnv = { [LEADER_TOKEN_ENV]: TOKEN }) =>
  createFakeWorld({
    agents: [
      { kind: 'background', id: 'tid', sessionId: 'tests-session', name: 'tests', cwd: '', startedAt: 1, state: 'working', status: 'busy', pid: 1 },
      { kind: 'background', id: 'hid', sessionId: 'hand-session', name: 'hand', cwd: '', startedAt: 1, state: 'working', status: 'busy', pid: 2 },
    ],
    ledger: makeLedger({
      leader: makeLeader({ tokenHash: hashLeaderToken(TOKEN) }),
      workers: [makeWorker({ name: 'tests', shortId: 'tid', sessionId: 'tests-session' })],
    }),
    env,
  });

const stopCalls = (w: ReturnType<typeof world>) =>
  w.calls.filter((call) => call.args[0] === 'stop').map((call) => call.args);

describe('runKill', () => {
  it('claude stop で止め、理由を台帳に残す（消さない）', async () => {
    const w = world();
    const outcome = await runKill({ name: 'tests', reason: '方針が変わった' }, w.deps);
    expect(outcome.ok && outcome.value).toEqual({
      name: 'tests',
      shortId: 'tid',
      reason: '方針が変わった',
      endedAt: '2026-11-21T09:00:00.000Z',
    });
    expect(stopCalls(w)).toEqual([['stop', 'tid']]);
    expect(w.ledger.workers[0]).toMatchObject({ endedAt: '2026-11-21T09:00:00.000Z', endReason: '方針が変わった' });
    expect(w.calls.some((call) => call.args[0] === 'rm')).toBe(false);
  });

  it('台帳に無いセッション（人が動かしているもの）は止めない', async () => {
    const w = world();
    const outcome = await runKill({ name: 'hand', reason: 'x' }, w.deps);
    expect(!outcome.ok && outcome.error.kind).toBe('not-found');
    expect(stopCalls(w)).toEqual([]);
  });

  it('理由が無ければ使い方のエラー', async () => {
    const outcome = await runKill({ name: 'tests', reason: ' ' }, world().deps);
    expect(!outcome.ok && outcome.error.kind).toBe('usage');
  });

  it('指揮役でなければ断る', async () => {
    const w = world({});
    const outcome = await runKill({ name: 'tests', reason: 'x' }, w.deps);
    expect(!outcome.ok && outcome.error.kind).toBe('denied');
    expect(stopCalls(w)).toEqual([]);
  });

  it('人の操作（GUI）はトークンなしで止められる。台帳の配下に限るのは同じ', async () => {
    const w = world({});
    expect((await runKill({ name: 'tests', reason: '人が止めた', byHuman: true }, w.deps)).ok).toBe(true);
    const other = await runKill({ name: 'hand', reason: 'x', byHuman: true }, w.deps);
    expect(other.ok).toBe(false);
  });

  it('ウィンドウから止めるときは sessionId の完全一致だけで決める（前方一致で別の配下を止めない）', async () => {
    const w = world({});
    const partial = await runKill({ name: 'tests', sessionId: 'tests', reason: 'x', byHuman: true }, w.deps);
    expect(!partial.ok && partial.error.kind).toBe('not-found');
    const other = await runKill({ name: 'hand-session', sessionId: 'hand-session', reason: 'x', byHuman: true }, w.deps);
    expect(!other.ok && other.error.kind).toBe('not-found');
    expect(stopCalls(w)).toEqual([]);
    const exact = await runKill({ name: 'tests-session', sessionId: 'tests-session', reason: 'x', byHuman: true }, w.deps);
    expect(exact.ok).toBe(true);
    expect(stopCalls(w)).toEqual([['stop', 'tid']]);
  });
});
