import { describe, expect, it } from 'vitest';
import { parseConversation, summarizeTool } from './conversation.js';

const line = (value: unknown) => JSON.stringify(value);
const user = (uuid: string, content: unknown, extra: object = {}) =>
  line({ type: 'user', uuid, timestamp: '2026-11-21T08:00:00Z', message: { role: 'user', content }, ...extra });
const assistant = (uuid: string, content: unknown, extra: object = {}) =>
  line({ type: 'assistant', uuid, timestamp: '2026-11-21T08:00:01Z', message: { role: 'assistant', content }, ...extra });

describe('parseConversation', () => {
  it('人の依頼・返事・ツールの呼び出しを順に並べる', () => {
    const chunk = [
      user('u1', 'cuse の指揮役として起動しました。'),
      user('u2', 'README の誤字を直して'),
      assistant('a1', [
        { type: 'thinking', thinking: '…' },
        { type: 'text', text: '配下を起こします。' },
        { type: 'tool_use', name: 'Bash', input: { command: 'cuse spawn "誤字を直す" readme-fix\n--cwd ~/w' } },
      ]),
      user('u3', [{ type: 'tool_result', tool_use_id: 't', content: 'backgrounded' }]),
      assistant('a2', [{ type: 'text', text: '起こしました。' }]),
    ].join('\n');
    expect(parseConversation(chunk, { systemPrompts: ['cuse の指揮役として起動しました。'] })).toEqual([
      { kind: 'system', id: 'u1:0', text: 'cuse の指揮役として起動しました。', at: Date.parse('2026-11-21T08:00:00Z') },
      { kind: 'user', id: 'u2:0', text: 'README の誤字を直して', at: Date.parse('2026-11-21T08:00:00Z') },
      { kind: 'assistant', id: 'a1:1', text: '配下を起こします。', at: Date.parse('2026-11-21T08:00:01Z') },
      { kind: 'tool', id: 'a1:2', name: 'Bash', summary: 'cuse spawn "誤字を直す" readme-fix', at: Date.parse('2026-11-21T08:00:01Z') },
      { kind: 'assistant', id: 'a2:0', text: '起こしました。', at: Date.parse('2026-11-21T08:00:01Z') },
    ]);
  });

  it('サブエージェント・isMeta・Claude Code が内部で足した行・壊れた行は出さない', () => {
    const chunk = [
      assistant('s1', [{ type: 'text', text: 'サブエージェント' }], { isSidechain: true }),
      user('m1', 'メタ', { isMeta: true }),
      user('c1', '<command-name>/model</command-name>'),
      user('c2', '<local-command-stdout>Set model</local-command-stdout>'),
      user('r1', [{ type: 'text', text: '<system-reminder>x</system-reminder>' }]),
      '{',
    ].join('\n');
    expect(parseConversation(chunk)).toEqual([]);
  });

  it('上限を超えたら新しい方を残す', () => {
    const chunk = Array.from({ length: 5 }, (_, i) => user(`u${i}`, `依頼 ${i}`)).join('\n');
    expect(parseConversation(chunk, { limit: 2 }).map((entry) => (entry.kind === 'tool' ? '' : entry.text))).toEqual([
      '依頼 3',
      '依頼 4',
    ]);
  });
});

describe('summarizeTool', () => {
  it('ツールごとに分かりやすい値を 1 行にする', () => {
    expect(summarizeTool('Read', { file_path: '/w/a.ts' })).toBe('/w/a.ts');
    expect(summarizeTool('WebFetch', { url: 'https://example.com', prompt: 'x' })).toBe('https://example.com');
    expect(summarizeTool('Other', { foo: 1, bar: 'あ' })).toBe('あ');
    expect(summarizeTool('Bash', { command: 'x'.repeat(200) })).toHaveLength(161);
  });
});
