import { describe, expect, it } from 'vitest';
import { createFakeWorld } from '../../test/support/fakeClaude.js';
import { DEFAULT_WAIT_TIMEOUT_SEC } from '../config/defaults.js';
import type { RawAgent } from '../types/agent.js';
import { isMet, runWait, statusOf } from './wait.js';
import { makeAgent } from '../../test/support/agents.js';

/** 止まったセッション（pid と status が無い）。 */
const finished = (name: string): RawAgent => ({
  kind: 'background',
  id: `${name}-id`,
  sessionId: `${name}-session`,
  name,
  cwd: '',
  startedAt: 1,
  state: 'done',
});

const raw = (name: string, overrides: Partial<RawAgent> = {}): RawAgent => ({
  kind: 'background',
  id: `${name}-id`,
  sessionId: `${name}-session`,
  name,
  cwd: '',
  startedAt: 1,
  state: 'working',
  status: 'busy',
  pid: 1,
  ...overrides,
});

describe('statusOf', () => {
  it('承認待ち・入力待ちを waitingFor で見分ける', () => {
    expect(statusOf(makeAgent({ name: 'a', state: 'blocked' }))).toBe('approval');
    expect(statusOf(makeAgent({ name: 'a', state: 'waiting', waitingFor: 'input needed' }))).toBe('input');
    expect(statusOf(makeAgent({ name: 'a', state: 'waiting', waitingFor: 'permission prompt' }))).toBe('approval');
    expect(statusOf(makeAgent({ name: 'a', state: 'done' }))).toBe('done');
    expect(statusOf(undefined)).toBe('missing');
  });
});

describe('isMet', () => {
  it('attention は誰か 1 人、idle は全員が手を止めたら、done は全員が終わったら', () => {
    expect(isMet('attention', ['working', 'input'])).toBe(true);
    expect(isMet('idle', ['working', 'input'])).toBe(false);
    expect(isMet('idle', ['approval', 'input'])).toBe(true);
    expect(isMet('done', ['approval', 'done'])).toBe(false);
    expect(isMet('done', ['done', 'stopped', 'missing'])).toBe(true);
  });
});

describe('runWait', () => {
  it('誰かが承認待ちになったら、誰が何のために止まったかを返す', async () => {
    const w = createFakeWorld({ agents: [raw('tests'), raw('readme')] });
    let ticks = 0;
    const outcome = await runWait(
      { names: ['tests', 'readme'] },
      {
        ...w.deps,
        sleep: async (ms) => {
          await w.deps.sleep(ms);
          ticks += 1;
          if (ticks === 2) {
            w.agents[0] = raw('tests', { state: 'blocked', status: 'waiting', waitingFor: 'permission prompt' });
          }
        },
      },
    );
    expect(outcome.ok && outcome.value).toMatchObject({
      until: 'attention',
      met: true,
      timedOut: false,
      elapsedMs: 6000,
      sessions: [
        { name: 'tests', status: 'approval' },
        { name: 'readme', status: 'working' },
      ],
    });
    expect(outcome.ok && outcome.text).toContain('tests: 承認待ち');
  });

  it('時間切れは失敗ではなく timedOut で返す', async () => {
    const w = createFakeWorld({ agents: [raw('tests')] });
    const outcome = await runWait({ names: ['tests'], timeoutSec: 9 }, w.deps);
    expect(outcome.ok && outcome.value).toMatchObject({ met: false, timedOut: true, elapsedMs: 9000 });
  });

  it('既定の時間切れは Bash の既定（2 分）より短い', () => {
    expect(DEFAULT_WAIT_TIMEOUT_SEC).toBeLessThan(120);
  });

  it('一覧から消えたものは終わったとみなす（done）', async () => {
    const w = createFakeWorld({ agents: [finished('tests'), raw('readme')] });
    const outcome = await runWait(
      { names: ['tests', 'readme'], until: 'done' },
      {
        ...w.deps,
        sleep: async (ms) => {
          await w.deps.sleep(ms);
          w.agents.splice(1, 1);
        },
      },
    );
    expect(outcome.ok && outcome.value.sessions.map((s) => s.status)).toEqual(['done', 'missing']);
  });

  it('知らない名前・曖昧な名前はエラー', async () => {
    const w = createFakeWorld({ agents: [raw('tests'), raw('tests-e2e')] });
    expect(await runWait({ names: ['nothing'] }, w.deps)).toMatchObject({ ok: false, error: { kind: 'not-found' } });
    expect(await runWait({ names: ['test'] }, w.deps)).toMatchObject({ ok: false, error: { kind: 'ambiguous' } });
  });

  it('引数のまちがいは使い方のエラー', async () => {
    const w = createFakeWorld({ agents: [raw('tests')] });
    expect(await runWait({ names: [] }, w.deps)).toMatchObject({ ok: false, error: { kind: 'usage' } });
    expect(await runWait({ names: ['tests'], timeoutSec: -1 }, w.deps)).toMatchObject({ ok: false, error: { kind: 'usage' } });
  });
});
