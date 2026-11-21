import { homedir } from 'node:os';
import { DEFAULT_OUTPUT_LINES } from './config/defaults.js';
import { buildAgentsOutput, formatAgentsText } from './commands/agents.js';
import { buildOutputResult, formatOutputText } from './commands/output.js';
import { buildStatusOutput, formatStatusText } from './commands/status.js';
import { buildDebugPath, createAgentsObserver } from './core/agentsDebug.js';
import { checkClaudeVersion, type ClaudeVersionCheck } from './core/claudeVersion.js';
import {
  fetchAgents,
  type FetchAgentsOptions,
  type FetchAgentsResult,
} from './core/fetchAgents.js';
import { readLedger, type ReadLedgerResult } from './core/ledger.js';
import { readLastReport, readLogs, type ReadLogsResult } from './core/readOutput.js';
import { resolveAgent } from './shared/resolveAgent.js';
import type { Agent } from './types/agent.js';

/**
 * CLI の本体。`src/cli.ts` は引数の解釈とプロセスの出入りだけを持ち、判断はここで行う。
 *
 * 外部（`claude` コマンド・台帳・transcript）への読み取りはすべて `deps` から受け取るので、
 * テストでは偽物を渡して本物の `claude` を呼ばずに確かめられる。
 *
 * 第 1 段階は読み取りだけ。セッションを起動・停止・書き換えるコマンドはここに足さない。
 */

export type CommandName = 'status' | 'agents' | 'output';

export const COMMANDS: readonly CommandName[] = ['status', 'agents', 'output'];

export interface CliFlags {
  readonly all: boolean;
  readonly json: boolean;
  readonly lines: number | undefined;
  readonly debug: boolean;
}

export interface CliDeps {
  readonly fetchAgents: (options: FetchAgentsOptions) => Promise<FetchAgentsResult>;
  readonly readLedger: () => Promise<ReadLedgerResult>;
  readonly checkVersion: () => Promise<ClaudeVersionCheck>;
  readonly readLastReport: (agent: Agent) => Promise<string | null>;
  readonly readLogs: (agent: Agent, lines: number) => Promise<ReadLogsResult>;
  readonly now: () => number;
  readonly home: string;
}

export const defaultDeps = (): CliDeps => {
  const home = homedir();
  return {
    fetchAgents,
    readLedger: () => readLedger({ home }),
    checkVersion: () => checkClaudeVersion(),
    readLastReport: (agent) => readLastReport(agent, { home }),
    readLogs: (agent, lines) => readLogs(agent, { lines }),
    now: Date.now,
    home,
  };
};

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** 失敗の種別。`--json` のときは `{"error":{"kind","message"}}` で返す。 */
export type CliErrorKind =
  | 'usage'
  | 'not-found'
  | 'ambiguous'
  | 'timeout'
  | 'exit'
  | 'aborted'
  | 'parse';

interface CliError {
  readonly kind: CliErrorKind;
  readonly message: string;
  readonly candidates?: readonly string[];
}

const fail = (error: CliError, json: boolean, stderr: readonly string[]): CliResult => ({
  code: 1,
  stdout: json ? `${JSON.stringify({ error: error })}\n` : '',
  stderr: [...stderr, ...(json ? [] : [`cuse: ${error.message}`])].map((l) => `${l}\n`).join(''),
});

const succeed = (stdout: string, stderr: readonly string[]): CliResult => ({
  code: 0,
  stdout: stdout.endsWith('\n') ? stdout : `${stdout}\n`,
  stderr: stderr.map((line) => `${line}\n`).join(''),
});

/** `claude agents --json` に渡す共通の指定。完了した配下も DONE に出すため、常に `--all` で取る。 */
const fetchOptions = (flags: CliFlags, deps: CliDeps, warnings: string[]): FetchAgentsOptions => ({
  all: true,
  meta: true,
  home: deps.home,
  observe: createAgentsObserver({
    // 標準出力は JSON を返す場所なので、警告は標準エラーへ出す
    warn: (message) => {
      warnings.push(message);
    },
    debugDirectory: flags.debug ? buildDebugPath(deps.home) : undefined,
  }),
});

export const runCli = async (
  command: string | undefined,
  args: readonly string[],
  flags: CliFlags,
  deps: CliDeps,
): Promise<CliResult> => {
  const warnings: string[] = [];

  if (command === undefined || !COMMANDS.includes(command as CommandName)) {
    return fail(
      {
        kind: 'usage',
        message:
          command === undefined
            ? 'コマンドを指定してください（status / agents / output / app）。cuse --help で使い方を見られます。'
            : `知らないコマンドです: ${command}。cuse --help で使い方を見られます。`,
      },
      flags.json,
      warnings,
    );
  }

  if (command === 'output' && (args[0] === undefined || args[0] === '')) {
    return fail(
      { kind: 'usage', message: '名前を指定してください: cuse output <名前>' },
      flags.json,
      warnings,
    );
  }
  if (flags.lines !== undefined && (!Number.isInteger(flags.lines) || flags.lines < 0)) {
    return fail(
      { kind: 'usage', message: '--lines には 0 以上の整数を指定してください。' },
      flags.json,
      warnings,
    );
  }

  // バージョン確認は一覧の取得と並べて走らせ、待ち時間を増やさない
  const [fetched, version, ledger] = await Promise.all([
    deps.fetchAgents(fetchOptions(flags, deps, warnings)),
    deps.checkVersion(),
    deps.readLedger(),
  ]);

  // claude が無いときは取得の失敗として伝わるので、バージョンの警告は重ねない
  if (!version.ok && version.kind !== 'not-found') {
    warnings.unshift(version.message);
  }
  if (ledger.kind === 'invalid') {
    warnings.push(`台帳を使わずに続けます: ${ledger.message}`);
  }

  if (!fetched.ok) {
    return fail(fetched.error, flags.json, warnings);
  }

  const now = deps.now();

  if (command === 'agents') {
    const output = buildAgentsOutput(fetched.agents, ledger, { all: flags.all, now });
    return succeed(
      flags.json ? JSON.stringify(output, null, 2) : formatAgentsText(output),
      warnings,
    );
  }

  if (command === 'status') {
    const output = buildStatusOutput(fetched.agents, ledger, { all: flags.all, now });
    return succeed(
      flags.json ? JSON.stringify(output, null, 2) : formatStatusText(output),
      warnings,
    );
  }

  // output: 名前は全セッションから探す（第 1 段階は台帳が無く、手で動かすセッションを読むため）
  const resolved = resolveAgent(fetched.agents, args[0] ?? '');
  if (!resolved.ok) {
    return fail(
      resolved.kind === 'ambiguous'
        ? {
            kind: 'ambiguous',
            message: resolved.message,
            candidates: resolved.candidates.map((agent) => agent.name),
          }
        : { kind: 'not-found', message: resolved.message },
      flags.json,
      warnings,
    );
  }
  const lines = flags.lines ?? DEFAULT_OUTPUT_LINES;
  const [lastReport, logs] = await Promise.all([
    deps.readLastReport(resolved.agent),
    deps.readLogs(resolved.agent, lines),
  ]);
  const result = buildOutputResult(resolved.agent, lastReport, logs);
  return succeed(flags.json ? JSON.stringify(result, null, 2) : formatOutputText(result), warnings);
};
