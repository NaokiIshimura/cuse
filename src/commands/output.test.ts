import { describe, expect, it } from 'vitest';
import { makeAgent } from '../../test/support/agents.js';
import { buildOutputResult, formatOutputText } from './output.js';

const agent = makeAgent({ name: 'tests', id: 'abcd1234', state: 'waiting' });

describe('buildOutputResult', () => {
  it('最後の報告とログをまとめる', () => {
    expect(buildOutputResult(agent, '終わりました', { ok: true, lines: ['l1', 'l2'] })).toEqual({
      name: 'tests',
      sessionId: 'tests-session',
      shortId: 'abcd1234',
      state: 'waiting',
      lastReport: '終わりました',
      logs: ['l1', 'l2'],
      logsError: null,
    });
  });

  it('ログが取れなければ理由を残す', () => {
    const result = buildOutputResult(agent, null, { ok: false, message: '取れません' });
    expect(result.logs).toBeNull();
    expect(result.logsError).toBe('取れません');
  });
});

describe('formatOutputText', () => {
  it('報告とログを見出しで分ける', () => {
    const text = formatOutputText(buildOutputResult(agent, '報告', { ok: true, lines: ['x'] }));
    expect(text).toBe('# tests（waiting）\n\n## 最後の報告\n報告\n\n## claude logs\nx');
  });

  it('取れなかったものはそう書く', () => {
    const text = formatOutputText(buildOutputResult(agent, null, { ok: false, message: '理由' }));
    expect(text).toContain('（transcript から読み取れませんでした）');
    expect(text).toContain('（理由）');
  });
});
