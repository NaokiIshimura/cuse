import { stopSession } from '../core/claudeBg.js';
import type { LedgerWorker } from '../core/ledger.js';
import { checkLeader } from '../core/leaderToken.js';
import { resolveWorker } from '../shared/resolveAgent.js';
import { listAgents, loadLedger, saveLedger, type OpsDeps } from './deps.js';
import { failure, success, type Outcome } from './outcome.js';

/**
 * `cuse kill <名前> --reason "<理由>"`。指揮役だけが使える。
 *
 * 台帳に載った配下だけを `claude stop` で止め、理由を台帳に残す。止めるだけで、会話・変更・
 * worktree は消さない（安全の約束 3・4）。人が手で動かしているセッションは指せない。
 */

export interface KillInput {
  readonly name: string;
  readonly reason: string;
  /**
   * 人が GUI から止めるとき true。指揮役のトークンを求めない
   * （人の操作は指揮役でなくても使える。ただし台帳の配下に限るのは同じ）。
   */
  readonly byHuman?: boolean;
  /**
   * 止める配下の sessionId（GUI から）。指定したときは名前で探さず、台帳の sessionId との完全一致だけで決める
   * （安全の約束 3。前方一致や部分一致で別の配下を止めないように）。
   */
  readonly sessionId?: string;
}

export interface KillResult {
  readonly name: string;
  readonly shortId: string;
  readonly reason: string;
  readonly endedAt: string;
}

export const runKill = async (input: KillInput, deps: OpsDeps): Promise<Outcome<KillResult>> => {
  if (input.reason.trim() === '') {
    return failure({ kind: 'usage', message: '理由を指定してください: cuse kill <名前> --reason "<理由>"' });
  }
  const loaded = await loadLedger(deps);
  if (!loaded.ok) {
    return loaded.outcome;
  }
  if (input.byHuman !== true) {
    const leader = checkLeader(deps.env, loaded.ledger);
    if (!leader.ok) {
      return failure({ kind: 'denied', message: leader.message });
    }
  }
  if (input.sessionId !== undefined) {
    const exact = loaded.ledger?.workers.find((w) => w.sessionId === input.sessionId);
    if (exact === undefined) {
      return failure({ kind: 'not-found', message: '台帳に載った配下ではないので止められません。' });
    }
    return stopWorker(exact, input.reason.trim(), deps);
  }
  const resolved = resolveWorker(loaded.ledger?.workers ?? [], input.name);
  if (!resolved.ok) {
    return failure(
      resolved.kind === 'ambiguous'
        ? { kind: 'ambiguous', message: resolved.message, candidates: resolved.candidates.map((w) => w.name) }
        : { kind: 'not-found', message: resolved.message },
    );
  }
  return stopWorker(resolved.item, input.reason.trim(), deps);
};

const stopWorker = async (worker: LedgerWorker, reason: string, deps: OpsDeps): Promise<Outcome<KillResult>> => {
  // 台帳に短縮 ID が無ければ、一覧から引く
  let shortId = worker.shortId;
  if (shortId === null) {
    const listed = await listAgents(deps);
    if (!listed.ok) {
      return listed.outcome;
    }
    shortId = listed.agents.find((agent) => agent.sessionId === worker.sessionId)?.id ?? null;
  }
  if (shortId === null) {
    return failure({ kind: 'not-found', message: `${worker.name} の短縮 ID が分からないため止められません。` });
  }

  const stopped = await stopSession(shortId, { runner: deps.runner });
  if (!stopped.ok) {
    return failure({ kind: 'launch', message: `${worker.name} を止められませんでした: ${stopped.message}` });
  }

  const endedAt = new Date(deps.now()).toISOString();
  const saved = await saveLedger(deps, (current) => ({
    ...current,
    workers: current.workers.map((w) =>
      w.sessionId === worker.sessionId ? { ...w, endedAt, endReason: reason } : w,
    ),
  }));
  if (!saved.ok) {
    return saved.outcome;
  }
  return success(
    { name: worker.name, shortId, reason, endedAt },
    `${worker.name}（${shortId}）を止めました。理由: ${reason}\n会話と変更は残っています。再開するには cuse prompt ${worker.name} "<指示>"。`,
  );
};
