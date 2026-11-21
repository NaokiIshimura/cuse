import { MIN_CLAUDE_VERSION } from '../config/defaults.js';
import { execFileRunner, toCommandError, type CommandRunner } from './runCommand.js';

/**
 * `claude --version` を確かめる。
 *
 * background セッションに対応していない古い Claude Code では、一覧が空のまま
 * 何も起きないように見えるため、使い始めの段階で分かる言葉で知らせる。
 */

/** `2.1.325 (Claude Code)` のような出力から、数字の並びを取り出す。 */
export const parseVersion = (text: string): readonly number[] | null => {
  const matched = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (matched === null) {
    return null;
  }
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])];
};

/** a < b なら負、等しければ 0、a > b なら正。 */
export const compareVersions = (a: readonly number[], b: readonly number[]): number => {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
};

export type ClaudeVersionCheck =
  | { readonly ok: true; readonly version: string }
  | {
      readonly ok: false;
      readonly kind: 'too-old' | 'unknown' | 'not-found';
      readonly version: string | null;
      readonly message: string;
    };

export interface CheckClaudeVersionOptions {
  readonly runner?: CommandRunner;
  readonly command?: string;
  readonly minimum?: string;
  readonly timeoutMs?: number;
}

/** 出力から判定する。実行の失敗とは分けておき、テストしやすくする。 */
export const judgeClaudeVersion = (
  stdout: string,
  minimum: string = MIN_CLAUDE_VERSION,
): ClaudeVersionCheck => {
  const version = parseVersion(stdout);
  const required = parseVersion(minimum);
  if (version === null || required === null) {
    return {
      ok: false,
      kind: 'unknown',
      version: null,
      message: `Claude Code のバージョンを読み取れませんでした（claude --version: ${stdout.trim()}）。v${minimum} 以降が必要です。`,
    };
  }
  const text = version.join('.');
  if (compareVersions(version, required) < 0) {
    return {
      ok: false,
      kind: 'too-old',
      version: text,
      message: `Claude Code v${text} は background セッションに対応していません。v${minimum} 以降へ更新してください（claude update）。`,
    };
  }
  return { ok: true, version: text };
};

export const checkClaudeVersion = async (
  options: CheckClaudeVersionOptions = {},
): Promise<ClaudeVersionCheck> => {
  const runner = options.runner ?? execFileRunner;
  try {
    const stdout = await runner(options.command ?? 'claude', ['--version'], {
      timeoutMs: options.timeoutMs ?? 5000,
      signal: undefined,
    });
    return judgeClaudeVersion(stdout, options.minimum);
  } catch (error) {
    const { kind, message } = toCommandError(error, 'claude --version がタイムアウトしました。');
    return {
      ok: false,
      kind: kind === 'not-found' ? 'not-found' : 'unknown',
      version: null,
      message,
    };
  }
};
