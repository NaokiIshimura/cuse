import { DEFAULT_WAIT_TIMEOUT_SEC, WAIT_INTERVAL_MS } from '../config/defaults.js';
import { resolveAgent } from '../shared/resolveAgent.js';
import { formatPendingTool } from '../shared/statusDetail.js';
import { waitingForOf } from '../shared/waitingFor.js';
import type { Agent } from '../types/agent.js';
import { listAgents, type OpsDeps } from './deps.js';
import { failure, success, type Outcome } from './outcome.js';

/**
 * `cuse wait <名前…> [--until attention|idle|done] [--timeout <秒>]`。
 *
 * 条件が成り立つまで一覧を取り直して待ち、「誰が何のために止まったか」を返す。
 * 読み取りだけなので指揮役のトークンは要らない。
 *
 * - `attention`（既定）: 誰か 1 人でも手を止めたら返す。指揮役はすぐ次の手を打てる
 * - `idle`: 全員が手を止めたら返す
 * - `done`: 全員が終わったら返す（完了・停止・一覧から消えた）
 *
 * 時間切れは失敗ではなく `timedOut: true` で返す（指揮役はもう一度呼べばよい）。
 */

export type WaitUntil = 'attention' | 'idle' | 'done';

export const WAIT_UNTIL_VALUES: readonly WaitUntil[] = ['attention', 'idle', 'done'];

/** 1 人ぶんの「何をしているか」。 */
export type WaitStatus = 'working' | 'approval' | 'input' | 'done' | 'stopped' | 'unknown' | 'missing';

export interface WaitInput {
  readonly names: readonly string[];
  readonly until?: WaitUntil | undefined;
  readonly timeoutSec?: number | undefined;
}

export interface WaitSession {
  readonly name: string;
  readonly sessionId: string;
  readonly shortId: string | null;
  readonly status: WaitStatus;
  /** 承認待ちの対象（`Bash: npm test` など）。分からなければ null */
  readonly reason: string | null;
}

export interface WaitResult {
  readonly until: WaitUntil;
  /** 条件が成り立ったか */
  readonly met: boolean;
  readonly timedOut: boolean;
  readonly elapsedMs: number;
  readonly sessions: readonly WaitSession[];
}

export const statusOf = (agent: Agent | undefined): WaitStatus => {
  if (agent === undefined) {
    return 'missing';
  }
  const waitingFor = waitingForOf(agent.state, agent.waitingFor);
  if (waitingFor === 'approval') {
    return 'approval';
  }
  if (agent.state === 'working') {
    return 'working';
  }
  if (waitingFor === 'input') {
    return 'input';
  }
  if (agent.state === 'done') {
    return 'done';
  }
  if (agent.state === 'stopped') {
    return 'stopped';
  }
  return 'unknown';
};

const FINISHED: ReadonlySet<WaitStatus> = new Set(['done', 'stopped', 'missing']);

export const isMet = (until: WaitUntil, statuses: readonly WaitStatus[]): boolean => {
  if (until === 'attention') {
    return statuses.some((status) => status !== 'working');
  }
  if (until === 'idle') {
    return statuses.every((status) => status !== 'working');
  }
  return statuses.every((status) => FINISHED.has(status));
};

const STATUS_LABELS: Readonly<Record<WaitStatus, string>> = {
  working: '作業中',
  approval: '承認待ち（人に承認を頼んでください）',
  input: '入力待ち（cuse output で質問を読んでください）',
  done: '完了（cuse output で報告を読んでください）',
  stopped: '停止',
  unknown: '状態不明',
  missing: '一覧にありません（片付けられたか、止まっています）',
};

const formatText = (result: WaitResult): string => {
  const head = result.timedOut
    ? `時間切れです（${Math.round(result.elapsedMs / 1000)} 秒）。まだ条件（${result.until}）が成り立っていません。もう一度 cuse wait を呼んでください。`
    : `条件（${result.until}）が成り立ちました。`;
  const lines = result.sessions.map((session) => {
    const reason = session.reason === null ? '' : ` — ${session.reason}`;
    return `  ${session.name}: ${STATUS_LABELS[session.status]}${reason}`;
  });
  return [head, ...lines].join('\n');
};

export const runWait = async (input: WaitInput, deps: OpsDeps): Promise<Outcome<WaitResult>> => {
  const until = input.until ?? 'attention';
  const timeoutSec = input.timeoutSec ?? DEFAULT_WAIT_TIMEOUT_SEC;
  if (input.names.length === 0) {
    return failure({ kind: 'usage', message: '待つ配下の名前を指定してください: cuse wait <名前…>' });
  }
  if (!WAIT_UNTIL_VALUES.includes(until)) {
    return failure({ kind: 'usage', message: `--until は ${WAIT_UNTIL_VALUES.join(' / ')} のどれかです。` });
  }
  if (!Number.isFinite(timeoutSec) || timeoutSec < 0) {
    return failure({ kind: 'usage', message: '--timeout には 0 以上の秒数を指定してください。' });
  }

  const startedAt = deps.now();
  let listed = await listAgents(deps, true);
  if (!listed.ok) {
    return listed.outcome;
  }

  // 名前は最初に 1 回だけ解決し、以後は sessionId で追う（途中で名前が変わっても見失わない）
  const targets: Agent[] = [];
  for (const name of input.names) {
    const resolved = resolveAgent(listed.agents, name);
    if (!resolved.ok) {
      return failure(
        resolved.kind === 'ambiguous'
          ? { kind: 'ambiguous', message: resolved.message, candidates: resolved.candidates.map((a) => a.name) }
          : { kind: 'not-found', message: resolved.message },
      );
    }
    if (!targets.some((target) => target.sessionId === resolved.agent.sessionId)) {
      targets.push(resolved.agent);
    }
  }

  for (;;) {
    const agents = listed.agents;
    const sessions: WaitSession[] = targets.map((target) => {
      const agent = agents.find((candidate) => candidate.sessionId === target.sessionId);
      const status = statusOf(agent);
      const tool = status === 'approval' ? agent?.meta?.pendingTool : undefined;
      return {
        name: agent?.name ?? target.name,
        sessionId: target.sessionId,
        shortId: agent?.id ?? target.id ?? null,
        status,
        reason: tool === undefined ? null : formatPendingTool(tool),
      };
    });
    const elapsedMs = deps.now() - startedAt;
    const met = isMet(
      until,
      sessions.map((session) => session.status),
    );
    if (met || elapsedMs >= timeoutSec * 1000) {
      const result: WaitResult = { until, met, timedOut: !met, elapsedMs, sessions };
      return success(result, formatText(result));
    }
    await deps.sleep(WAIT_INTERVAL_MS);
    listed = await listAgents(deps, true);
    if (!listed.ok) {
      return listed.outcome;
    }
  }
};
