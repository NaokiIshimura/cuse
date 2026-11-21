import { describe, expect, it } from 'vitest';
import type { ReadLedgerResult } from '../core/ledger.js';
import { makeAgent } from '../../test/support/agents.js';
import { buildAgentsOutput, formatAgentsText, formatTable } from './agents.js';

const ledgerWith = (...sessionIds: string[]): ReadLedgerResult => ({
  kind: 'ok',
  ledger: {
    version: 1,
    leader: { sessionId: 'leader-session', name: 'cuse-leader', startedAt: '' },
    workers: sessionIds.map((sessionId) => ({
      name: sessionId,
      shortId: null,
      sessionId,
      task: `${sessionId} のタスク`,
      cwd: '',
      worktree: null,
      startedAt: '',
      endedAt: null,
      endReason: null,
      promptCount: 0,
    })),
  },
});

const agents = [
  makeAgent({ name: 'cuse-leader', sessionId: 'leader-session', state: 'waiting' }),
  makeAgent({ name: 'tests', sessionId: 'tests-session', state: 'working' }),
  makeAgent({
    name: 'readme',
    sessionId: 'readme-session',
    state: 'blocked',
    meta: {
      lastPrompt: 'README を更新して',
      tokens: { used: 50_000, limit: 200_000, ratio: 0.25 },
      subagents: [],
      pendingTool: { name: 'Bash', detail: 'npm test' },
    },
  }),
  makeAgent({ name: 'hand', sessionId: 'hand-session', kind: 'interactive', id: undefined }),
];

describe('buildAgentsOutput', () => {
  it('既定は台帳に載った配下だけを、承認待ちを先頭に並べる', () => {
    const output = buildAgentsOutput(agents, ledgerWith('tests-session', 'readme-session'), {
      all: false,
      now: 61_000,
    });
    expect(output.scope).toBe('workers');
    expect(output.agents.map((view) => view.name)).toEqual(['readme', 'tests']);
    expect(output.agents[0]).toMatchObject({
      role: 'worker',
      waitingFor: 'approval',
      pendingTool: { name: 'Bash', detail: 'npm test' },
      lastPrompt: 'README を更新して',
      context: { used: 50_000, limit: 200_000, ratio: 0.25 },
      task: 'readme-session のタスク',
      elapsedMs: 60_000,
      startedAt: new Date(1_000).toISOString(),
    });
  });

  it('台帳が無ければ空（第 1 段階の普通の状態）', () => {
    const output = buildAgentsOutput(agents, { kind: 'missing' }, { all: false, now: 0 });
    expect(output).toEqual({ scope: 'workers', ledger: 'missing', agents: [] });
  });

  it('--all で全セッション。役割で指揮役・配下・それ以外を見分ける', () => {
    const output = buildAgentsOutput(agents, ledgerWith('tests-session'), { all: true, now: 0 });
    const roles = Object.fromEntries(output.agents.map((view) => [view.name, view.role]));
    expect(roles).toEqual({
      'cuse-leader': 'leader',
      tests: 'worker',
      readme: 'other',
      hand: 'other',
    });
  });

  it('値が無い項目は省かず null にする', () => {
    const output = buildAgentsOutput(agents, { kind: 'missing' }, { all: true, now: 0 });
    const hand = output.agents.find((view) => view.name === 'hand');
    expect(hand).toMatchObject({
      shortId: null,
      pendingTool: null,
      lastPrompt: null,
      context: null,
      task: null,
      waitingFor: null,
    });
  });
});

describe('formatAgentsText', () => {
  it('台帳が無いときは --all を案内する', () => {
    expect(formatAgentsText({ scope: 'workers', ledger: 'missing', agents: [] })).toContain(
      'cuse agents --all',
    );
  });

  it('1 セッション 1 行の表にする', () => {
    const text = formatAgentsText(
      buildAgentsOutput(agents, ledgerWith('tests-session'), { all: true, now: 61_000 }),
    );
    const lines = text.split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^名前\s+状態\s+待ち\s+経過\s+ctx\s+説明$/);
    expect(lines[1]).toContain('readme');
    expect(lines[1]).toContain('承認待ち');
    expect(lines[1]).toContain('Bash: npm test');
    expect(text).toContain('cuse-leader [指揮役]');
  });
});

describe('formatTable', () => {
  it('全角文字を 2 桁と数えて列を揃える', () => {
    expect(formatTable([['名前', 'x'], ['ab', 'y']])).toBe('名前  x\nab    y');
  });
});
