import { describe, expect, it } from 'vitest';
import { extractPreviewItems, imageMimeType, isSensitivePath, previewKey } from './previewItems.js';

const assistant = (content: unknown, timestamp = '2026-11-21T09:00:00Z', extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', timestamp, message: { content }, ...extra });
const user = (content: unknown) => JSON.stringify({ type: 'user', message: { content } });
const tool = (name: string, input: Record<string, unknown>) => [{ type: 'tool_use', id: 't', name, input }];

describe('extractPreviewItems', () => {
  it('Read / Edit / Write のファイルと WebFetch の URL を、新しい順に拾う', () => {
    const chunk = [
      assistant(tool('Read', { file_path: '/w/app/README.md' }), '2026-11-21T09:00:00Z'),
      assistant(tool('WebFetch', { url: 'https://code.claude.com/docs/en/agent-view', prompt: 'x' }), '2026-11-21T09:01:00Z'),
      assistant(tool('Edit', { file_path: '/w/app/src/notify.ts', old_string: 'a', new_string: 'b' }), '2026-11-21T09:02:00Z'),
    ].join('\n');
    expect(extractPreviewItems(chunk)).toEqual([
      { kind: 'file', path: '/w/app/src/notify.ts', edited: true, at: Date.parse('2026-11-21T09:02:00Z'), tool: 'Edit' },
      { kind: 'url', url: 'https://code.claude.com/docs/en/agent-view', at: Date.parse('2026-11-21T09:01:00Z'), tool: 'WebFetch' },
      { kind: 'file', path: '/w/app/README.md', edited: false, at: Date.parse('2026-11-21T09:00:00Z'), tool: 'Read' },
    ]);
  });

  it('同じファイルは 1 つにまとめ、一度書き換えたら後で読んでも「書き換えた」のまま', () => {
    const chunk = [
      assistant(tool('Write', { file_path: '/w/a.ts', content: 'x' })),
      assistant(tool('Read', { file_path: '/w/b.ts' })),
      assistant(tool('Read', { file_path: '/w/a.ts' })),
    ].join('\n');
    const items = extractPreviewItems(chunk);
    expect(items.map(previewKey)).toEqual(['file:/w/a.ts', 'file:/w/b.ts']);
    expect(items[0]).toMatchObject({ edited: true, tool: 'Read' });
  });

  it('会話に出た URL を拾う（localhost はツールの結果からも）', () => {
    const chunk = [
      assistant([{ type: 'text', text: '開発サーバを http://localhost:5173/settings で起動しました。' }]),
      user([{ type: 'tool_result', tool_use_id: 't', content: 'Local: http://127.0.0.1:3000/' }]),
    ].join('\n');
    expect(extractPreviewItems(chunk).map(previewKey)).toEqual([
      'url:http://127.0.0.1:3000/',
      'url:http://localhost:5173/settings',
    ]);
  });

  it('人の依頼と Claude の返事に出た外の URL も拾う（日本語・句読点・Markdown で切る）', () => {
    const chunk = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'https://www.wikipedia.orgを開いて' } }),
      assistant([
        {
          type: 'text',
          text: 'テストなら https://example.com がおすすめです。**https://info.cern.ch**、[資料](https://example.org/docs?a=1)。https:// だけは拾わない',
        },
      ]),
    ].join('\n');
    expect(extractPreviewItems(chunk).map(previewKey)).toEqual([
      'url:https://example.org/docs?a=1',
      'url:https://info.cern.ch',
      'url:https://example.com',
      'url:https://www.wikipedia.org',
    ]);
  });

  it('ツールの結果（読んだファイルや取ってきたページ）に出た外の URL は拾わない', () => {
    const chunk = user([{ type: 'tool_result', tool_use_id: 't', content: 'see https://evil.example/' }]);
    expect(extractPreviewItems(chunk)).toEqual([]);
  });

  it('相対パス・サブエージェントの行・壊れた行は拾わない', () => {
    const chunk = [
      assistant(tool('Read', { file_path: 'relative.ts' })),
      assistant(tool('Read', { file_path: '/w/side.ts' }), undefined, { isSidechain: true }),
      '{',
      assistant(tool('WebFetch', { url: 'file:///etc/passwd' })),
    ].join('\n');
    expect(extractPreviewItems(chunk)).toEqual([]);
  });

  it('上限まで返す', () => {
    const chunk = Array.from({ length: 5 }, (_, i) => assistant(tool('Read', { file_path: `/w/${i}.ts` }))).join('\n');
    expect(extractPreviewItems(chunk, 2).map(previewKey)).toEqual(['file:/w/4.ts', 'file:/w/3.ts']);
  });
});

describe('isSensitivePath', () => {
  it.each(['/w/.env', '/w/.env.local', '/k/server.pem', '/h/.ssh/id_ed25519', '/w/credentials.json', '/h/.npmrc'])(
    '%s は伏せる',
    (path) => {
      expect(isSensitivePath(path)).toBe(true);
    },
  );

  it.each(['/w/README.md', '/w/src/env.ts', '/w/tokenizer.ts'])('%s は伏せない', (path) => {
    expect(isSensitivePath(path)).toBe(false);
  });
});

describe('imageMimeType', () => {
  it('画像の拡張子だけ', () => {
    expect(imageMimeType('/w/a.PNG')).toBe('image/png');
    expect(imageMimeType('/w/a.svg')).toBe('image/svg+xml');
    expect(imageMimeType('/w/a.ts')).toBeNull();
  });
});
