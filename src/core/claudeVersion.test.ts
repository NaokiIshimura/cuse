import { describe, expect, it } from 'vitest';
import { checkClaudeVersion, compareVersions, judgeClaudeVersion, parseVersion } from './claudeVersion.js';

describe('parseVersion', () => {
  it('claude --version の出力から数字を取り出す', () => {
    expect(parseVersion('2.1.325 (Claude Code)\n')).toEqual([2, 1, 325]);
  });

  it('数字が無ければ null', () => {
    expect(parseVersion('unknown')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('桁ごとに数として比べる（文字列比較にしない）', () => {
    expect(compareVersions([2, 1, 139], [2, 1, 99])).toBeGreaterThan(0);
    expect(compareVersions([2, 1, 138], [2, 1, 139])).toBeLessThan(0);
    expect(compareVersions([2, 1, 139], [2, 1, 139])).toBe(0);
  });
});

describe('judgeClaudeVersion', () => {
  it('対応版以降なら ok', () => {
    expect(judgeClaudeVersion('2.1.139 (Claude Code)', '2.1.139')).toEqual({
      ok: true,
      version: '2.1.139',
    });
  });

  it('古ければ更新を促す', () => {
    const result = judgeClaudeVersion('2.1.100 (Claude Code)', '2.1.139');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('too-old');
      expect(result.message).toContain('v2.1.139 以降');
    }
  });

  it('読み取れなければ unknown', () => {
    const result = judgeClaudeVersion('???', '2.1.139');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('unknown');
    }
  });
});

describe('checkClaudeVersion', () => {
  it('claude --version を実行して判定する', async () => {
    const calls: string[][] = [];
    const result = await checkClaudeVersion({
      runner: async (command, args) => {
        calls.push([command, ...args]);
        return '2.1.325 (Claude Code)\n';
      },
    });
    expect(calls).toEqual([['claude', '--version']]);
    expect(result).toEqual({ ok: true, version: '2.1.325' });
  });

  it('claude が無ければ not-found', async () => {
    const result = await checkClaudeVersion({
      runner: async () => {
        throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('not-found');
    }
  });
});
