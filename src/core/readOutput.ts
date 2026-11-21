import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { findLastAssistantText } from '../shared/parseTranscript.js';
import { buildTranscriptPath } from '../shared/transcriptPath.js';
import type { Agent } from '../types/agent.js';
import { execFileRunner, toCommandError, type CommandRunner } from './runCommand.js';

/**
 * `cuse output` で使う読み取り。
 *
 * - 最後の報告: transcript の末尾から最後の assistant 発言を取る
 * - `claude logs`: background セッションの出力の末尾
 *
 * どちらも取れなくても例外は投げず、取れたものだけを返す。
 */

/**
 * transcript の末尾から読むバイト数。
 * 最後の報告は末尾近くにあるはずなので、全体は読まない（数 MB に達するため）。
 */
export const OUTPUT_TAIL_BYTES = 256 * 1024;

/** ファイルの末尾 `bytes` ぶんを読む。途中で切れた先頭行は捨てる。 */
export const readTail = async (path: string, bytes: number): Promise<string> => {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(size - bytes, 0);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    if (start === 0) {
      return text;
    }
    const firstLineEnd = text.indexOf('\n');
    return firstLineEnd === -1 ? '' : text.slice(firstLineEnd + 1);
  } finally {
    await handle.close();
  }
};

export interface ReadLastReportOptions {
  readonly home?: string;
  /** テストから差し替える */
  readonly read?: (path: string, bytes: number) => Promise<string>;
}

/** 最後の assistant 発言。transcript が無い・読めない・発言が無ければ null。 */
export const readLastReport = async (
  agent: Pick<Agent, 'cwd' | 'sessionId'>,
  options: ReadLastReportOptions = {},
): Promise<string | null> => {
  const path = buildTranscriptPath(options.home ?? homedir(), agent.cwd, agent.sessionId);
  if (path === null) {
    return null;
  }
  try {
    const text = await (options.read ?? readTail)(path, OUTPUT_TAIL_BYTES);
    return findLastAssistantText(text) ?? null;
  } catch {
    return null;
  }
};

export type ReadLogsResult =
  | { readonly ok: true; readonly lines: readonly string[] }
  | { readonly ok: false; readonly message: string };

export interface ReadLogsOptions {
  readonly lines: number;
  readonly runner?: CommandRunner;
  readonly command?: string;
  readonly timeoutMs?: number;
}

/** 末尾 `count` 行を取る。末尾の空行は数えない。 */
export const tailLines = (text: string, count: number): string[] => {
  const lines = text.replace(/\n+$/, '').split('\n');
  if (lines.length === 1 && lines[0] === '') {
    return [];
  }
  return count <= 0 ? [] : lines.slice(-count);
};

/**
 * `claude logs <短縮 ID>` の末尾を読む。
 *
 * 名前での `claude logs` は v2.1.290 以降なので、どの対応版でも通る短縮 ID で指す。
 * interactive セッションは `claude logs` の対象外なので、読まずに理由を返す。
 */
export const readLogs = async (
  agent: Pick<Agent, 'kind' | 'id'>,
  options: ReadLogsOptions,
): Promise<ReadLogsResult> => {
  if (agent.kind !== 'background' || agent.id === undefined) {
    return {
      ok: false,
      message: 'background セッションではないため、claude logs はありません。',
    };
  }
  const runner = options.runner ?? execFileRunner;
  try {
    const stdout = await runner(options.command ?? 'claude', ['logs', agent.id], {
      timeoutMs: options.timeoutMs ?? 5000,
      signal: undefined,
    });
    return { ok: true, lines: tailLines(stdout, options.lines) };
  } catch (error) {
    return {
      ok: false,
      message: toCommandError(error, 'claude logs がタイムアウトしました。').message,
    };
  }
};
