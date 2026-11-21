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
    const { container, getByText } = render(
      <PreviewPane bridge={bridge} sessionId="s1" sessionName="tests" following onToggleFollow={() => undefined} />,
    );
    await flush();
    await flush();
    expect(reads[0]).toEqual(['s1', 'file:/w/app/src/notify.ts', false]);
    expect([...container.querySelectorAll('.preview-diff--add')].map((line) => line.textContent)).toEqual(['+new']);
    expect(container.querySelector('.preview__follow')?.textContent).toBe('● 追いかけ中');

    fireEvent.click(getByText('元の文字'));
    expect(container.querySelector('.preview-text__line')?.textContent).toBe('1new');
    // TypeScript として色を付ける（HTML を差し込まず、断片を部品として並べる）
    expect(container.querySelector('.preview-text')?.className).toContain('language-typescript');
  });

  it('Markdown は整えて見せ、HTML・リンク・画像は持ち込まない。元の文字にも切り替えられる', async () => {
    const md = [
      '# 見出し',
      '',
      '| 要素 | 内容 |',
      '| --- | --- |',
      '| 表 | 左寄せ |',
      '',
      '<script>alert(1)</script><b>太字のタグ</b>',
      '',
      '[リンク](https://example.com) ![図](/etc/passwd)',
      '',
      '```ts',
      'const a = 1;',
      '```',
    ].join('\n');
    const mdItems: PreviewItem[] = [{ kind: 'file', path: '/w/app/README.md', edited: false, at: 3, tool: 'Read' }];
    const { bridge } = makeBridge(mdItems, {
      'file:/w/app/README.md': { kind: 'text', text: md, truncated: false, diff: null },
    });
    const { container, getByText } = render(
      <PreviewPane bridge={bridge} sessionId="s1" sessionName="tests" following onToggleFollow={() => undefined} />,
    );
    await flush();
    await flush();
    const view = container.querySelector('.preview-md') as HTMLElement;
    expect(view.querySelector('h1')?.textContent).toBe('見出し');
    expect(view.querySelector('table td')?.textContent).toBe('表');
    expect(view.querySelector('script')).toBeNull();
    expect(view.querySelector('b')).toBeNull();
    expect(view.querySelector('a')).toBeNull();
    expect(view.querySelector('img')).toBeNull();
    expect(view.querySelector('.preview-md__link')?.getAttribute('title')).toBe('https://example.com');
    expect(view.querySelector('.preview-md__image')?.textContent).toBe('[画像: 図]');
    expect(view.querySelector('.preview-md__code .hljs-keyword')?.textContent).toBe('const');

    fireEvent.click(getByText('元の文字'));
    expect(container.querySelector('.preview-md')).toBeNull();
    expect(container.querySelector('.preview-text__line')?.textContent).toBe('1# 見出し');
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

  it('会話の中で押したものを開く。開けなければ理由を出す', async () => {
    const { bridge, reads } = makeBridge(items, results);
    const { container, rerender } = render(
      <PreviewPane bridge={bridge} sessionId="s1" sessionName="tests" following={false} onToggleFollow={() => undefined} />,
    );
    await flush();
    rerender(
      <PreviewPane
        bridge={bridge}
        sessionId="s1"
        sessionName="tests"
        following={false}
        onToggleFollow={() => undefined}
        request={{ nonce: 1, key: 'url:http://localhost:5173/' }}
      />,
    );
    await flush();
    expect(reads.at(-1)).toEqual(['s1', 'url:http://localhost:5173/', false]);
    expect(container.querySelector('webview')?.getAttribute('src')).toBe('http://localhost:5173/');

    rerender(
      <PreviewPane
        bridge={bridge}
        sessionId="s1"
        sessionName="tests"
        following={false}
        onToggleFollow={() => undefined}
        request={{ nonce: 2, message: '/etc/passwd はこのセッションに出てきたものではないので開きません。' }}
      />,
    );
    await flush();
    expect(container.querySelector('.preview__notice')?.textContent).toContain('出てきたものではない');
  });
});
