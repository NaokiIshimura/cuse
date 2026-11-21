import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OUTPUT_LINES } from './config/defaults.js';
import { buildAgentsOutput, formatAgentsText } from './commands/agents.js';
import type { OpsDeps } from './commands/deps.js';
import {
  describeInstallSkill,
  fsSkillFileSystem,
  installSkill,
  SKILL_SOURCE,
} from './commands/installSkill.js';
import { runKill } from './commands/kill.js';
import type { CommandErrorKind, Outcome } from './commands/outcome.js';
import { buildOutputResult, formatOutputText } from './commands/output.js';
import { runPrompt } from './commands/prompt.js';
import { runSpawn } from './commands/spawn.js';
import { runStart } from './commands/start.js';
import { buildStatusOutput, formatStatusText } from './commands/status.js';
import { runWait, WAIT_UNTIL_VALUES, type WaitUntil } from './commands/wait.js';
import { buildDebugPath, createAgentsObserver } from './core/agentsDebug.js';
import { checkClaudeVersion } from './core/claudeVersion.js';
import { fetchAgents, type FetchAgentsOptions } from './core/fetchAgents.js';
import { readLedger, updateLedger } from './core/ledger.js';
import { readLastReport, readLogs, type ReadLogsResult } from './core/readOutput.js';
import { execFileRunner } from './core/runCommand.js';
import { resolveAgent } from './shared/resolveAgent.js';
import type { Agent } from './types/agent.js';

/**
 * CLI の本体。`src/cli.ts` は引数の解釈とプロセスの出入りだけを持ち、判断はここで行う。
 *
 * 外部（`claude` コマンド・台帳・transcript）への読み取りはすべて `deps` から受け取るので、
 * テストでは偽物を渡して本物の `claude` を呼ばずに確かめられる。
 *
 * 操作系（start / spawn / prompt / wait / kill / install-skill）は `src/commands/` の run* に任せ、
 * ここでは引数の確かめと出力の整形だけを行う。
 */

export type CommandName =
  | 'status'
  | 'agents'
  | 'output'
  | 'start'
  | 'spawn'
  | 'prompt'
  | 'wait'
  | 'kill'
  | 'install-skill';

export const COMMANDS: readonly CommandName[] = [
  'status',
  'agents',
  'output',
  'start',
  'spawn',
  'prompt',
  'wait',
  'kill',
  'install-skill',
];

export interface CliFlags {
  readonly all: boolean;
  readonly json: boolean;
  readonly lines: number | undefined;
  readonly debug: boolean;
  readonly cwd?: string | undefined;
  readonly agent?: string | undefined;
  readonly model?: string | undefined;
  readonly reason?: string | undefined;
  readonly until?: string | undefined;
  readonly timeout?: number | undefined;
  readonly new?: boolean;
  readonly permissionMode?: string | undefined;
  readonly force?: boolean;
}

export interface CliDeps extends OpsDeps {
  readonly readLastReport: (agent: Agent) => Promise<string | null>;
  readonly readLogs: (agent: Agent, lines: number) => Promise<ReadLogsResult>;
}

/** 同梱のファイル（`prompts/` / `skill/`）の置き場所。dist/ からも src/ からも 1 つ上がパッケージの根。 */
const PACKAGE_ROOT = fileURLToPath(new URL('../', import.meta.url));

export const defaultDeps = (): CliDeps => {
  const home = homedir();
  return {
    env: process.env,
    cwd: process.cwd(),
    home,
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    runner: execFileRunner,
    fetchAgents,
    readLedger: () => readLedger({ home }),
    updateLedger: (update) => updateLedger(update, { home }),
    checkVersion: (minimum) => checkClaudeVersion(minimum === undefined ? {} : { minimum }),
    readBundled: (relativePath) => readFile(`${PACKAGE_ROOT}${relativePath}`, 'utf8'),
    skillFs: fsSkillFileSystem,
    readLastReport: (agent) => readLastReport(agent, { home }),
    readLogs: (agent, lines) => readLogs(agent, { lines }),
  };
};

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** `cuse start` の後にウィンドウを開くか */
  readonly openApp?: boolean;
}

/** 失敗の種別。`--json` のときは `{"error":{"kind","message"}}` で返す。 */
export type CliErrorKind = CommandErrorKind;

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
const fetchOptions = (
  flags: CliFlags,
  deps: CliDeps,
  warnings: string[],
): FetchAgentsOptions => ({
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
            ? 'コマンドを指定してください。cuse --help で使い方を見られます。'
            : `知らないコマンドです: ${command}。cuse --help で使い方を見られます。`,
      },
      flags.json,
      warnings,
    );
  }

  const operation = await runOperation(command as CommandName, args, flags, deps);
  if (operation !== null) {
    return operation;
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

/** Outcome を出力に整える。 */
const fromOutcome = <T>(outcome: Outcome<T>, json: boolean): CliResult => {
  if (!outcome.ok) {
    return fail(outcome.error, json, outcome.warnings);
  }
  return succeed(json ? JSON.stringify(outcome.value, null, 2) : outcome.text, outcome.warnings);
};

const usage = (message: string, json: boolean): CliResult => fail({ kind: 'usage', message }, json, []);

/**
 * 操作系のコマンド。読み取り系（status / agents / output）なら null を返す。
 */
const runOperation = async (
  command: CommandName,
  args: readonly string[],
  flags: CliFlags,
  deps: CliDeps,
): Promise<CliResult | null> => {
  switch (command) {
    case 'start': {
      const outcome = await runStart(
        { cwd: flags.cwd, new: flags.new === true, permissionMode: flags.permissionMode },
        deps,
      );
      return { ...fromOutcome(outcome, flags.json), openApp: outcome.ok };
    }
    case 'spawn': {
      const [task, name] = args;
      if (task === undefined || name === undefined || args.length > 2) {
        return usage('使い方: cuse spawn "<タスク>" <名前>（タスクは引用符で 1 つにまとめてください）', flags.json);
      }
      return fromOutcome(
        await runSpawn({ task, name, cwd: flags.cwd, agent: flags.agent, model: flags.model }, deps),
        flags.json,
      );
    }
    case 'prompt': {
      const [name, message] = args;
      if (name === undefined || message === undefined || args.length > 2) {
        return usage('使い方: cuse prompt <名前> "<指示>"（指示は引用符で 1 つにまとめてください）', flags.json);
      }
      return fromOutcome(await runPrompt({ name, message }, deps), flags.json);
    }
    case 'wait': {
      if (flags.until !== undefined && !WAIT_UNTIL_VALUES.includes(flags.until as WaitUntil)) {
        return usage(`--until は ${WAIT_UNTIL_VALUES.join(' / ')} のどれかです。`, flags.json);
      }
      return fromOutcome(
        await runWait(
          { names: args, until: flags.until as WaitUntil | undefined, timeoutSec: flags.timeout },
          deps,
        ),
        flags.json,
      );
    }
    case 'kill': {
      const [name] = args;
      if (name === undefined || args.length > 1) {
        return usage('使い方: cuse kill <名前> --reason "<理由>"', flags.json);
      }
      return fromOutcome(await runKill({ name, reason: flags.reason ?? '' }, deps), flags.json);
    }
    case 'install-skill': {
      const result = await installSkill(await deps.readBundled(SKILL_SOURCE), {
        home: deps.home,
        force: flags.force === true,
        fs: deps.skillFs,
      });
      if (result.status === 'differs') {
        return fail({ kind: 'conflict', message: describeInstallSkill(result) }, flags.json, []);
      }
      return succeed(flags.json ? JSON.stringify(result, null, 2) : describeInstallSkill(result), []);
    }
    default:
      return null;
  }
};
