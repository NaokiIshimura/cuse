import { makeLeader } from '../../../test/support/ledger.js';
import { describe, expect, it } from 'vitest';
import { makeAgent } from '../../../test/support/agents.js';
import type { ReadLedgerResult } from '../../core/ledger.js';
import { buildListModel, nextBlockedSince } from './listModel.js';

const agents = [
  makeAgent({ name: 'leader', sessionId: 'L', state: 'waiting' }),
  makeAgent({ name: 'tests', sessionId: 'T', state: 'working' }),
  makeAgent({ name: 'readme', sessionId: 'R', state: 'blocked' }),
  makeAgent({ name: 'lint', sessionId: 'D', state: 'done' }),
  makeAgent({ name: 'hand', sessionId: 'H', state: 'waiting' }),
];

const ledger: ReadLedgerResult = {
  kind: 'ok',
  ledger: {
    version: 1,
    leader: makeLeader({ sessionId: 'L', name: 'leader' }),
    workers: ['T', 'R', 'D'].map((sessionId) => ({
      name: sessionId,
      shortId: null,
      sessionId,
      task: '',
      cwd: '',
      worktree: null,
      startedAt: '',
      endedAt: null,
      endReason: null,
      promptCount: 0,
    })),
  },
};

const options = { now: 0, maxWorkers: 3, blockedSince: new Map<string, number>() };

describe('buildListModel', () => {
  it('配下だけを、承認待ちを先頭に、終わったものを DONE に分けて並べる', () => {
    const model = buildListModel(agents, ledger, { ...options, scope: 'workers' });
    expect(model.leader?.name).toBe('leader');
    expect(model.active.map((agent) => agent.name)).toEqual(['readme', 'tests']);
    expect(model.finished.map((agent) => agent.name)).toEqual(['lint']);
    expect(model.activeCount).toBe(2);
    expect(model.attentionCount).toBe(1);
    expect(model.ledgerAvailable).toBe(true);
  });

  it('全セッション表示では、台帳に無いものも並べる（指揮役は上端に出すので除く）', () => {
    const model = buildListModel(agents, ledger, { ...options, scope: 'all' });
    expect(model.active.map((agent) => agent.name)).toEqual(['readme', 'tests', 'hand']);
    expect(model.attentionCount).toBe(2);
    // 上端の「配下 n/上限」は配下だけを数える
    expect(model.activeCount).toBe(2);
  });

  it('台帳が無ければ配下は空で、切り替えを案内できる', () => {
    const model = buildListModel(agents, { kind: 'missing' }, { ...options, scope: 'workers' });
    expect(model.leader).toBeNull();
    expect(model.active).toEqual([]);
    expect(model.ledgerAvailable).toBe(false);
  });
});

describe('nextBlockedSince', () => {
  it('承認待ちになった時刻を覚え、続く間は変えない', () => {
    const blocked = [makeAgent({ name: 'a', sessionId: 'a', state: 'blocked' })];
    const first = nextBlockedSince(new Map(), blocked, 100);
    expect([...first]).toEqual([['a', 100]]);
    expect(nextBlockedSince(first, blocked, 200)).toBe(first);
  });

  it('承認待ちでなくなったら外す', () => {
    const first = new Map([['a', 100]]);
    const next = nextBlockedSince(first, [makeAgent({ name: 'a', sessionId: 'a' })], 200);
    expect(next.size).toBe(0);
  });
});
