import type { ClaudeVersionCheck } from '../core/claudeVersion.js';
import type { FetchAgentsOptions, FetchAgentsResult } from '../core/fetchAgents.js';
import type { Ledger, ReadLedgerResult } from '../core/ledger.js';
import type { CommandRunner } from '../core/runCommand.js';
import type { Agent } from '../types/agent.js';
import type { SkillFileSystem } from './installSkill.js';
import { failure, type Outcome } from './outcome.js';

/**
 * 操作系コマンドが外の世界に触れる口。テストではすべて偽物に差し替え、本物の `claude` を呼ばない。
 */
export interface OpsDeps {
  /** 呼び出し元の環境変数（指揮役のトークンを確かめる） */
  readonly env: NodeJS.ProcessEnv;
  /** 呼び出し元の作業ディレクトリ */
  readonly cwd: string;
  readonly home: string;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** `claude` / `git` の実行 */
  readonly runner: CommandRunner;
  readonly fetchAgents: (options: FetchAgentsOptions) => Promise<FetchAgentsResult>;
  readonly readLedger: () => Promise<ReadLedgerResult>;
  readonly updateLedger: (update: (ledger: Ledger) => Ledger) => Promise<Ledger>;
  readonly checkVersion: (minimum?: string) => Promise<ClaudeVersionCheck>;
  /** 同梱のファイル（心得・スキル）を読む */
  readonly readBundled: (relativePath: string) => Promise<string>;
  /** cuse スキルを置く場所の読み書き */
  readonly skillFs: SkillFileSystem;
  /** ディレクトリを作る（無ければ。指揮役の居場所 `~/.cuse/leader` に使う） */
  readonly makeDirectory: (path: string) => Promise<void>;
  /** セッションの transcript の末尾を読む（作業ディレクトリと最後の報告を知るため）。読めなければ null */
  readonly readTranscript: (cwd: string, sessionId: string) => Promise<string | null>;
}

/** 途中の段階の結果。失敗ならそのまま返せる Outcome を持つ。 */
export type Step<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly outcome: Outcome<never> };

/** 全セッションを取る。失敗は Outcome の失敗にして返す。 */
export const listAgents = async (
  deps: OpsDeps,
  meta = false,
): Promise<Step<{ readonly agents: readonly Agent[] }>> => {
  const result = await deps.fetchAgents({ all: true, meta, runner: deps.runner, home: deps.home });
  if (!result.ok) {
    return { ok: false, outcome: failure(result.error) };
  }
  return { ok: true, agents: result.agents };
};

/** 台帳を読む。壊れていれば Outcome の失敗にして返す（壊れた台帳で配下を取り違えないため）。 */
export const loadLedger = async (
  deps: OpsDeps,
): Promise<Step<{ readonly ledger: Ledger | null }>> => {
  const result = await deps.readLedger();
  if (result.kind === 'invalid') {
    return {
      ok: false,
      outcome: failure({ kind: 'ledger', message: `台帳を読めませんでした: ${result.message}` }),
    };
  }
  return { ok: true, ledger: result.kind === 'ok' ? result.ledger : null };
};

/** 台帳を書き換える。失敗は Outcome の失敗にして返す。 */
export const saveLedger = async (
  deps: OpsDeps,
  update: (ledger: Ledger) => Ledger,
): Promise<Step<{ readonly ledger: Ledger }>> => {
  try {
    return { ok: true, ledger: await deps.updateLedger(update) };
  } catch (error) {
    return { ok: false, outcome: failure({ kind: 'ledger', message: (error as Error).message }) };
  }
};
