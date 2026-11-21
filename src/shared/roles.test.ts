import { makeLeader } from '../../test/support/ledger.js';
import { describe, expect, it } from 'vitest';
import { makeAgent } from '../../test/support/agents.js';
import { buildRoster, roleOf } from './roles.js';

const agents = [
  makeAgent({ name: 'cuse-leader', sessionId: 'L' }),
  makeAgent({ name: 'tests', sessionId: 'W' }),
  makeAgent({ name: 'tests', sessionId: 'H' }),
];

describe('buildRoster', () => {
  it('台帳の sessionId だけで役割を決める（同名の手動セッションを配下にしない）', () => {
    const roster = buildRoster(agents, {
      version: 1,
      leader: makeLeader({ sessionId: 'L' }),
      workers: [
        {
          name: 'tests',
          shortId: null,
          sessionId: 'W',
          task: '',
          cwd: '',
          worktree: null,
          startedAt: '',
          endedAt: null,
          endReason: null,
          promptCount: 0,
        },
      ],
    });
    expect(roster.leader?.sessionId).toBe('L');
    expect(roster.workers.map((agent) => agent.sessionId)).toEqual(['W']);
    expect(roster.others.map((agent) => agent.sessionId)).toEqual(['H']);
    expect(agents.map((agent) => roleOf(roster, agent))).toEqual(['leader', 'worker', 'other']);
  });

  it('台帳が無ければ全員 other（名前が cuse-leader でも指揮役とみなさない）', () => {
    const roster = buildRoster(agents, null);
    expect(roster.leader).toBeNull();
    expect(roster.workers).toEqual([]);
    expect(roster.others).toHaveLength(3);
  });
});
