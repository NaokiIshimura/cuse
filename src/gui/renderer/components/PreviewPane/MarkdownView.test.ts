import { describe, expect, it } from 'vitest';
import { linkifyMarkdown } from './MarkdownView.js';

describe('linkifyMarkdown', () => {
  it('文の中のファイル名・URL をリンクの書き方にする', () => {
    expect(linkifyMarkdown('~/.claude/tmp/a.md を作りました。https://example.com も')).toBe(
      '[~/.claude/tmp/a.md](<~/.claude/tmp/a.md>) を作りました。[https://example.com](<https://example.com>) も',
    );
  });

  it('コードブロック・インラインコード・既にあるリンクの中は変えない', () => {
    const text = ['`src/a.ts` と [資料](https://example.org/x.md)', '```', 'cat README.md', '```'].join('\n');
    expect(linkifyMarkdown(text)).toBe(text);
  });
});
