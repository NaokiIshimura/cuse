import type { LedgerWorker } from '../core/ledger.js';
import { getAppearance } from '../shared/characters.js';
import type { Role } from '../shared/roles.js';
import { visibleSubagents } from '../shared/subagents.js';
import { waitingForOf, type WaitingFor } from '../shared/waitingFor.js';
import type { Agent } from '../types/agent.js';

/**
 * `--json` で出す 1 セッションぶんの形。
 *
 * 指揮役がこの形を読んで判断するため、項目の削除・意味の変更は minor を上げて README に書く。
 * 値が無いときは項目を省かず null を入れる（読む側が「無い」と「知らない項目」を区別できるように）。
 */
export interface AgentView {
  readonly name: string;
  /** cuse から見た役割。台帳に載っていなければ `other` */
  readonly role: Role;
  readonly sessionId: string;
  /** background セッションの短縮 ID。interactive なら null */
  readonly shortId: string | null;
  readonly kind: Agent['kind'];
  /** 正規化した状態（`working` / `waiting` / `blocked` / `done` / `stopped` / `unknown`） */
  readonly state: Agent['state'];
  /** `claude agents --json` の生の状態 */
  readonly rawState: string;
  /** 人の対応が要るなら何を待っているか */
  readonly waitingFor: WaitingFor | null;
  /** 承認待ちのツール。分からなければ null */
  readonly pendingTool: { readonly name: string; readonly detail: string } | null;
  /** 最後に与えた指示 */
  readonly lastPrompt: string | null;
  /** コンテキスト使用率 */
  readonly context: { readonly used: number; readonly limit: number; readonly ratio: number } | null;
  /** 実行中のサブエージェントの数 */
  readonly subagents: number;
  readonly cwd: string;
  /** 起動時刻（ISO 8601）。分からなければ null */
  readonly startedAt: string | null;
  readonly elapsedMs: number | null;
  /** 台帳に記録したタスク。台帳に載っていなければ null */
  readonly task: string | null;
}

export const toAgentView = (
  agent: Agent,
  role: Role,
  now: number,
  ledgerWorker?: LedgerWorker,
): AgentView => {
  const pending = agent.state === 'blocked' ? agent.meta?.pendingTool : undefined;
  const tokens = agent.meta?.tokens;
  return {
    name: agent.name,
    role,
    sessionId: agent.sessionId,
    shortId: agent.id ?? null,
    kind: agent.kind,
    state: agent.state,
    rawState: agent.rawState,
    waitingFor: waitingForOf(agent.state),
    pendingTool: pending === undefined ? null : { name: pending.name, detail: pending.detail },
    lastPrompt: agent.meta?.lastPrompt ?? null,
    context:
      tokens === undefined ? null : { used: tokens.used, limit: tokens.limit, ratio: tokens.ratio },
    subagents: visibleSubagents(agent, now).length,
    cwd: agent.cwd,
    startedAt: agent.startedAt > 0 ? new Date(agent.startedAt).toISOString() : null,
    elapsedMs: agent.startedAt > 0 ? Math.max(now - agent.startedAt, 0) : null,
    task: ledgerWorker?.task ?? null,
  };
};

/** 一覧の状態ラベル（`BUSY` など）。文字の表示で使う。 */
export const stateLabel = (view: Pick<AgentView, 'state'>): string =>
  getAppearance(view.state).label;
