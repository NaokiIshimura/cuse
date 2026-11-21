import { describe, expect, it } from 'vitest';
import { highlightLines, languageOf, languageOfFence, splitLines } from './highlight.js';

describe('languageOf', () => {
  it('拡張子とファイル名から言語を決める。分からなければ null', () => {
    expect(languageOf('/w/a.tsx')).toBe('typescript');
    expect(languageOf('/w/b.PY')).toBe('python');
    expect(languageOf('/w/Makefile')).toBe('makefile');
    expect(languageOf('/w/.env')).toBeNull();
    expect(languageOf('/w/data.unknownext')).toBeNull();
  });

  it('コードブロックの言語名も、拡張子の書き方を受ける', () => {
    expect(languageOfFence('ts')).toBe('typescript');
    expect(languageOfFence('bash')).toBe('bash');
    expect(languageOfFence('mermaid')).toBeNull();
    expect(languageOfFence('')).toBeNull();
  });
});

describe('highlightLines', () => {
  it('色の付いた断片を行ごとに返す', () => {
    const lines = highlightLines('const a = "x";\nlet b = 2;', 'typescript');
    expect(lines).toHaveLength(2);
    expect(lines[0]?.[0]).toEqual({ text: 'const', classes: ['hljs-keyword'] });
    expect(lines.map((line) => line.map((segment) => segment.text).join(''))).toEqual(['const a = "x";', 'let b = 2;']);
  });

  it('複数行にまたがる色（コメント）は、行ごとに切り分けて両方に色を残す', () => {
    const lines = highlightLines('/* a\nb */\nx', 'javascript');
    expect(lines[0]).toEqual([{ text: '/* a', classes: ['hljs-comment'] }]);
    expect(lines[1]).toEqual([{ text: 'b */', classes: ['hljs-comment'] }]);
  });

  it('言語が分からなければ色なし。空行は空の配列', () => {
    expect(highlightLines('a\n\nb', null)).toEqual([[{ text: 'a', classes: [] }], [], [{ text: 'b', classes: [] }]]);
  });

  it('splitLines は末尾の改行で空の行を作る', () => {
    expect(splitLines([{ text: 'a\n', classes: ['x'] }])).toEqual([[{ text: 'a', classes: ['x'] }], []]);
  });
});
