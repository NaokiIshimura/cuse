// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAgent } from '../../../test/support/agents.js';
import type { CuseBridge, GuiEnvironment, Snapshot } from '../ipc.js';
import { App } from './App.js';

const environment: GuiEnvironment = {
  claudeVersion: { ok: true, version: '2.1.325' },
  maxWorkers: 3,
  platform: 'darwin',
};

const snapshot: Snapshot = {
  agents: {
    ok: true,
    agents: [
      makeAgent({ name: 'tests', state: 'blocked' }),
      makeAgent({ name: 'lint-fix', state: 'done' }),
    ],
  },
  ledger: { kind: 'missing' },
  at: 0,
};

const bridge: CuseBridge = {
  getEnvironment: async () => environment,
  getSnapshot: async () => snapshot,
};

beforeEach(() => {
  // jsdom には matchMedia が無い
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
});
afterEach(cleanup);

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe('App', () => {
  it('台帳が無い間は配下が空で、全セッション表示へ切り替えられる', async () => {
    const { container, getByText } = render(<App environment={environment} bridge={bridge} />);
    await flush();
    expect(container.textContent).toContain('台帳（~/.cuse/ledger.json）がまだ無い');

    fireEvent.click(getByText('マシン上の全セッションを表示'));
    expect(container.textContent).toContain('ALL SESSIONS');
    expect(container.querySelectorAll('.worker-card')).toHaveLength(1);
    expect(container.textContent).toContain('DONE');
    expect(container.textContent).toContain('lint-fix');
    // 全セッション表示でも、承認待ちは対応待ちとして数える
    expect(container.textContent).toContain('対応待ち 1');
  });

  it('中央と右は後の段階で入る場所として出す', async () => {
    const { container } = render(<App environment={environment} bridge={bridge} />);
    await flush();
    expect(container.textContent).toContain('第 2 段階で入ります');
    expect(container.textContent).toContain('第 3 段階で入ります');
  });

  it('承認のボタンは置かない', async () => {
    const { container } = render(<App environment={environment} bridge={bridge} />);
    await flush();
    const labels = [...container.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels.some((label) => label?.includes('承認'))).toBe(false);
  });
});
