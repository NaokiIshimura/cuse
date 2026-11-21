// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CuseBridge } from '../../../ipc.js';
import { TerminalView } from './index.js';

/** 偽の端末に出ている行（全角は 2 桁目を幅 0 のセルにする）と、登録された押せるものの探し方。 */
const screen: { lines: string[]; provider: { provideLinks: (y: number, cb: (links: unknown) => void) => void } | null } = {
  lines: [],
  provider: null,
};

const cellsOf = (text: string) =>
  [...text].flatMap((char) =>
    /[\u3000-\uffff]/.test(char)
      ? [
          { getChars: () => char, getWidth: () => 2 },
          { getChars: () => '', getWidth: () => 0 },
        ]
      : [{ getChars: () => char, getWidth: () => 1 }],
  );

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    buffer = {
      active: {
        getLine: (y: number) => {
          const text = screen.lines[y];
          if (text === undefined) {
            return undefined;
          }
          const cells = cellsOf(text);
          return { length: cells.length, getCell: (x: number) => cells[x] };
        },
      },
    };
    registerLinkProvider(provider: typeof screen.provider) {
      screen.provider = provider;
      return { dispose() {} };
    }
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

  it('画面のファイル名・URL を押すと onLink を呼ぶ（全角の文字があっても桁を合わせる）', async () => {
    screen.lines = ['作りました: ~/.claude/tmp/sample.md と https://example.com'];
    const clicked: unknown[] = [];
    render(
      <TerminalView
        bridge={bridge}
        tabId="leader"
        active
        open={async () => ({ ok: true })}
        onLink={(link) => {
          clicked.push(link);
        }}
      />,
    );
    await flush();
    let links: { text: string; range: { start: { x: number }; end: { x: number } }; activate: () => void }[] = [];
    screen.provider?.provideLinks(1, (found) => {
      links = (found ?? []) as typeof links;
    });
    expect(links.map((link) => link.text)).toEqual(['~/.claude/tmp/sample.md', 'https://example.com']);
    // 「作りました:」の 5 文字は全角で 10 桁、続く半角 2 文字（: と空白）で、パスは 13 桁目から
    expect(links[0]?.range.start.x).toBe(13);
    links[1]?.activate();
    expect(clicked).toEqual([{ text: 'https://example.com', kind: 'url' }]);
  });
});
