// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { makeAgent } from '../../../../../test/support/agents.js';
import { TopBar } from './index.js';

afterEach(cleanup);

const ok = { ok: true, version: '2.1.325' } as const;

describe('TopBar', () => {
  it('指揮役・配下数・対応待ち・コンテキスト使用率を出す', () => {
    const leader = makeAgent({
      name: 'cuse-leader',
      state: 'waiting',
      meta: {
        lastPrompt: undefined,
        tokens: { used: 76_000, limit: 200_000, ratio: 0.38 },
        subagents: [],
      },
    });
    const { container } = render(
      <TopBar
        leader={leader}
        activeCount={3}
        maxWorkers={3}
        attentionCount={1}
        warnings={[]}
        claudeVersion={ok}
        fetchError={null}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('cuse-leader');
    expect(text).toContain('入力待ち');
    expect(text).toContain('配下 3/3');
    expect(text).toContain('対応待ち 1');
    expect(text).toContain('ctx 38%');
  });

  it('指揮役がいなければそう書く', () => {
    const { container } = render(
      <TopBar
        leader={null}
        activeCount={0}
        maxWorkers={3}
        attentionCount={0}
        warnings={[]}
        claudeVersion={ok}
        fetchError={null}
      />,
    );
    expect(container.textContent).toContain('指揮役 なし');
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('取得の失敗・古いバージョン・健全性の警告を並べる', () => {
    const { container } = render(
      <TopBar
        leader={null}
        activeCount={0}
        maxWorkers={3}
        attentionCount={0}
        warnings={[{ kind: 'stopped', message: '止まっている配下があります: a', names: ['a'] }]}
        claudeVersion={{ ok: false, kind: 'too-old', version: '2.1.0', message: '古いです' }}
        fetchError="claude コマンドが見つかりません。"
      />,
    );
    const notices = [...container.querySelectorAll('[role="status"] li')].map((li) => li.textContent);
    expect(notices).toEqual([
      '⚠ claude コマンドが見つかりません。',
      '⚠ 古いです',
      '⚠ 止まっている配下があります: a',
    ]);
  });
});
