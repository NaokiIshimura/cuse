// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PreviewItem } from '../../../../shared/previewItems.js';
import type { CuseBridge, PreviewResult } from '../../../ipc.js';
import { PreviewPane } from './index.js';

afterEach(cleanup);

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

const makeBridge = (items: readonly PreviewItem[], results: Record<string, PreviewResult>) => {
  const reads: [string, string, boolean][] = [];
  const externals: string[] = [];
  const bridge = {
    getPreviewItems: async () => items,
    readPreview: async (sessionId: string, key: string, reveal: boolean) => {
      reads.push([sessionId, key, reveal]);
      return results[`${key}${reveal ? '#reveal' : ''}`] ?? { kind: 'unavailable', message: 'なし' };
    },
    openExternalUrl: async (_sessionId: string, url: string) => {
      externals.push(url);
      return true;
    },
  } as unknown as CuseBridge;
  return { bridge, reads, externals };
};

const items: PreviewItem[] = [
  { kind: 'file', path: '/w/app/src/notify.ts', edited: true, at: 2, tool: 'Edit' },
  { kind: 'url', url: 'http://localhost:5173/', at: 1, tool: 'mention' },
  { kind: 'file', path: '/w/app/.env', edited: false, at: 0, tool: 'Read' },
];

const results: Record<string, PreviewResult> = {
  'file:/w/app/src/notify.ts': { kind: 'text', text: 'new\n', truncated: false, diff: '@@ -1 +1 @@\n-old\n+new' },
  'url:http://localhost:5173/': { kind: 'url', url: 'http://localhost:5173/' },
  'file:/w/app/.env': { kind: 'masked' },
  'file:/w/app/.env#reveal': { kind: 'text', text: 'API_KEY=x', truncated: false, diff: null },
};

describe('PreviewPane', () => {
  it('追いかけ中は、いちばん新しく出てきたものを開き、書き換えたファイルは差分を見せる', async () => {
    const { bridge, reads } = makeBridge(items, results);
    const { container } = render(
      <PreviewPane bridge={bridge} sessionId="s1" sessionName="tests" following onToggleFollow={() => undefined} />,
    );
    await flush();
    await flush();
    expect(reads[0]).toEqual(['s1', 'file:/w/app/src/notify.ts', false]);
    expect([...container.querySelectorAll('.preview-diff--add')].map((line) => line.textContent)).toEqual(['+new']);
    expect(container.querySelector('.preview__follow')?.textContent).toBe('● 追いかけ中');

    fireEvent.click(container.querySelector('.preview__toolbar button') as HTMLElement);
    expect(container.querySelector('.preview-text__line')?.textContent).toBe('1new');
  });

  it('履歴から開ける。URL は隔離したブラウザ表示と「ブラウザで開く」', async () => {
    const { bridge, externals } = makeBridge(items, results);
    const { container, getByText } = render(
      <PreviewPane bridge={bridge} sessionId="s1" sessionName="tests" following onToggleFollow={() => undefined} />,
    );
    await flush();
    fireEvent.click(getByText('http://localhost:5173/'));
    await flush();
    const view = container.querySelector('webview');
    expect(view?.getAttribute('src')).toBe('http://localhost:5173/');
    expect(view?.getAttribute('partition')).toBe('cuse-preview');
    fireEvent.click(getByText('ブラウザで開く'));
    expect(externals).toEqual(['http://localhost:5173/']);
  });

  it('.env は伏せ、「中身を見る」を押したときだけ読む', async () => {
    const { bridge, reads } = makeBridge(items, results);
    const { container, getByText } = render(
      <PreviewPane bridge={bridge} sessionId="s1" sessionName="tests" following={false} onToggleFollow={() => undefined} />,
    );
    await flush();
    fireEvent.click(getByText('/w/app/.env'));
    await flush();
    expect(container.textContent).toContain('中身を伏せています');
    fireEvent.click(getByText('中身を見る'));
    await flush();
    expect(reads.at(-1)).toEqual(['s1', 'file:/w/app/.env', true]);
    expect(container.textContent).toContain('API_KEY=x');
  });

  it('固定中は自動では開かない', async () => {
    const { bridge, reads } = makeBridge(items, results);
    const { container } = render(
      <PreviewPane bridge={bridge} sessionId="s1" sessionName="tests" following={false} onToggleFollow={() => undefined} />,
    );
    await flush();
    expect(reads).toEqual([]);
    expect(container.querySelector('.preview__follow')?.textContent).toBe('固定');
  });

  it('セッションが無ければ案内だけ', () => {
    const { bridge } = makeBridge([], {});
    const { container } = render(
      <PreviewPane bridge={bridge} sessionId={null} sessionName={null} following onToggleFollow={() => undefined} />,
    );
    expect(container.textContent).toContain('中央でセッションを開くと');
  });
});
