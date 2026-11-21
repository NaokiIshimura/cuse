import type { Agent } from '../types/agent.js';
import { execFileRunner, toCommandError, type CommandRunner } from './runCommand.js';

/**
 * `claude --bg` まわりのコマンドの組み立てと実行。
 *
 * 起動・再開・停止は影響が大きいので、引数はすべてここで組み立て、テストで固定する。
 * 安全の約束により、`--dangerously-skip-permissions` などの権限を広げる引数はここで組み立てない
 * （渡された権限モードも {@link ALLOWED_PERMISSION_MODES} に限る）。
 */

/**
 * 指揮役と配下に使ってよい権限モード。
 * 権限確認を飛ばすモード（`bypassPermissions` など）は、人に承認を回す前提が崩れるので受け付けない。
 */
export const ALLOWED_PERMISSION_MODES: readonly string[] = ['default', 'acceptEdits', 'plan', 'auto'];

export const isAllowedPermissionMode = (mode: string): boolean =>
  ALLOWED_PERMISSION_MODES.includes(mode);

export interface BackgroundLaunch {
  /** 送る最初の指示 */
  readonly prompt: string;
  /** 新しく起こすときの名前。再開のときは省く（元の名前が残る） */
  readonly name?: string | undefined;
  /** 再開する会話の sessionId */
  readonly resume?: string | undefined;
  readonly permissionMode?: string | null | undefined;
  readonly agent?: string | undefined;
  readonly model?: string | undefined;
  /** 外すツール（指揮役の Edit / Write / NotebookEdit） */
  readonly disallowedTools?: readonly string[] | undefined;
  /** 追加のシステムプロンプト（指揮役の心得） */
  readonly appendSystemPrompt?: string | undefined;
  /** `--settings` に渡す JSON（指揮役のトークンを環境変数として渡すのに使う） */
  readonly settings?: Readonly<Record<string, unknown>> | undefined;
}

/**
 * `claude --bg` の引数を組み立てる。
 *
 * `--disallowedTools` は値を複数取るので、後ろに続く値が指示（位置引数）と取り違えられないよう、
 * 必ず値を 1 つだけ取るオプション（`--append-system-prompt`）の前に置く。
 */
export const buildBackgroundArgs = (launch: BackgroundLaunch): string[] => {
  if (
    launch.permissionMode !== undefined &&
    launch.permissionMode !== null &&
    !isAllowedPermissionMode(launch.permissionMode)
  ) {
    throw new Error(
      `権限モード ${launch.permissionMode} は使えません（${ALLOWED_PERMISSION_MODES.join(' / ')} のどれか）。`,
    );
  }
  const args: string[] = [];
  if (launch.resume !== undefined) {
    args.push('--resume', launch.resume);
  }
  args.push('--bg');
  if (launch.name !== undefined) {
    args.push('--name', launch.name);
  }
  if (launch.permissionMode !== undefined && launch.permissionMode !== null) {
    args.push('--permission-mode', launch.permissionMode);
  }
  if (launch.agent !== undefined) {
    args.push('--agent', launch.agent);
  }
  if (launch.model !== undefined) {
    args.push('--model', launch.model);
  }
  if (launch.settings !== undefined) {
    args.push('--settings', JSON.stringify(launch.settings));
  }
  const tools = launch.disallowedTools ?? [];
  if (tools.length > 0) {
    if (launch.appendSystemPrompt === undefined) {
      // 値を 1 つ取るオプションで区切れないので、カンマ区切りの 1 つの値にする
      args.push('--disallowedTools', tools.join(','));
    } else {
      args.push('--disallowedTools', ...tools);
    }
  }
  if (launch.appendSystemPrompt !== undefined) {
    args.push('--append-system-prompt', launch.appendSystemPrompt);
  }
  args.push(asPositional(launch.prompt));
  return args;
};

/**
 * 指示を位置引数として渡せる形にする。
 *
 * `-` で始まる指示（`--dangerously-skip-permissions` など）は、claude にオプションとして読まれてしまい、
 * 権限を広げる引数を指示に紛れ込ませられる（安全の約束 2）。先頭に空白を 1 つ足して、必ず指示として読ませる
 * （`--` で区切る方法は、claude の引数の読み方に左右されるので使わない）。
 */
export const asPositional = (prompt: string): string => (prompt.startsWith('-') ? ` ${prompt}` : prompt);

/**
 * `claude --bg` の出力から短縮 ID と名前を読む。
 *
 * ```
 * backgrounded · 7c5dcf5d · flaky-test-fix
 * ```
 *
 * 同名の生きたセッションがあると名前が変えられる（`tests (2)` など）ので、出力の名前を正とする。
 */
export const parseBackgrounded = (
  stdout: string,
): { readonly shortId: string; readonly name: string } | null => {
  const matched = /backgrounded\s*[·•|-]\s*([0-9A-Za-z_-]+)\s*[·•|-]\s*(.+?)\s*$/m.exec(stdout);
  if (matched === null || matched[1] === undefined) {
    return null;
  }
  return { shortId: matched[1], name: matched[2] ?? '' };
};

export type LaunchResult =
  | { readonly ok: true; readonly shortId: string; readonly name: string; readonly stdout: string }
  | { readonly ok: false; readonly message: string };

export interface RunOptions {
  readonly runner?: CommandRunner;
  readonly command?: string;
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly timeoutMs?: number;
}

/** `claude --bg` を実行し、起動したセッションの短縮 ID と名前を返す。 */
export const launchBackground = async (
  launch: BackgroundLaunch,
  options: RunOptions = {},
): Promise<LaunchResult> => {
  const runner = options.runner ?? execFileRunner;
  let args: string[];
  try {
    args = buildBackgroundArgs(launch);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  let stdout: string;
  try {
    stdout = await runner(options.command ?? 'claude', args, {
      // 常駐プロセスの起動を待つことがあるので長めに取る
      timeoutMs: options.timeoutMs ?? 60_000,
      signal: undefined,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
    });
  } catch (error) {
    return { ok: false, message: toCommandError(error, 'claude --bg がタイムアウトしました。').message };
  }
  const parsed = parseBackgrounded(stdout);
  if (parsed === null) {
    return {
      ok: false,
      message: `claude --bg の出力から起動したセッションを読み取れませんでした: ${stdout.trim().slice(0, 300)}`,
    };
  }
  return { ok: true, ...parsed, stdout };
};

/** `claude stop <短縮 ID>`。止めるだけで、会話や worktree は消さない。 */
export const stopSession = async (
  shortId: string,
  options: RunOptions = {},
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> => {
  const runner = options.runner ?? execFileRunner;
  try {
    await runner(options.command ?? 'claude', ['stop', shortId], {
      timeoutMs: options.timeoutMs ?? 30_000,
      signal: undefined,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: toCommandError(error, 'claude stop がタイムアウトしました。').message };
  }
};

export interface FindByShortIdOptions {
  readonly attempts?: number;
  readonly intervalMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * 起動直後のセッションを一覧から探す。sessionId（`--resume` に使う UUID）を知るため。
 * 一覧に載るまで少しかかることがあるので、何回か取り直す。
 */
export const findByShortId = async (
  fetchAgents: () => Promise<readonly Agent[] | null>,
  shortId: string,
  options: FindByShortIdOptions = {},
): Promise<Agent | null> => {
  const attempts = options.attempts ?? 10;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const agents = await fetchAgents();
    const found = agents?.find((agent) => agent.id === shortId);
    if (found !== undefined) {
      return found;
    }
    if (attempt < attempts - 1) {
      await sleep(options.intervalMs ?? 1000);
    }
  }
  return null;
};

/** プロセスが生きているか。`claude agents --json` は生きている間だけ pid を出す。 */
export const isAlive = (agent: Pick<Agent, 'pid'>): boolean => agent.pid !== undefined;

/**
 * `claude rm <短縮 ID>`。セッションを一覧から外す。Claude が作った worktree は、消してよいときだけ Claude が消す。
 * cuse は呼ぶ前に、commit していない変更や push していない commit が無いことを確かめる（`cuse clean`）。
 */
export const removeSession = async (
  shortId: string,
  options: RunOptions = {},
): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> => {
  const runner = options.runner ?? execFileRunner;
  try {
    await runner(options.command ?? 'claude', ['rm', shortId], {
      timeoutMs: options.timeoutMs ?? 30_000,
      signal: undefined,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: toCommandError(error, 'claude rm がタイムアウトしました。').message };
  }
};
