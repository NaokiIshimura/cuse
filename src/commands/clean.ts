import { isAlive, removeSession } from '../core/claudeBg.js';
import { keepReason, readGitStatus } from '../core/gitStatus.js';
import { checkLeader } from '../core/leaderToken.js';
import { listAgents, loadLedger, saveLedger, type OpsDeps } from './deps.js';
import { failure, success, type Outcome } from './outcome.js';
import { readWorkDir } from './review.js';

/**
 * `cuse clean`。終わった配下を `claude rm` で片付ける。
 *
 * - 触れるのは台帳に載った配下だけ（安全の約束 3）
 * - 動いている配下は触らない
 * - commit していない変更・push していない commit がある worktree は残す（安全の約束 4）。
 *   確かめられないときも残す
 * - 片付けた配下は台帳に `cleanedAt` を残す（記録は消さない）
 *
 * 指揮役か、人がウィンドウから使う（人の操作はトークンなしで使える）。
 */

export interface CleanResult {
  readonly cleaned: readonly { readonly name: string; readonly shortId: string | null }[];
  readonly kept: readonly { readonly name: string; readonly reason: string }[];
  /** まだ動いているので触らなかった配下 */
  readonly running: readonly string[];
}

const formatText = (result: CleanResult): string => {
  const lines: string[] = [];
  lines.push(
    result.cleaned.length === 0
      ? '片付けた配下はありません。'
      : `片付けました: ${result.cleaned.map((w) => w.name).join(', ')}`,
  );
  for (const kept of result.kept) {
    lines.push(`残しました: ${kept.name}（${kept.reason}）`);
  }
  if (result.running.length > 0) {
    lines.push(`まだ動いているので触っていません: ${result.running.join(', ')}`);
  }
  return lines.join('\n');
};

export const runClean = async (
  input: { readonly byHuman?: boolean },
  deps: OpsDeps,
): Promise<Outcome<CleanResult>> => {
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
  const listed = await listAgents(deps);
  if (!listed.ok) {
    return listed.outcome;
  }

  const cleaned: { name: string; shortId: string | null; sessionId: string }[] = [];
  const kept: { name: string; reason: string }[] = [];
  const running: string[] = [];

  for (const worker of loaded.ledger?.workers ?? []) {
    if (worker.cleanedAt !== null) {
      continue;
    }
    const agent = listed.agents.find((candidate) => candidate.sessionId === worker.sessionId);
    const finished =
      agent === undefined || (!isAlive(agent) && (agent.state === 'done' || agent.state === 'stopped'));
    if (!finished) {
      running.push(worker.name);
      continue;
    }

    const { workDir } = await readWorkDir(worker.sessionId, agent?.cwd ?? worker.cwd, deps);
    const reason = keepReason(await readGitStatus(workDir, { runner: deps.runner }));
    if (reason !== null) {
      kept.push({ name: worker.name, reason });
      continue;
    }

    const shortId = agent?.id ?? worker.shortId;
    // 一覧から消えているセッションは、claude rm するものが無い。台帳に片付けた印だけ付ける
    if (agent !== undefined && shortId !== null) {
      const removed = await removeSession(shortId, { runner: deps.runner });
      if (!removed.ok) {
        kept.push({ name: worker.name, reason: `claude rm に失敗しました: ${removed.message}` });
        continue;
      }
    }
    cleaned.push({ name: worker.name, shortId, sessionId: worker.sessionId });
  }

  if (cleaned.length > 0) {
    const at = new Date(deps.now()).toISOString();
    const ids = new Set(cleaned.map((w) => w.sessionId));
    const saved = await saveLedger(deps, (ledger) => ({
      ...ledger,
      workers: ledger.workers.map((w) =>
        ids.has(w.sessionId)
          ? { ...w, cleanedAt: at, endedAt: w.endedAt ?? at, endReason: w.endReason ?? '片付けた（cuse clean）' }
          : w,
      ),
    }));
    if (!saved.ok) {
      return saved.outcome;
    }
  }

  const result: CleanResult = {
    cleaned: cleaned.map(({ name, shortId }) => ({ name, shortId })),
    kept,
    running,
  };
  return success(result, formatText(result));
};
