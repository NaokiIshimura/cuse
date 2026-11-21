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
  leaderStartup: { kind: 'starting' },
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
  leaderStartup: { kind: 'ready', action: 'opened', warnings: [] },
  at: 0,
};

const makeBridge = (snapshot: Snapshot) => {
  const opened: OpenTerminalRequest[] = [];
  const closed: string[] = [];
  const stopped: [string, string][] = [];
  let ensured = 0;
  let chosen = 0;
  const trusted: { tabId: string }[] = [];
  let cleanCalls = 0;
  let openSessionListener: ((sessionId: string) => void) | null = null;
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
    ensureLeader: async () => {
      ensured += 1;
      return { kind: 'starting' };
    },
    chooseLeaderFolder: async () => {
      chosen += 1;
      return { kind: 'starting' };
    },
    cleanWorkers: async () => {
      cleanCalls += 1;
      return { ok: true, message: '片付けました: lint-fix', cleaned: 1 };
    },
    onOpenSession: (listener) => {
      openSessionListener = listener;
      return () => undefined;
    },
    openTrustTerminal: async (request) => {
      trusted.push({ tabId: request.tabId });
      return { ok: true };
    },
  };
  return {
    bridge,
    opened,
    closed,
    stopped,
    trusted,
    ensured: () => ensured,
    chosen: () => chosen,
    cleanCalls: () => cleanCalls,
    openSession: (sessionId: string) => openSessionListener?.(sessionId),
  };
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
    // アプリを開くと指揮役を起こすので、その間は「起こしています」
    expect(container.textContent).toContain('cuse-leader を起こしています');

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
    // 承認待ちの配下は「開いて承認する」
    fireEvent.click(getAllByText('開いて承認する')[0] as HTMLElement);
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

  it('指揮役を起こせなければ理由を出し、もう一度頼める', async () => {
    const { bridge, ensured } = makeBridge({
      ...missingSnapshot,
      leaderStartup: { kind: 'failed', message: 'Claude Code v2.1.200 は古いです', untrustedFolder: null },
    });
    const { container, getByText } = render(<App environment={environment} bridge={bridge} />);
    await flush();
    expect(container.textContent).toContain('指揮役を起こせませんでした');
    expect(container.textContent).toContain('Claude Code v2.1.200 は古いです');
    fireEvent.click(getByText('もう一度'));
    expect(ensured()).toBe(1);
  });

  it('初回は指揮役の居場所で動かした Claude Code を出し、信頼してから起こしてもらう', async () => {
    const { bridge, trusted, closed, ensured, chosen } = makeBridge({
      ...missingSnapshot,
      leaderStartup: {
        kind: 'failed',
        message: '初回だけ信頼してください',
        untrustedFolder: '/Users/example/.cuse/leader',
      },
    });
    const { container, getByText, unmount } = render(<App environment={environment} bridge={bridge} />);
    await flush();
    await flush();
    expect(container.textContent).toContain('初回だけ');
    expect(container.textContent).toContain('指揮役の居場所を Claude Code で信頼してください');
    // 目立つよう、見出しと警告の役割（role="alert"）を持たせる
    expect(container.querySelector('[role="alert"] h2')?.textContent).toBe(
      '指揮役の居場所を Claude Code で信頼してください',
    );
    expect(container.textContent).toContain('/Users/example/.cuse/leader');
    // どのフォルダで動かすかは main が決める（renderer はタブの ID と大きさだけを渡す）
    expect(trusted).toEqual([{ tabId: 'trust' }]);
    expect(container.textContent).toContain('信頼すると、下の Claude Code は自動で閉じて、指揮役が起きます');
    // はじめは「No, exit」が選ばれているので、選ぶキーまで書く
    expect(container.textContent).toContain('↓ キーで「Yes, I trust this folder」を選び、Enter');
    // 信頼の端末は指揮役ではないと書く
    expect(container.querySelector('.trust__terminal-label')?.textContent).toContain('指揮役ではありません');

    fireEvent.click(getByText('▶ 指揮役を起こす'));
    expect(ensured()).toBe(1);
    fireEvent.click(getByText('別のフォルダで起こす'));
    expect(chosen()).toBe(1);

    // 信頼の端末は閉じるときに切る
    unmount();
    expect(closed).toContain('trust');
  });

  it('指揮役を起こしたときの警告を上端に出す', async () => {
    const { bridge } = makeBridge({
      ...leaderSnapshot,
      leaderStartup: { kind: 'ready', action: 'started', warnings: ['スキルが別の内容です'] },
    });
    const { container } = render(<App environment={environment} bridge={bridge} />);
    await flush();
    expect(container.querySelector('.top-bar__notices')?.textContent).toContain('スキルが別の内容です');
  });

  it('まだ配下を起こしていなければ、指揮役に何を書けばよいかを見せる', async () => {
    const firstSnapshot: Snapshot = {
      ...leaderSnapshot,
      ledger: { kind: 'ok', ledger: makeLedger({ leader: makeLeader() }) },
    };
    const { bridge } = makeBridge(firstSnapshot);
    const { container } = render(<App environment={environment} bridge={bridge} />);
    await flush();
    expect(container.querySelector('.first-request')?.textContent).toContain('ここから依頼します');

    // 配下を起こしたことがあれば出さない
    cleanup();
    const second = render(<App environment={environment} bridge={makeBridge(leaderSnapshot).bridge} />);
    await flush();
    expect(second.container.querySelector('.first-request')).toBeNull();
  });

  it('DONE に台帳の配下があれば「片付ける」を出し、結果を見せる', async () => {
    const snapshot: Snapshot = {
      ...leaderSnapshot,
      agents: {
        ok: true,
        agents: [
          makeAgent({ name: 'cuse-leader', sessionId: 'leader-session', id: 'leader01', state: 'waiting' }),
          makeAgent({ name: 'tests', sessionId: 'tests-session', id: 'tests-id', state: 'done' }),
        ],
      },
    };
    const { bridge, cleanCalls } = makeBridge(snapshot);
    const { container, getByText } = render(<App environment={environment} bridge={bridge} />);
    await flush();
    fireEvent.click(getByText('片付ける'));
    await flush();
    expect(cleanCalls()).toBe(1);
    expect(container.querySelector('.worker-list__clean-message')?.textContent).toBe('片付けました: lint-fix');
  });

  it('OS 通知を押したら、その配下を中央に開く', async () => {
    const { bridge, opened, openSession } = makeBridge(leaderSnapshot);
    render(<App environment={environment} bridge={bridge} />);
    await flush();
    act(() => {
      openSession('tests-session');
    });
    await flush();
    expect(opened.map((request) => request.sessionId)).toContain('tests-session');
  });

  it('承認のボタンは置かない（「開いて承認する」は開くだけ）', async () => {
    const { bridge } = makeBridge(leaderSnapshot);
    const { container } = render(<App environment={environment} bridge={bridge} />);
    await flush();
    const labels = [...container.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels.filter((label) => label?.includes('承認'))).toEqual(['開いて承認する']);
  });
});
