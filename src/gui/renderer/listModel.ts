import type { ReadLedgerResult } from '../../core/ledger.js';
import { countActive, healthWarnings, type HealthWarning } from '../../shared/health.js';
import { buildRoster } from '../../shared/roles.js';
import { sortAgents } from '../../shared/sortAgents.js';
import { waitingForOf } from '../../shared/waitingFor.js';
import type { Agent } from '../../types/agent.js';

/**
 * 上端のバーと左の一覧に出すものを組み立てる。描画から切り離してテストする。
 *
 * - `workers`: 台帳に載った配下だけ（既定）
 * - `all`: マシン上の全セッション。台帳が無い第 1 段階でも眺められるようにする切り替え
 */
export type ListScope = 'workers' | 'all';

/** 一覧の下に「DONE」として薄く出す状態。 */
const FINISHED_STATES = new Set<Agent['state']>(['done', 'stopped']);

export interface ListModel {
  readonly leader: Agent | null;
  /** 動いているもの。承認待ちが先頭 */
  readonly active: readonly Agent[];
  /** 終わったもの */
  readonly finished: readonly Agent[];
  /** 動いている配下の数（上端のバーの「配下 n/上限」） */
  readonly activeCount: number;
  /** 人の対応が要る数（承認待ち・入力待ち） */
  readonly attentionCount: number;
  readonly warnings: readonly HealthWarning[];
  /** 台帳が無い・読めない。切り替えの案内に使う */
  readonly ledgerAvailable: boolean;
  /** 台帳に載った配下の sessionId。「止める」は台帳の配下にだけ出す */
  readonly workerIds: ReadonlySet<string>;
}

export interface BuildListModelOptions {
  readonly scope: ListScope;
  readonly now: number;
  readonly maxWorkers: number;
  readonly blockedSince: ReadonlyMap<string, number>;
}

export const buildListModel = (
  agents: readonly Agent[],
  ledger: ReadLedgerResult,
  options: BuildListModelOptions,
): ListModel => {
  const roster = buildRoster(agents, ledger.kind === 'ok' ? ledger.ledger : null);
  // 指揮役は上端のバーに出すので、一覧には並べない
  const targets =
    options.scope === 'all'
      ? agents.filter((agent) => agent.sessionId !== roster.leader?.sessionId)
      : roster.workers;
  const sorted = sortAgents(targets);

  return {
    leader: roster.leader,
    active: sorted.filter((agent) => !FINISHED_STATES.has(agent.state)),
    finished: sorted.filter((agent) => FINISHED_STATES.has(agent.state)),
    activeCount: countActive(roster.workers),
    attentionCount: targets.filter((agent) => waitingForOf(agent.state, agent.waitingFor) !== null).length,
    warnings: healthWarnings(roster.workers, {
      now: options.now,
      blockedSince: options.blockedSince,
      maxWorkers: options.maxWorkers,
    }),
    ledgerAvailable: ledger.kind === 'ok',
    workerIds: new Set(roster.ledgerWorkers.keys()),
  };
};

/**
 * 承認待ちになった時刻の表を更新する。長い承認待ちの警告に使う。
 *
 * ウィンドウを開いた時点で既に承認待ちだったものは、開いた時刻から数える
 * （それより前の時刻は分からないため）。内容が変わらなければ元の表をそのまま返す。
 */
export const nextBlockedSince = (
  current: ReadonlyMap<string, number>,
  agents: readonly Agent[],
  now: number,
): ReadonlyMap<string, number> => {
  const next = new Map<string, number>();
  for (const agent of agents) {
    if (agent.state === 'blocked') {
      next.set(agent.sessionId, current.get(agent.sessionId) ?? now);
    }
  }
  const unchanged =
    next.size === current.size &&
    [...next].every(([sessionId, since]) => current.get(sessionId) === since);
  return unchanged ? current : next;
};
