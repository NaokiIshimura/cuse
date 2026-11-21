/**
 * 操作系コマンド（start / spawn / prompt / wait / kill / install-skill）の結果の形。
 * runCli がこれを `--json` か文字に整えて出す。
 */

export type CommandErrorKind =
  | 'usage'
  | 'not-found'
  | 'ambiguous'
  | 'timeout'
  | 'exit'
  | 'aborted'
  | 'parse'
  /** 指揮役ではない（トークンが無い） */
  | 'denied'
  /** 上限に達した */
  | 'limit'
  /** 同じ名前の配下がいる・指揮役が既にいる */
  | 'conflict'
  /** claude --bg / stop が失敗した */
  | 'launch'
  /** 台帳を読めない・書けない */
  | 'ledger'
  /** Claude Code が古い */
  | 'version'
  /** そのフォルダを Claude Code がまだ信頼していない（ホームフォルダなど） */
  | 'untrusted';

export interface CommandError {
  readonly kind: CommandErrorKind;
  readonly message: string;
  readonly candidates?: readonly string[];
}

export type Outcome<T> =
  | { readonly ok: true; readonly value: T; readonly text: string; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly error: CommandError; readonly warnings: readonly string[] };

export const success = <T>(value: T, text: string, warnings: readonly string[] = []): Outcome<T> => ({
  ok: true,
  value,
  text,
  warnings,
});

export const failure = <T = never>(
  error: CommandError,
  warnings: readonly string[] = [],
): Outcome<T> => ({ ok: false, error, warnings });

/** 途中で失敗した Outcome に、それまでに集めた警告を足して返す。 */
export const withWarnings = <T>(outcome: Outcome<never>, warnings: readonly string[]): Outcome<T> =>
  outcome.ok ? outcome : { ...outcome, warnings: [...warnings, ...outcome.warnings] };
