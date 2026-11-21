import type { ReadLogsResult } from '../core/readOutput.js';
import type { Agent } from '../types/agent.js';

/**
 * `cuse output <名前>`。最後の報告と `claude logs` の末尾を返す。
 *
 * 指揮役が配下の結果を回収するためのコマンド。取れなかったものは null と理由を返し、
 * 片方だけでも取れれば成功として扱う（transcript だけ読める interactive セッションもあるため）。
 */

export interface OutputResult {
  readonly name: string;
  readonly sessionId: string;
  readonly shortId: string | null;
  readonly state: Agent['state'];
  /** 最後の assistant 発言。取れなければ null */
  readonly lastReport: string | null;
  /** `claude logs` の末尾。取れなければ null */
  readonly logs: readonly string[] | null;
  /** `logs` が null の理由 */
  readonly logsError: string | null;
}

export const buildOutputResult = (
  agent: Agent,
  lastReport: string | null,
  logs: ReadLogsResult,
): OutputResult => ({
  name: agent.name,
  sessionId: agent.sessionId,
  shortId: agent.id ?? null,
  state: agent.state,
  lastReport,
  logs: logs.ok ? logs.lines : null,
  logsError: logs.ok ? null : logs.message,
});

export const formatOutputText = (result: OutputResult): string => {
  const lines = [`# ${result.name}（${result.state}）`, '', '## 最後の報告'];
  lines.push(result.lastReport ?? '（transcript から読み取れませんでした）');
  lines.push('', '## claude logs');
  if (result.logs === null) {
    lines.push(`（${result.logsError ?? '取得できませんでした'}）`);
  } else if (result.logs.length === 0) {
    lines.push('（出力はまだありません）');
  } else {
    lines.push(...result.logs);
  }
  return lines.join('\n');
};
