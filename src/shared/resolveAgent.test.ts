import { describe, expect, it } from 'vitest';
import { makeAgent } from '../../test/support/agents.js';
import { resolveAgent } from './resolveAgent.js';

const agents = [
  makeAgent({ name: 'tests', id: 'aaaa1111', sessionId: 'aaaa1111-0000' }),
  makeAgent({ name: 'tests-e2e', id: 'bbbb2222', sessionId: 'bbbb2222-0000' }),
  makeAgent({ name: 'readme', id: 'cccc3333', sessionId: 'cccc3333-0000' }),
  makeAgent({ name: 'notify-settings', id: 'dddd4444', sessionId: 'dddd4444-0000' }),
];

const nameOf = (query: string) => {
  const result = resolveAgent(agents, query);
  return result.ok ? result.agent.name : result.kind;
};

describe('resolveAgent', () => {
  it('完全一致を最優先する（tests と tests-e2e があっても tests に決まる）', () => {
    expect(nameOf('tests')).toBe('tests');
  });

  it('短縮 ID・sessionId でも指せる', () => {
    expect(nameOf('cccc3333')).toBe('readme');
    expect(nameOf('dddd4444-0000')).toBe('notify-settings');
  });

  it('前方一致・部分一致で 1 つに決まれば採る', () => {
    expect(nameOf('read')).toBe('readme');
    expect(nameOf('settings')).toBe('notify-settings');
  });

  it('曖昧なら候補を並べてエラーにする', () => {
    const result = resolveAgent(agents, 'test');
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'ambiguous') {
      expect(result.candidates.map((agent) => agent.name)).toEqual(['tests', 'tests-e2e']);
      expect(result.message).toContain('tests（aaaa1111）');
    } else {
      throw new Error('ambiguous になるはず');
    }
  });

  it('見つからなければ not-found', () => {
    expect(nameOf('nothing')).toBe('not-found');
    expect(nameOf('  ')).toBe('not-found');
  });
});
