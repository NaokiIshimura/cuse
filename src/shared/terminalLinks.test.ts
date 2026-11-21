import { describe, expect, it } from 'vitest';
import { findTerminalLinks } from './terminalLinks.js';

const texts = (line: string) => findTerminalLinks(line).map((link) => `${link.kind}:${link.text}`);

describe('findTerminalLinks', () => {
  it('URL を拾う（日本語・句読点で切る）', () => {
    expect(texts('テストなら https://example.com がおすすめ。https://www.wikipedia.orgを開いて')).toEqual([
      'url:https://example.com',
      'url:https://www.wikipedia.org',
    ]);
  });

  it('パスとファイル名を拾う', () => {
    expect(
      texts('作りました: ~/.claude/tmp/2026_1121_sample.md と /Users/naoki/work/app/src/a.ts、src/b.tsx と README.md'),
    ).toEqual([
      'file:~/.claude/tmp/2026_1121_sample.md',
      'file:/Users/naoki/work/app/src/a.ts',
      'file:src/b.tsx',
      'file:README.md',
    ]);
  });

  it('位置は行の文字列の中の位置', () => {
    const line = '⏺ Read(src/a.ts)';
    const [link] = findTerminalLinks(line);
    expect(link).toMatchObject({ text: 'src/a.ts', kind: 'file' });
    expect(line.slice(link?.start, link?.end)).toBe('src/a.ts');
  });

  it('版の番号・数・ただの単語・/ だけは拾わない', () => {
    expect(texts('v0.3.6 を出しました。1.5 倍。e.g. Done / ok')).toEqual([]);
  });

  it('URL の中のパスを別に拾わない', () => {
    expect(texts('http://localhost:5173/src/main.tsx')).toEqual(['url:http://localhost:5173/src/main.tsx']);
  });
});
