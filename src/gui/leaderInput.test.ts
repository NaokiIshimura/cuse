import { describe, expect, it } from 'vitest';
import type { CharacterState } from '../types/agent.js';
import { MAX_MESSAGE_LENGTH, sendToLeader } from './leaderInput.js';

const run = async (text: unknown, state: CharacterState | null, attached: string | null = 'lead1') => {
  const writes: string[] = [];
  const result = await sendToLeader(text, {
    readState: async () => ({ leader: { shortId: 'lead1', state }, attachedShortId: attached }),
    write: (data) => {
      writes.push(data);
    },
    sleep: async () => undefined,
  });
  return { result, writes };
};

describe('sendToLeader', () => {
  it('依頼を待っている指揮役には、貼り付けとして書き込んでから Enter を送る', async () => {
    const { result, writes } = await run('README を直して\nテストも', 'waiting');
    expect(result).toEqual({ ok: true });
    expect(writes).toEqual(['\x1b[200~README を直して\rテストも\x1b[201~', '\r']);
  });

  it('承認待ちのときは送らない（Enter が承認になってしまうため）', async () => {
    const { result, writes } = await run('はい', 'blocked');
    expect(result).toMatchObject({ ok: false, reason: 'blocked' });
    expect(writes).toEqual([]);
  });

  it('作業中・状態が分からないときも送らない', async () => {
    for (const state of ['working', 'stopped', 'unknown', null] as const) {
      const { result, writes } = await run('x', state);
      expect(result).toMatchObject({ ok: false, reason: 'busy' });
      expect(writes).toEqual([]);
    }
  });

  it('指揮役の端末につないでいなければ送らない', async () => {
    const { result, writes } = await run('x', 'waiting', 'other');
    expect(result).toMatchObject({ ok: false, reason: 'unavailable' });
    expect(writes).toEqual([]);
  });

  it('空・長すぎる・文字でないものは送らない', async () => {
    expect((await run('  ', 'waiting')).result).toMatchObject({ reason: 'invalid' });
    expect((await run('x'.repeat(MAX_MESSAGE_LENGTH + 1), 'waiting')).result).toMatchObject({ reason: 'invalid' });
    expect((await run(1, 'waiting')).result).toMatchObject({ reason: 'invalid' });
  });
});
