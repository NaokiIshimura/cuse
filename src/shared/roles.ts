import type { Ledger, LedgerWorker } from '../core/ledger.js';
import type { Agent } from '../types/agent.js';

/**
 * セッションを「指揮役・配下・それ以外」に分ける。
 *
 * どれが cuse の配下かは台帳だけで決める。名前で推測すると、人が手で動かしている
 * 同名のセッションを配下と取り違え、第 2 段階の `kill` / `clean` で触ってしまうおそれがあるため。
 */

export type Role = 'leader' | 'worker' | 'other';

export interface Roster {
  readonly leader: Agent | null;
  readonly workers: readonly Agent[];
  readonly others: readonly Agent[];
  /** sessionId → 台帳の記録。配下のタスクなどを引くのに使う */
  readonly ledgerWorkers: ReadonlyMap<string, LedgerWorker>;
}

export const buildRoster = (agents: readonly Agent[], ledger: Ledger | null): Roster => {
  const leaderId = ledger?.leader?.sessionId;
  const ledgerWorkers = new Map(
    (ledger?.workers ?? []).map((worker) => [worker.sessionId, worker] as const),
  );

  let leader: Agent | null = null;
  const workers: Agent[] = [];
  const others: Agent[] = [];
  for (const agent of agents) {
    if (leaderId !== undefined && agent.sessionId === leaderId) {
      leader = agent;
    } else if (ledgerWorkers.has(agent.sessionId)) {
      workers.push(agent);
    } else {
      others.push(agent);
    }
  }
  return { leader, workers, others, ledgerWorkers };
};

export const roleOf = (roster: Roster, agent: Agent): Role => {
  if (roster.leader?.sessionId === agent.sessionId) {
    return 'leader';
  }
  return roster.ledgerWorkers.has(agent.sessionId) ? 'worker' : 'other';
};
