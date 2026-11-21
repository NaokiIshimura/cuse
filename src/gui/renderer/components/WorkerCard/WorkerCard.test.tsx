// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { makeAgent } from '../../../../../test/support/agents.js';
import { getFrame } from '../../../../shared/characters.js';
import { WorkerCard } from './index.js';

afterEach(cleanup);

const text = (container: HTMLElement): string => container.textContent ?? '';

describe('WorkerCard', () => {
  it('AA・名前・経過時間・状態を出す', () => {
    const agent = makeAgent({ name: 'tests', state: 'working', startedAt: 1 });
    const { container } = render(<WorkerCard agent={agent} frame={1} now={18 * 60 * 1000 + 1} />);
    expect(text(container)).toContain(getFrame('working', 1));
    expect(text(container)).toContain('tests');
    expect(text(container)).toContain('18m');
    expect(text(container)).toContain('作業中');
  });

  it('承認待ちなら何の承認かを出す', () => {
    const agent = makeAgent({
      name: 'tests',
      state: 'blocked',
      meta: {
        lastPrompt: 'テストを足して',
        tokens: undefined,
        subagents: [],
        pendingTool: { name: 'Bash', detail: 'npm test' },
      },
    });
    const { container } = render(<WorkerCard agent={agent} frame={0} now={0} />);
    expect(text(container)).toContain('承認待ち');
    expect(text(container)).toContain('Bash: npm test');
    expect(text(container)).not.toContain('テストを足して');
  });

  it('承認待ちでなければ最後の指示を出す', () => {
    const agent = makeAgent({
      name: 'readme',
      state: 'waiting',
      meta: { lastPrompt: 'README を直して', tokens: undefined, subagents: [] },
    });
    const { container } = render(<WorkerCard agent={agent} frame={0} now={0} />);
    expect(text(container)).toContain('> README を直して');
  });

  it('サブエージェントが動いていれば数とミニキャラクターを出す', () => {
    const agent = makeAgent({
      name: 'notify',
      state: 'working',
      meta: {
        lastPrompt: undefined,
        tokens: undefined,
        subagents: [
          { toolUseId: 'a', type: 'general-purpose', description: '調べもの', startedAt: undefined },
          { toolUseId: 'b', type: 'Explore', description: '', startedAt: undefined },
        ],
      },
    });
    const { container } = render(<WorkerCard agent={agent} frame={0} now={0} />);
    expect(text(container)).toContain('サブエージェント 2');
    expect(container.querySelectorAll('.mini')).toHaveLength(2);
  });
});
