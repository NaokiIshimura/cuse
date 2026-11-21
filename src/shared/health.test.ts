import { describe, expect, it } from 'vitest';
import { makeAgent } from '../../test/support/agents.js';
import { countActive, healthWarnings, LONG_APPROVAL_MS } from './health.js';

describe('healthWarnings', () => {
  it('問題が無ければ空', () => {
    expect(healthWarnings([makeAgent({ name: 'a' })], { now: 0 })).toEqual([]);
  });

  it('止まっている・状態不明の配下を知らせる', () => {
    const warnings = healthWarnings(
      [makeAgent({ name: 'a', state: 'stopped' }), makeAgent({ name: 'b', state: 'unknown' })],
      { now: 0 },
    );
    expect(warnings).toEqual([
      { kind: 'stopped', message: '止まっている配下があります: a, b', names: ['a', 'b'] },
    ]);
  });

  it('承認待ちが長く続いたら知らせる', () => {
    const agent = makeAgent({ name: 'a', sessionId: 's', state: 'blocked' });
    const blockedSince = new Map([['s', 0]]);
    expect(healthWarnings([agent], { now: LONG_APPROVAL_MS - 1, blockedSince })).toEqual([]);
    expect(
      healthWarnings([agent], { now: LONG_APPROVAL_MS, blockedSince }).map((w) => w.kind),
    ).toEqual(['long-approval']);
  });

  it('動いている配下が上限に達したら知らせる（完了・停止は数えない）', () => {
    const workers = [
      makeAgent({ name: 'a' }),
      makeAgent({ name: 'b', state: 'waiting' }),
      makeAgent({ name: 'c', state: 'done' }),
    ];
    expect(countActive(workers)).toBe(2);
    expect(healthWarnings(workers, { now: 0, maxWorkers: 3 })).toEqual([]);
    expect(healthWarnings(workers, { now: 0, maxWorkers: 2 }).map((w) => w.kind)).toEqual([
      'near-limit',
    ]);
  });
});
