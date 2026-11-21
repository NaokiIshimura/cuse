import { isAbsolute, resolve } from 'node:path';
import { MAX_WORKERS } from '../config/defaults.js';
import { findByShortId, isAlive, launchBackground } from '../core/claudeBg.js';
import { activeLedgerWorkers, type Ledger, type LedgerWorker } from '../core/ledger.js';
import { checkLeader, withoutLeaderToken } from '../core/leaderToken.js';
import { isInsideStore } from '../core/paths.js';
import type { Agent } from '../types/agent.js';
import { listAgents, loadLedger, saveLedger, type OpsDeps } from './deps.js';
import { failure, success, withWarnings, type Outcome } from './outcome.js';

/**
 * `cuse spawn "<タスク>" <名前> [--cwd --agent --model]`。
 *
 * 配下を `claude --bg --name` で起動し、台帳に記録する。指揮役だけが使える。
 * 配下は指揮役と同じ権限モードで起動する（違うと SendMessage が保留されるため。
 * 指揮役より広い権限にはならない）。
 */

export interface SpawnInput {
  readonly task: string;
  readonly name: string;
  readonly cwd?: string | undefined;
  readonly agent?: string | undefined;
  readonly model?: string | undefined;
}

export interface SpawnResult {
  /** 起動後の本当の名前（同名の生きたセッションがあると変えられる） */
  readonly name: string;
  /** 指定した名前と違う名前になったか */
  readonly renamed: boolean;
  readonly shortId: string;
  readonly sessionId: string;
  readonly cwd: string;
  /** git リポジトリの中か。外だと worktree が作られず、配下同士が同じファイルを書き合う */
  readonly gitRepository: boolean;
}

/** 名前は SendMessage の宛先にもなるので、空白や記号の無い短いものに限る。 */
export const WORKER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/;

/** 配下の心得のファイル（同梱）。 */
export const WORKER_PROMPT_FILE = 'prompts/worker.md';

/** 止まっていない（数に入る）配下か。台帳で終わっておらず、一覧で完了・停止になっていないもの。 */
export const countsTowardLimit = (worker: LedgerWorker, agents: readonly Agent[]): boolean => {
  const agent = agents.find((candidate) => candidate.sessionId === worker.sessionId);
  if (agent === undefined) {
    return false;
  }
  return isAlive(agent) || (agent.state !== 'done' && agent.state !== 'stopped');
};

const isGitRepository = async (cwd: string, deps: OpsDeps): Promise<boolean> => {
  try {
    const stdout = await deps.runner('git', ['-C', cwd, 'rev-parse', '--is-inside-work-tree'], {
      timeoutMs: 5000,
      signal: undefined,
    });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
};

const formatText = (result: SpawnResult, requested: string): string => {
  const lines = [`配下 ${result.name}（${result.shortId}）を起動しました。`];
  if (result.renamed) {
    lines.push(`同じ名前のセッションがあったため、名前が ${requested} から ${result.name} に変わりました。以後は ${result.name} で指してください。`);
  }
  lines.push(`作業ディレクトリ: ${result.cwd}`);
  return lines.join('\n');
};

export const runSpawn = async (input: SpawnInput, deps: OpsDeps): Promise<Outcome<SpawnResult>> => {
  if (input.task.trim() === '') {
    return failure({ kind: 'usage', message: 'タスクを指定してください: cuse spawn "<タスク>" <名前>' });
  }
  if (!WORKER_NAME_PATTERN.test(input.name)) {
    return failure({
      kind: 'usage',
      message: `名前 ${JSON.stringify(input.name)} は使えません。英数字で始まる 48 文字以内の英数字・「.」「_」「-」にしてください（SendMessage の宛先になるため）。`,
    });
  }

  const loaded = await loadLedger(deps);
  if (!loaded.ok) {
    return loaded.outcome;
  }
  const ledger: Ledger | null = loaded.ledger;
  const leader = checkLeader(deps.env, ledger);
  if (!leader.ok) {
    return failure({ kind: 'denied', message: leader.message });
  }

  const listed = await listAgents(deps);
  if (!listed.ok) {
    return listed.outcome;
  }

  const active = activeLedgerWorkers(ledger ?? { version: 1, leader: null, workers: [] }).filter(
    (worker) => countsTowardLimit(worker, listed.agents),
  );
  if (active.some((worker) => worker.name === input.name)) {
    return failure({
      kind: 'conflict',
      message: `${input.name} という配下はもう動いています。別の名前にするか、cuse prompt / SendMessage で指示してください。`,
    });
  }
  if (active.length >= MAX_WORKERS) {
    return failure({
      kind: 'limit',
      message: `同時に動かせる配下は ${MAX_WORKERS} つまでです（動いている配下: ${active.map((w) => w.name).join(', ')}）。終わるのを待つか、要らない配下を cuse kill で止めてください。`,
    });
  }

  const cwd =
    input.cwd === undefined ? deps.cwd : isAbsolute(input.cwd) ? input.cwd : resolve(deps.cwd, input.cwd);
  // 指揮役の居場所（~/.cuse/leader）はリポジトリではない。そこで配下を起こすと作業が台無しになる
  if (isInsideStore(cwd, deps.home)) {
    return failure({
      kind: 'usage',
      message: `${cwd} は cuse の置き場所なので、ここでは配下を起こせません。--cwd で作業するリポジトリを指定してください（例: cuse spawn "<タスク>" <名前> --cwd ~/work/app）。`,
    });
  }
  const warnings: string[] = [];
  const gitRepository = await isGitRepository(cwd, deps);
  if (!gitRepository) {
    warnings.push(
      `${cwd} は git リポジトリではありません。worktree が作られないので、ほかの配下と同じファイルを書き合うおそれがあります。`,
    );
  }

  const workerPrompt = await deps.readBundled(WORKER_PROMPT_FILE);
  const launched = await launchBackground(
    {
      name: input.name,
      prompt: input.task,
      permissionMode: ledger?.leader?.permissionMode ?? null,
      agent: input.agent,
      model: input.model,
      appendSystemPrompt: workerPrompt,
    },
    // 指揮役のトークンは配下に渡さない（配下が孫を作れないように）
    { runner: deps.runner, cwd, env: withoutLeaderToken(deps.env) },
  );
  if (!launched.ok) {
    return failure({ kind: 'launch', message: launched.message }, warnings);
  }

  const found = await findByShortId(
    async () => {
      const result = await listAgents(deps);
      return result.ok ? result.agents : null;
    },
    launched.shortId,
    { sleep: deps.sleep },
  );
  if (found === null) {
    return failure(
      {
        kind: 'launch',
        message: `配下 ${launched.name}（${launched.shortId}）は起動しましたが、一覧に現れないため台帳に記録できませんでした。cuse agents --all で確かめ、要らなければ claude stop ${launched.shortId} で止めてください。`,
      },
      warnings,
    );
  }

  const worker: LedgerWorker = {
    name: found.name,
    shortId: launched.shortId,
    sessionId: found.sessionId,
    task: input.task,
    cwd,
    worktree: null,
    startedAt: new Date(deps.now()).toISOString(),
    endedAt: null,
    endReason: null,
    promptCount: 0,
    cleanedAt: null,
  };
  const saved = await saveLedger(deps, (current) => ({
    ...current,
    workers: [...current.workers, worker],
  }));
  if (!saved.ok) {
    return withWarnings(saved.outcome, warnings);
  }

  const result: SpawnResult = {
    name: found.name,
    renamed: found.name !== input.name,
    shortId: launched.shortId,
    sessionId: found.sessionId,
    cwd,
    gitRepository,
  };
  return success(result, formatText(result, input.name), warnings);
};
