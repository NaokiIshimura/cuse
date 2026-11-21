import type { ReadLedgerResult } from '../core/ledger.js';
import { buildRoster, roleOf } from '../shared/roles.js';
import { sortAgents } from '../shared/sortAgents.js';
import { formatPendingTool } from '../shared/statusDetail.js';
import { WAITING_FOR_LABELS } from '../shared/waitingFor.js';
import type { Agent } from '../types/agent.js';
import { formatDuration } from '../utils/formatDuration.js';
import { stateLabel, toAgentView, type AgentView } from './agentView.js';

/**
 * `cuse agents [--all]`。
 *
 * 既定は台帳に載った配下だけ。第 1 段階は台帳が無いので空になり、
 * マシン上の全セッションを見るには `--all` を付ける。
 */

export type Scope = 'workers' | 'all';

export interface AgentsOutput {
  readonly scope: Scope;
  /** 台帳の読み取り結果。`missing` は第 1 段階では普通の状態 */
  readonly ledger: ReadLedgerResult['kind'];
  readonly agents: readonly AgentView[];
}

export const buildAgentsOutput = (
  agents: readonly Agent[],
  ledger: ReadLedgerResult,
  options: { readonly all: boolean; readonly now: number },
): AgentsOutput => {
  const roster = buildRoster(agents, ledger.kind === 'ok' ? ledger.ledger : null);
  const targets = options.all ? agents : roster.workers;
  return {
    scope: options.all ? 'all' : 'workers',
    ledger: ledger.kind,
    agents: sortAgents(targets).map((agent) =>
      toAgentView(
        agent,
        roleOf(roster, agent),
        options.now,
        roster.ledgerWorkers.get(agent.sessionId),
      ),
    ),
  };
};

const percent = (ratio: number): string => `${Math.round(ratio * 100)}%`;

/** 1 行の説明。承認待ちなら対象のツール、そうでなければ最後の指示。 */
const describeView = (view: AgentView): string => {
  if (view.pendingTool !== null) {
    return formatPendingTool(view.pendingTool);
  }
  return view.lastPrompt === null ? '' : `> ${view.lastPrompt}`;
};

/** 人が読む表。列は「名前・状態・待ち・経過・ctx・説明」。 */
export const formatAgentsText = (output: AgentsOutput): string => {
  if (output.agents.length === 0) {
    if (output.scope === 'workers') {
      return output.ledger === 'ok'
        ? '動いている配下はいません。'
        : '台帳（~/.cuse/ledger.json）がまだ無いので、配下はいません。マシン上の全セッションは cuse agents --all で見られます。';
    }
    return 'このマシンで動いている Claude Code セッションはありません。';
  }

  const rows = output.agents.map((view) => [
    view.role === 'leader' ? `${view.name} [指揮役]` : view.name,
    stateLabel(view),
    view.waitingFor === null ? '-' : WAITING_FOR_LABELS[view.waitingFor],
    view.elapsedMs === null ? '-' : formatDuration(view.elapsedMs),
    view.context === null ? '-' : percent(view.context.ratio),
    view.subagents > 0 ? `${describeView(view)} (サブエージェント ${view.subagents})`.trim() : describeView(view),
  ]);
  const header = ['名前', '状態', '待ち', '経過', 'ctx', '説明'];
  return formatTable([header, ...rows]);
};

/** 全角文字を 2 桁と数えて揃える。 */
const displayWidth = (text: string): number =>
  [...text].reduce((width, char) => width + (/[ᄀ-￿]/.test(char) ? 2 : 1), 0);

const pad = (text: string, width: number): string =>
  text + ' '.repeat(Math.max(width - displayWidth(text), 0));

export const formatTable = (rows: readonly (readonly string[])[]): string => {
  const columns = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_, index) =>
    Math.max(...rows.map((row) => displayWidth(row[index] ?? ''))),
  );
  return rows
    .map((row) =>
      row
        .map((cell, index) => (index === row.length - 1 ? cell : pad(cell, widths[index] ?? 0)))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
};
