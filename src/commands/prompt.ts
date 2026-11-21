import { MAX_PROMPTS_PER_WORKER } from '../config/defaults.js';
import { findByShortId, isAlive, launchBackground } from '../core/claudeBg.js';
import type { LedgerWorker } from '../core/ledger.js';
import { checkLeader, withoutLeaderToken } from '../core/leaderToken.js';
import { resolveWorker } from '../shared/resolveAgent.js';
import { listAgents, loadLedger, saveLedger, type OpsDeps } from './deps.js';
import { failure, success, type Outcome } from './outcome.js';
import { WORKER_PROMPT_FILE } from './spawn.js';

/**
 * `cuse prompt <名前> "<指示>"`。指揮役だけが使える。
 *
 * - 配下のプロセスが止まっていれば、`claude --resume <sessionId> --bg` で続きを頼む
 * - 動いていれば送らずに「SendMessage で送る」よう返す。動いている配下へ CLI から直接文を届ける
 *   公開の方法は無く、非公開のソケットには触らないため
 *
 * どちらでも回数に数える（上限は {@link MAX_PROMPTS_PER_WORKER}）。
 */

export interface PromptInput {
  readonly name: string;
  readonly message: string;
}

export type PromptResult =
  | {
      readonly delivered: false;
      /** 指揮役が使う経路 */
      readonly via: 'SendMessage';
      /** SendMessage の宛先 */
      readonly to: string;
      readonly name: string;
      readonly promptCount: number;
    }
  | {
      readonly delivered: true;
      readonly via: 'resume';
      readonly name: string;
      readonly shortId: string;
      readonly sessionId: string;
      /** 会話が写されて新しい ID で始まったか */
      readonly copied: boolean;
      readonly promptCount: number;
    };

export const runPrompt = async (input: PromptInput, deps: OpsDeps): Promise<Outcome<PromptResult>> => {
  if (input.message.trim() === '') {
    return failure({ kind: 'usage', message: '指示を指定してください: cuse prompt <名前> "<指示>"' });
  }
  const loaded = await loadLedger(deps);
  if (!loaded.ok) {
    return loaded.outcome;
  }
  const leader = checkLeader(deps.env, loaded.ledger);
  if (!leader.ok) {
    return failure({ kind: 'denied', message: leader.message });
  }
  const resolved = resolveWorker(loaded.ledger?.workers ?? [], input.name);
  if (!resolved.ok) {
    return failure(
      resolved.kind === 'ambiguous'
        ? { kind: 'ambiguous', message: resolved.message, candidates: resolved.candidates.map((w) => w.name) }
        : { kind: 'not-found', message: resolved.message },
    );
  }
  const worker = resolved.item;
  if (worker.promptCount >= MAX_PROMPTS_PER_WORKER) {
    return failure({
      kind: 'limit',
      message: `${worker.name} への指示は ${MAX_PROMPTS_PER_WORKER} 回までです。やり取りが長引いているので、人に相談してください。`,
    });
  }

  const listed = await listAgents(deps);
  if (!listed.ok) {
    return listed.outcome;
  }
  const agent = listed.agents.find((candidate) => candidate.sessionId === worker.sessionId);
  const promptCount = worker.promptCount + 1;

  if (agent !== undefined && isAlive(agent)) {
    const saved = await saveLedger(deps, (current) => ({
      ...current,
      workers: current.workers.map((w) =>
        w.sessionId === worker.sessionId ? { ...w, promptCount } : w,
      ),
    }));
    if (!saved.ok) {
      return saved.outcome;
    }
    return success(
      { delivered: false, via: 'SendMessage', to: agent.name, name: worker.name, promptCount },
      `${worker.name} は動いています。SendMessage で ${agent.name} に送ってください（cuse からは送っていません）。`,
    );
  }

  const workerPrompt = await deps.readBundled(WORKER_PROMPT_FILE);
  const launched = await launchBackground(
    {
      resume: worker.sessionId,
      prompt: input.message,
      permissionMode: loaded.ledger?.leader?.permissionMode ?? null,
      appendSystemPrompt: workerPrompt,
    },
    { runner: deps.runner, cwd: worker.cwd === '' ? deps.cwd : worker.cwd, env: withoutLeaderToken(deps.env) },
  );
  if (!launched.ok) {
    return failure({ kind: 'launch', message: launched.message });
  }
  const found = await findByShortId(
    async () => {
      const result = await listAgents(deps);
      return result.ok ? result.agents : null;
    },
    launched.shortId,
    { sleep: deps.sleep },
  );
  // 見つからなくても、同じ会話の続きとして記録する（短縮 ID だけ新しくする）
  const sessionId = found?.sessionId ?? worker.sessionId;
  const next: LedgerWorker = {
    ...worker,
    shortId: launched.shortId,
    sessionId,
    endedAt: null,
    endReason: null,
    promptCount,
  };
  const saved = await saveLedger(deps, (current) => ({
    ...current,
    workers: current.workers.map((w) => (w.sessionId === worker.sessionId ? next : w)),
  }));
  if (!saved.ok) {
    return saved.outcome;
  }
  const copied = sessionId !== worker.sessionId;
  return success(
    {
      delivered: true,
      via: 'resume',
      name: worker.name,
      shortId: launched.shortId,
      sessionId,
      copied,
      promptCount,
    },
    `${worker.name}（${launched.shortId}）に続きを頼みました（claude --resume）。${copied ? '会話は新しい ID に写して再開されました。' : ''}`,
  );
};
