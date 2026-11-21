import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findLastAssistantText, findLastCwd } from './parseTranscript.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'fixtures');

const line = (value: unknown): string => JSON.stringify(value);

const assistant = (id: string, content: unknown, extra: Record<string, unknown> = {}) =>
  line({ type: 'assistant', message: { id, role: 'assistant', content }, ...extra });

describe('findLastAssistantText', () => {
  it('最後の assistant 発言の本文を返す', () => {
    const chunk = [
      assistant('m1', [{ type: 'text', text: '最初の発言' }]),
      line({ type: 'user', message: { content: 'つづけて' } }),
      assistant('m2', [{ type: 'text', text: '最後の報告' }]),
    ].join('\n');
    expect(findLastAssistantText(chunk)).toBe('最後の報告');
  });

  it('ツール呼び出しだけの行は発言とみなさない', () => {
    const chunk = [
      assistant('m1', [{ type: 'text', text: '報告です' }]),
      assistant('m2', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]),
    ].join('\n');
    expect(findLastAssistantText(chunk)).toBe('報告です');
  });

  it('同じ message.id の text はつなげる', () => {
    const chunk = [
      assistant('m1', [{ type: 'text', text: '前半' }]),
      assistant('m1', [{ type: 'text', text: '後半' }]),
    ].join('\n');
    expect(findLastAssistantText(chunk)).toBe('前半\n後半');
  });

  it('サブエージェント（sidechain）の発言は除く', () => {
    const chunk = [
      assistant('m1', [{ type: 'text', text: '親の報告' }]),
      assistant('m2', [{ type: 'text', text: '子の報告' }], { isSidechain: true }),
    ].join('\n');
    expect(findLastAssistantText(chunk)).toBe('親の報告');
  });

  it('壊れた行・知らない行は読み飛ばす', () => {
    const chunk = ['{', line({ type: 'mystery' }), assistant('m1', '文字列の本文')].join('\n');
    expect(findLastAssistantText(chunk)).toBe('文字列の本文');
  });

  it('発言が無ければ undefined', () => {
    expect(findLastAssistantText('')).toBeUndefined();
  });

  it('transcript の見本から最後の報告を取れる', () => {
    const chunk = readFileSync(join(FIXTURES, 'transcripts', 'worker-report.jsonl'), 'utf8');
    expect(findLastAssistantText(chunk)).toBe(
      'テストを 3 件追加しました。\n- npm test は通っています\n- 差分は src/notify.test.ts だけです',
    );
  });
});

describe('findLastCwd', () => {
  it('最後に記録された作業ディレクトリ（worktree へ移った後の場所）を返す', () => {
    const chunk = [
      JSON.stringify({ type: 'user', cwd: '/w/app' }),
      JSON.stringify({ type: 'assistant', cwd: '/w/app/.claude/worktrees/tests' }),
      JSON.stringify({ type: 'assistant', cwd: '/elsewhere', isSidechain: true }),
      '{',
    ].join('\n');
    expect(findLastCwd(chunk)).toBe('/w/app/.claude/worktrees/tests');
  });

  it('無ければ undefined', () => {
    expect(findLastCwd('')).toBeUndefined();
  });
});
