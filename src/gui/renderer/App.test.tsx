// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAgent } from '../../../test/support/agents.js';
import { makeLeader, makeLedger, makeWorker } from '../../../test/support/ledger.js';
import type { CuseBridge, GuiEnvironment, OpenTerminalRequest, Snapshot } from '../ipc.js';
import { App } from './App.js';

// xterm は jsdom では描けないので、呼ばれ方だけを記録する偽物にする
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    written: string[] = [];
    loadAddon() {}
    open() {}
    focus() {}
    dispose() {}
    write(data: string) {
      this.written.push(data);
    }
    onData() {
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
  },
}));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }));
vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

const environment: GuiEnvironment = {
  claudeVersion: { ok: true, version: '2.1.325' },
  maxWorkers: 3,
  platform: 'darwin',
};

const missingSnapshot: Snapshot = {
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

const leaderSnapshot: Snapshot = {
  agents: {
    ok: true,
    agents: [
      makeAgent({ name: 'cuse-leader', sessionId: 'leader-session', id: 'leader01', state: 'waiting' }),
      makeAgent({ name: 'tests', sessionId: 'tests-session', id: 'tests-id', state: 'blocked' }),
      makeAgent({ name: 'hand', sessionId: 'hand-session', id: 'hand-id', state: 'working' }),
    ],
  },
  ledger: {
    kind: 'ok',
    ledger: makeLedger({ leader: makeLeader(), workers: [makeWorker({ name: 'tests' })] }),
  },
  at: 0,
};

const makeBridge = (snapshot: Snapshot) => {
  const opened: OpenTerminalRequest[] = [];
  const closed: string[] = [];
  const stopped: [string, string][] = [];
  const bridge: CuseBridge = {
    getEnvironment: async () => environment,
    getSnapshot: async () => snapshot,
    openTerminal: async (request) => {
      opened.push(request);
      return { ok: true, name: 'x', shortId: 'id', role: 'leader' };
    },
    writeTerminal: () => undefined,
    resizeTerminal: () => undefined,
    closeTerminal: (tabId) => {
      closed.push(tabId);
    },
    onTerminalData: () => () => undefined,
    onTerminalExit: () => () => undefined,
    stopWorker: async (sessionId, reason) => {
      stopped.push([sessionId, reason]);
      return { ok: true, message: '止めました' };
    },
  };
  return { bridge, opened, closed, stopped };
};

beforeEach(() => {
  // jsdom には matchMedia と ResizeObserver が無い
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
});
afterEach(cleanup);

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe('App', () => {
  it('台帳が無い間は配下が空で、全セッション表示へ切り替えられる', async () => {
    const { bridge } = makeBridge(missingSnapshot);
    const { container, getByText } = render(<App environment={environment} bridge={bridge} />);
    await flush();
    expect(container.textContent).toContain('台帳（~/.cuse/ledger.json）がまだ無い');
    expect(container.textContent).toContain('指揮役がいません');

    fireEvent.click(getByText('マシン上の全セッションを表示'));
    expect(container.textContent).toContain('ALL SESSIONS');
    expect(container.querySelectorAll('.worker-card')).toHaveLength(1);
    expect(container.textContent).toContain('lint-fix');
    expect(container.textContent).toContain('対応待ち 1');
  });

  it('指揮役がいれば、中央で指揮役の会話を開く', async () => {
    const { bridge, opened } = makeBridge(leaderSnapshot);
    const { container } = render(<App environment={environment} bridge={bridge} />);
    await flush();
    await flush();
    expect(opened).toEqual([{ tabId: 'leader', sessionId: 'leader-session', cols: 80, rows: 24 }]);
    expect(container.querySelector('.badge')?.textContent).toBe('指揮役');
  });

  it('左で配下を開くとタブが増え、閉じると attach を切る', async () => {
    const { bridge, opened, closed } = makeBridge(leaderSnapshot);
    const { container, getAllByText, getByLabelText } = render(
      <App environment={environment} bridge={bridge} />,
    );
    await flush();
    fireEvent.click(getAllByText('開く')[0] as HTMLElement);
    await flush();
    expect(opened.map((request) => request.sessionId)).toContain('tests-session');
    expect([...container.querySelectorAll('.tab__label')].map((tab) => tab.textContent)).toEqual([
      'cuse-leader',
      'tests',
    ]);

    fireEvent.click(getByLabelText('tests を閉じる'));
    await flush();
    expect(closed).toContain('session:tests-session');
  });

  it('止めるのは台帳の配下だけで、理由を付けて頼む', async () => {
    const { bridge, stopped } = makeBridge(leaderSnapshot);
    const { container, getByText, getByRole } = render(
      <App environment={environment} bridge={bridge} />,
    );
    await flush();
    fireEvent.click(getByText('全セッション'));
    // 台帳の配下（tests）にだけ「止める」が出る
    expect(container.querySelectorAll('.worker-card')).toHaveLength(2);
    expect([...container.querySelectorAll('button')].filter((b) => b.textContent === '止める')).toHaveLength(1);

    fireEvent.click(getByText('止める'));
    const dialog = getByRole('dialog');
    fireEvent.change(dialog.querySelector('input') as HTMLInputElement, { target: { value: '方針が変わった' } });
    fireEvent.submit(dialog);
    await flush();
    expect(stopped).toEqual([['tests-session', '方針が変わった']]);
  });

  it('承認のボタンは置かない', async () => {
    const { bridge } = makeBridge(leaderSnapshot);
    const { container } = render(<App environment={environment} bridge={bridge} />);
    await flush();
    const labels = [...container.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels.some((label) => label?.includes('承認'))).toBe(false);
  });
});
