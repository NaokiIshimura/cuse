import { readGitStatus, readPullRequest, keepReason, type GitStatus, type PullRequestInfo } from '../core/gitStatus.js';
import type { LedgerWorker } from '../core/ledger.js';
import { findLastAssistantText, findLastCwd } from '../shared/parseTranscript.js';
import { resolveAgent, resolveWorker } from '../shared/resolveAgent.js';
import type { Agent } from '../types/agent.js';
import { listAgents, loadLedger, type OpsDeps } from './deps.js';
import { failure, success, type Outcome } from './outcome.js';

/**
 * `cuse review <名前>`。配下の仕事を回収する前に、何がどこにあるかをまとめる。読むだけ。
 *
 * - 作業した場所（worktree）とブランチ
 * - 取り込み先との差分（`git diff --stat`）
 * - commit していない変更・push していない commit
 * - PR（gh があれば）
 * - 最後の報告
 *
 * 指揮役は報告をそのまま人に伝えず、ここで差分を確かめてから伝える（心得）。
 */

export interface ReviewResult {
  readonly name: string;
  readonly sessionId: string;
  readonly shortId: string | null;
  readonly state: Agent['state'] | 'missing';
  /** 台帳に記録したタスク。台帳に無ければ null */
  readonly task: string | null;
  /** 作業した場所（transcript の最後の cwd。分からなければ起動した場所） */
  readonly workDir: string;
  readonly git: GitStatus;
  readonly pullRequest: PullRequestInfo | null;
  readonly lastReport: string | null;
  /** 片付けると作業を失うなら、その理由。失わなければ null */
  readonly keep: string | null;
}

/** 配下（または人のセッション）が作業した場所と最後の報告を、transcript から読む。 */
export const readWorkDir = async (
  sessionId: string,
  cwd: string,
  deps: Pick<OpsDeps, 'readTranscript'>,
): Promise<{
  readonly workDir: string;
  /** transcript から作業した場所を読めたか。読めなければ workDir は起動した場所で、worktree とは限らない */
  readonly workDirKnown: boolean;
  readonly lastReport: string | null;
}> => {
  const transcript = cwd === '' ? null : await deps.readTranscript(cwd, sessionId);
  const lastCwd = transcript === null ? undefined : findLastCwd(transcript);
  return {
    workDir: lastCwd ?? cwd,
    workDirKnown: lastCwd !== undefined,
    lastReport: transcript === null ? null : (findLastAssistantText(transcript) ?? null),
  };
};

const formatText = (result: ReviewResult): string => {
  const git = result.git;
  const lines = [`# ${result.name}（${result.state}）`];
  if (result.task !== null) {
    lines.push(`タスク: ${result.task}`);
  }
  lines.push(`作業した場所: ${result.workDir}`);
  if (!git.repository) {
    lines.push('git リポジトリではありません。');
  } else {
    lines.push(`ブランチ: ${git.branch ?? '?'}${git.upstream === null ? '（まだ push していません）' : `（${git.upstream}）`}`);
    lines.push(`差分（${git.base ?? '比べる相手なし'} と比べて）: ${git.diffStat ?? 'なし'}`);
    lines.push(
      `commit していない変更: ${git.uncommitted.length} 件 / push していない commit: ${git.unpushed === null ? '分かりません' : `${git.unpushed} 件`}`,
    );
  }
  lines.push(`PR: ${result.pullRequest === null ? 'なし（または gh で調べられません）' : `#${result.pullRequest.number} ${result.pullRequest.state} ${result.pullRequest.url}`}`);
  lines.push(result.keep === null ? '片付けても作業は失われません。' : `片付けると作業を失います: ${result.keep}`);
  lines.push('', '## 最後の報告', result.lastReport ?? '（読み取れませんでした）');
  return lines.join('\n');
};

export const runReview = async (input: { readonly name: string }, deps: OpsDeps): Promise<Outcome<ReviewResult>> => {
  if (input.name.trim() === '') {
    return failure({ kind: 'usage', message: '使い方: cuse review <名前>' });
  }
  const [loaded, listed] = await Promise.all([loadLedger(deps), listAgents(deps)]);
  if (!loaded.ok) {
    return loaded.outcome;
  }
  if (!listed.ok) {
    return listed.outcome;
  }

  // 台帳の配下を先に探す（一覧から消えた配下も見られるように）。無ければ一覧のセッションから探す
  let worker: LedgerWorker | undefined;
  let agent: Agent | undefined;
  const fromLedger = resolveWorker(loaded.ledger?.workers ?? [], input.name);
  if (fromLedger.ok) {
    worker = fromLedger.item;
    agent = listed.agents.find((candidate) => candidate.sessionId === worker?.sessionId);
  } else if (fromLedger.kind === 'ambiguous') {
    return failure({ kind: 'ambiguous', message: fromLedger.message, candidates: fromLedger.candidates.map((w) => w.name) });
  } else {
    const fromList = resolveAgent(listed.agents, input.name);
    if (!fromList.ok) {
      return failure(
        fromList.kind === 'ambiguous'
          ? { kind: 'ambiguous', message: fromList.message, candidates: fromList.candidates.map((a) => a.name) }
          : { kind: 'not-found', message: fromList.message },
      );
    }
    agent = fromList.agent;
  }

  const sessionId = worker?.sessionId ?? agent?.sessionId ?? '';
  const cwd = agent?.cwd ?? worker?.cwd ?? '';
  const { workDir, lastReport } = await readWorkDir(sessionId, cwd, deps);
  const [git, pullRequest] = await Promise.all([
    readGitStatus(workDir, { runner: deps.runner }),
    readPullRequest(workDir, { runner: deps.runner }),
  ]);

  const result: ReviewResult = {
    name: agent?.name ?? worker?.name ?? input.name,
    sessionId,
    shortId: agent?.id ?? worker?.shortId ?? null,
    state: agent?.state ?? 'missing',
    task: worker?.task ?? null,
    workDir,
    git,
    pullRequest,
    lastReport,
    keep: keepReason(git),
  };
  return success(result, formatText(result));
};
