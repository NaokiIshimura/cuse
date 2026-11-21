import { MAX_WORKERS } from '../config/defaults.js';
import type { Agent } from '../types/agent.js';

/**
 * 健全性の警告。上端のバーと `cuse status` に出す。
 *
 * - `stopped`: 台帳に載った配下が、完了せずに止まっている・状態が分からない
 * - `long-approval`: 承認待ちが長く続いている（人が気づいていないかもしれない）
 * - `near-limit`: 動いている配下の数が上限に達している
 */

export type HealthWarningKind = 'stopped' | 'long-approval' | 'near-limit';

export interface HealthWarning {
  readonly kind: HealthWarningKind;
  readonly message: string;
  /** 関係する配下の名前 */
  readonly names: readonly string[];
}

/** 承認待ちがこれを超えたら警告する。 */
export const LONG_APPROVAL_MS = 5 * 60 * 1000;

/** 動いている（完了・停止していない）とみなす状態。 */
const ACTIVE_STATES = new Set<Agent['state']>(['working', 'justFinished', 'waiting', 'blocked']);

export const countActive = (workers: readonly Agent[]): number =>
  workers.filter((worker) => ACTIVE_STATES.has(worker.state)).length;

export interface HealthOptions {
  readonly now: number;
  /**
   * sessionId → 承認待ちになった時刻。CLI は 1 回きりの取得で遷移を知らないので渡さない。
   * GUI はポーリングの差分から作って渡す。
   */
  readonly blockedSince?: ReadonlyMap<string, number>;
  readonly maxWorkers?: number;
}

export const healthWarnings = (
  workers: readonly Agent[],
  options: HealthOptions,
): HealthWarning[] => {
  const warnings: HealthWarning[] = [];
  const maxWorkers = options.maxWorkers ?? MAX_WORKERS;

  const stopped = workers.filter((w) => w.state === 'stopped' || w.state === 'unknown');
  if (stopped.length > 0) {
    warnings.push({
      kind: 'stopped',
      message: `止まっている配下があります: ${stopped.map((w) => w.name).join(', ')}`,
      names: stopped.map((w) => w.name),
    });
  }

  const longApproval = workers.filter((w) => {
    const since = options.blockedSince?.get(w.sessionId);
    return w.state === 'blocked' && since !== undefined && options.now - since >= LONG_APPROVAL_MS;
  });
  if (longApproval.length > 0) {
    warnings.push({
      kind: 'long-approval',
      message: `承認待ちが ${LONG_APPROVAL_MS / 60000} 分以上続いています: ${longApproval.map((w) => w.name).join(', ')}`,
      names: longApproval.map((w) => w.name),
    });
  }

  const active = countActive(workers);
  if (active >= maxWorkers) {
    warnings.push({
      kind: 'near-limit',
      message: `同時に動かす配下が上限（${maxWorkers}）に達しています（${active}/${maxWorkers}）`,
      names: [],
    });
  }

  return warnings;
};
