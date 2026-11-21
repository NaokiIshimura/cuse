import { describe, expect, it } from 'vitest';
import { makeAgent } from '../../test/support/agents.js';
import type { ReadLedgerResult } from '../core/ledger.js';
import { buildStatusOutput, formatStatusText } from './status.js';

const agents = [
  makeAgent({ name: 'a', state: 'working' }),
  makeAgent({
    name: 'b',
    state: 'blocked',
    meta: {
      lastPrompt: undefined,
      tokens: undefined,
      subagents: [],
      pendingTool: { name: 'Edit', detail: 'src/a.ts' },
    },
  }),
  makeAgent({ name: 'c', state: 'waiting' }),
  makeAgent({ name: 'd', state: 'done' }),
  makeAgent({ name: 'e', state: 'stopped' }),
];

const ledgerOf = (...names: string[]): ReadLedgerResult => ({
  kind: 'ok',
  ledger: {
    version: 1,
    leader: null,
    workers: names.map((name) => ({
      name,
      shortId: null,
      sessionId: `${name}-session`,
      task: '',
      cwd: '',
      worktree: null,
      startedAt: '',
      endedAt: null,
      endReason: null,
      promptCount: 0,
      cleanedAt: null,
    })),
  },
});

describe('buildStatusOutput', () => {
  it('状態ごとの件数と、人の対応が要るもの（承認待ちが先）を返す', () => {
    const output = buildStatusOutput(agents, { kind: 'missing' }, { all: true, now: 0 });
    expect(output.total).toBe(5);
    expect(output.active).toBe(3);
    expect(output.counts).toMatchObject({ working: 1, blocked: 1, waiting: 1, done: 1, stopped: 1 });
    expect(output.attention).toEqual([
      { name: 'b', sessionId: 'b-session', waitingFor: 'approval', reason: 'Edit: src/a.ts' },
      { name: 'c', sessionId: 'c-session', waitingFor: 'input', reason: null },
    ]);
  });

  it('既定は台帳の配下だけを数える', () => {
    const output = buildStatusOutput(agents, ledgerOf('a', 'e'), { all: false, now: 0 });
    expect(output.total).toBe(2);
    expect(output.attention).toEqual([]);
  });

  it('止まっている配下と上限を警告する', () => {
    const output = buildStatusOutput(agents, ledgerOf('a', 'b', 'c', 'e'), {
      all: false,
      now: 0,
    });
    expect(output.warnings.map((warning) => warning.kind)).toEqual(['stopped', 'near-limit']);
  });

  it('--all でも、台帳に無いセッションは警告しない', () => {
    const output = buildStatusOutput(agents, { kind: 'missing' }, { all: true, now: 0 });
    expect(output.warnings).toEqual([]);
  });
});

describe('formatStatusText', () => {
  it('人の対応が要るものを理由つきで並べる', () => {
    const text = formatStatusText(
      buildStatusOutput(agents, { kind: 'missing' }, { all: true, now: 0 }),
    );
    expect(text).toContain('セッション: 5');
    expect(text).toContain('b: 承認待ち — Edit: src/a.ts');
    expect(text).toContain('c: 入力待ち');
  });

  it('台帳が無いときは --all を案内する', () => {
    const text = formatStatusText(
      buildStatusOutput(agents, { kind: 'missing' }, { all: false, now: 0 }),
    );
    expect(text).toContain('配下: 0/3');
    expect(text).toContain('cuse status --all');
  });
});
