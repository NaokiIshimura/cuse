// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CuseBridge } from '../../../ipc.js';
import { TerminalView } from './index.js';

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    focus() {}
    dispose() {}
    write() {}
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

const bridge = {
  writeTerminal: () => undefined,
  resizeTerminal: () => undefined,
  closeTerminal: () => undefined,
  onTerminalData: () => () => undefined,
  onTerminalExit: () => () => undefined,
} as unknown as CuseBridge;

beforeEach(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
});
afterEach(cleanup);

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

describe('TerminalView', () => {
  it('端末を起こせなければ、真っ暗のままにせず理由を出す', async () => {
    const { container } = render(
      <TerminalView
        bridge={bridge}
        tabId="trust"
        active
        open={async () => ({ ok: false, message: '端末を起こす部品に実行権限を付けられませんでした' })}
      />,
    );
    await flush();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('実行権限');
  });

  it('main 側で例外になっても、理由を出す', async () => {
    const { container } = render(
      <TerminalView
        bridge={bridge}
        tabId="trust"
        active
        open={async () => {
          throw new Error('posix_spawnp failed.');
        }}
      />,
    );
    await flush();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('posix_spawnp failed.');
  });
});
