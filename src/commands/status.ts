import { MAX_WORKERS } from '../config/defaults.js';
import type { ReadLedgerResult } from '../core/ledger.js';
import { countActive, healthWarnings, type HealthWarning } from '../shared/health.js';
import { buildRoster } from '../shared/roles.js';
import { formatPendingTool } from '../shared/statusDetail.js';
import { sortAgents } from '../shared/sortAgents.js';
import { WAITING_FOR_LABELS, waitingForOf, type WaitingFor } from '../shared/waitingFor.js';
import type { Agent, CharacterState } from '../types/agent.js';
import type { Scope } from './agents.js';

/**
 * `cuse status`。配下の数、状態ごとの件数、人の対応が要るものを返す。
 *
 * 指揮役が「いま人に何を回すべきか」を 1 回で知るためのコマンド。
 * 承認待ちを先に、入力待ちを後に並べる。
 */

export interface AttentionItem {
  readonly name: string;
  readonly sessionId: string;
  readonly waitingFor: WaitingFor;
  /** 承認待ちの対象（`Bash: npm test` など）。分からなければ null */
  readonly reason: string | null;
}

export interface StatusOutput {
  readonly scope: Scope;
  readonly ledger: ReadLedgerResult['kind'];
  readonly leader: { readonly name: string; readonly state: CharacterState } | null;
  /** 対象のセッション数 */
  readonly total: number;
  /** 動いている（完了・停止していない）数 */
  readonly active: number;
  /** 同時に動かす配下の上限 */
  readonly maxWorkers: number;
  readonly counts: Readonly<Record<CharacterState, number>>;
  readonly attention: readonly AttentionItem[];
  readonly warnings: readonly HealthWarning[];
}

const emptyCounts = (): Record<CharacterState, number> => ({
  working: 0,
  justFinished: 0,
  waiting: 0,
  blocked: 0,
  done: 0,
  stopped: 0,
  unknown: 0,
});

export const buildStatusOutput = (
  agents: readonly Agent[],
  ledger: ReadLedgerResult,
  options: { readonly all: boolean; readonly now: number },
): StatusOutput => {
  const roster = buildRoster(agents, ledger.kind === 'ok' ? ledger.ledger : null);
  const targets = options.all ? agents : roster.workers;

  const counts = emptyCounts();
  for (const agent of targets) {
    counts[agent.state] += 1;
  }

  const attention: AttentionItem[] = [];
  for (const agent of sortAgents(targets)) {
    const waitingFor = waitingForOf(agent.state);
    if (waitingFor === null) {
      continue;
    }
    const tool = agent.state === 'blocked' ? agent.meta?.pendingTool : undefined;
    attention.push({
      name: agent.name,
      sessionId: agent.sessionId,
      waitingFor,
      reason: tool === undefined ? null : formatPendingTool(tool),
    });
  }

  return {
    scope: options.all ? 'all' : 'workers',
    ledger: ledger.kind,
    leader:
      roster.leader === null ? null : { name: roster.leader.name, state: roster.leader.state },
    total: targets.length,
    active: countActive(targets),
    maxWorkers: MAX_WORKERS,
    counts,
    attention,
    // 健全性は配下についてだけ見る（--all の他人のセッションまで警告しない）
    warnings: healthWarnings(roster.workers, { now: options.now }),
  };
};

const COUNT_LABELS: readonly (readonly [CharacterState, string])[] = [
  ['blocked', '承認待ち'],
  ['waiting', '入力待ち'],
  ['working', '作業中'],
  ['done', '完了'],
  ['stopped', '停止'],
  ['unknown', '不明'],
];

export const formatStatusText = (output: StatusOutput): string => {
  const lines: string[] = [];
  const subject = output.scope === 'all' ? 'セッション' : '配下';
  lines.push(
    output.leader === null
      ? '指揮役: なし'
      : `指揮役: ${output.leader.name}（${output.leader.state}）`,
  );
  lines.push(
    output.scope === 'all'
      ? `${subject}: ${output.total}`
      : `${subject}: ${output.active}/${output.maxWorkers}（全 ${output.total}）`,
  );
  if (output.scope === 'workers' && output.ledger !== 'ok') {
    lines.push(
      output.ledger === 'missing'
        ? '台帳（~/.cuse/ledger.json）がまだありません。全セッションは cuse status --all で見られます。'
        : '台帳を読めませんでした。全セッションは cuse status --all で見られます。',
    );
  }
  const counts = COUNT_LABELS.filter(([state]) => output.counts[state] > 0).map(
    ([state, label]) => `${label} ${output.counts[state]}`,
  );
  if (counts.length > 0) {
    lines.push(`内訳: ${counts.join(' / ')}`);
  }
  if (output.attention.length > 0) {
    lines.push('', '人の対応が要るもの:');
    for (const item of output.attention) {
      const reason = item.reason === null ? '' : ` — ${item.reason}`;
      lines.push(`  ${item.name}: ${WAITING_FOR_LABELS[item.waitingFor]}${reason}`);
    }
  }
  if (output.warnings.length > 0) {
    lines.push('', '警告:');
    for (const warning of output.warnings) {
      lines.push(`  ${warning.message}`);
    }
  }
  return lines.join('\n');
};
