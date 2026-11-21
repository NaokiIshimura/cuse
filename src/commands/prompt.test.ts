import { describe, expect, it } from 'vitest';
import { bgCalls, createFakeWorld } from '../../test/support/fakeClaude.js';
import { makeLeader, makeLedger, makeWorker } from '../../test/support/ledger.js';
import { MAX_PROMPTS_PER_WORKER } from '../config/defaults.js';
import { hashLeaderToken, LEADER_TOKEN_ENV } from '../core/leaderToken.js';
import type { RawAgent } from '../types/agent.js';
import { runPrompt } from './prompt.js';

const TOKEN = 't';

const world = (agent: RawAgent, promptCount = 0) =>
  createFakeWorld({
    agents: [agent],
    ledger: makeLedger({
      leader: makeLeader({ tokenHash: hashLeaderToken(TOKEN), permissionMode: 'auto' }),
      workers: [
        makeWorker({ name: 'tests', shortId: 'old1', sessionId: 'tests-session', cwd: '/w', promptCount }),
      ],
    }),
    env: { [LEADER_TOKEN_ENV]: TOKEN },
  });

const stopped: RawAgent = {
  kind: 'background',
  id: 'old1',
  sessionId: 'tests-session',
  name: 'tests',
  cwd: '/w',
  startedAt: 1,
  state: 'done',
};

const running: RawAgent = { ...stopped, state: 'working', status: 'busy', pid: 42 };

describe('runPrompt', () => {
  it('止まった配下は claude --resume <sessionId> --bg で続きを頼む', async () => {
    const w = world(stopped);
    const outcome = await runPrompt({ name: 'tests', message: '続きをお願い' }, w.deps);
    expect(outcome.ok && outcome.value).toMatchObject({
      delivered: true,
      via: 'resume',
      shortId: '0001beef',
      sessionId: 'tests-session',
      copied: false,
      promptCount: 1,
    });
    const [call] = bgCalls(w);
    expect(call?.args.slice(0, 5)).toEqual(['--resume', 'tests-session', '--bg', '--permission-mode', 'auto']);
    expect(call?.args.at(-1)).toBe('続きをお願い');
    expect(call?.cwd).toBe('/w');
    expect(call?.env).toEqual({});
    expect(w.ledger.workers[0]).toMatchObject({ shortId: '0001beef', promptCount: 1, endedAt: null });
  });

  it('会話が写されて新しい ID になったら、台帳の sessionId も変える', async () => {
    const w = world(stopped);
    w.resumeCopies = true;
    const outcome = await runPrompt({ name: 'tests', message: 'x' }, w.deps);
    expect(outcome.ok && outcome.value).toMatchObject({ copied: true });
    expect(w.ledger.workers[0]?.sessionId).toBe('0001beef-0000-4000-8000-000000000000');
  });

  it('動いている配下には送らず、SendMessage で送るよう返す（回数には数える）', async () => {
    const w = world(running);
    const outcome = await runPrompt({ name: 'tests', message: 'x' }, w.deps);
    expect(outcome.ok && outcome.value).toEqual({
      delivered: false,
      via: 'SendMessage',
      to: 'tests',
      name: 'tests',
      promptCount: 1,
    });
    expect(bgCalls(w)).toEqual([]);
    expect(w.ledger.workers[0]?.promptCount).toBe(1);
  });

  it('回数の上限に達したら断る', async () => {
    const w = world(stopped, MAX_PROMPTS_PER_WORKER);
    const outcome = await runPrompt({ name: 'tests', message: 'x' }, w.deps);
    expect(!outcome.ok && outcome.error.kind).toBe('limit');
  });

  it('台帳に無いセッションは指せない', async () => {
    const w = world(stopped);
    const outcome = await runPrompt({ name: 'hand', message: 'x' }, w.deps);
    expect(!outcome.ok && outcome.error.kind).toBe('not-found');
  });

  it('指揮役でなければ断る', async () => {
    const w = createFakeWorld({ agents: [stopped], ledger: makeLedger({ leader: makeLeader(), workers: [makeWorker({ name: 'tests' })] }) });
    const outcome = await runPrompt({ name: 'tests', message: 'x' }, w.deps);
    expect(!outcome.ok && outcome.error.kind).toBe('denied');
  });

  it('片付けた配下には続きを頼まない（claude は呼ばない）', async () => {
    const w = world(stopped);
    w.ledger = {
      ...w.ledger,
      workers: w.ledger.workers.map((worker) => ({ ...worker, cleanedAt: '2026-11-20T00:00:00.000Z' })),
    };
    const outcome = await runPrompt({ name: 'tests', message: 'x' }, w.deps);
    expect(!outcome.ok && outcome.error.kind).toBe('conflict');
    expect(bgCalls(w)).toEqual([]);
  });

  it('同じ名前の片付けた配下があっても、片付けていない方に決まる', async () => {
    const w = world(stopped);
    w.ledger = {
      ...w.ledger,
      workers: [
        makeWorker({ name: 'tests', shortId: 'gone', sessionId: 'gone-session', cleanedAt: '2026-11-20T00:00:00.000Z' }),
        ...w.ledger.workers,
      ],
    };
    const outcome = await runPrompt({ name: 'tests', message: 'x' }, w.deps);
    expect(outcome.ok && outcome.value).toMatchObject({ delivered: true, sessionId: 'tests-session' });
  });
});
