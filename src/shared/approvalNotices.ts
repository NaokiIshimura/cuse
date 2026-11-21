import { diffAgents } from '../core/diffAgents.js';
import type { Agent } from '../types/agent.js';

/**
 * 承認待ちになった配下の OS 通知。
 *
 * 人に回すものの中でいちばん急ぐのが承認待ち（配下が止まったまま進まない）なので、これだけを知らせる。
 * 対象は台帳の配下と指揮役（人が手で動かしているセッションは、cc-park など別の道具に任せる）。
 * 起動直後の 1 回目は遷移が分からないので知らせない（diffAgents が空を返す）。
 */
export interface ApprovalNotice {
  readonly sessionId: string;
  readonly title: string;
  readonly body: string;
}

export const approvalNotices = (
  previous: readonly Agent[] | null,
  current: readonly Agent[],
  watched: ReadonlySet<string>,
  at: number,
): ApprovalNotice[] =>
  diffAgents(previous, current, at)
    .filter((event) => event.to === 'blocked' && watched.has(event.sessionId))
    .map((event) => ({
      sessionId: event.sessionId,
      title: `${event.name} が承認待ちです`,
      body:
        event.reason === undefined
          ? 'cuse で「開いて承認する」を押して、承認してください。'
          : `${event.reason}\ncuse で「開いて承認する」を押して、承認してください。`,
    }));
