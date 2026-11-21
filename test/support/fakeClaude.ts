import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpsDeps } from '../../src/commands/deps.js';
import { judgeClaudeVersion } from '../../src/core/claudeVersion.js';
import { fetchAgents } from '../../src/core/fetchAgents.js';
import { emptyLedger, type Ledger } from '../../src/core/ledger.js';
import type { CommandRunner } from '../../src/core/runCommand.js';
import type { RawAgent } from '../../src/types/agent.js';

/**
 * 本物の `claude` の代わりに使う、メモリ上の「Claude Code の世界」。
 *
 * `claude agents --json --all` / `claude --bg` / `claude --resume ... --bg` / `claude stop` /
 * `claude --version` と `git rev-parse` に答え、呼ばれた引数・環境変数・作業ディレクトリを記録する。
 * テストや CI で本物の `claude` を呼ばないための偽物。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface FakeCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string | undefined;
  readonly env: NodeJS.ProcessEnv | undefined;
}

export interface FakeWorld {
  readonly agents: RawAgent[];
  readonly calls: FakeCall[];
  ledger: Ledger;
  version: string;
  /** git リポジトリではないディレクトリ */
  readonly nonRepositories: Set<string>;
  /** Claude Code が信頼していないディレクトリ（`claude --bg` が断る） */
  readonly untrusted: Set<string>;
  /** `claude --resume` が会話を写して新しい ID で始めるか */
  resumeCopies: boolean;
  /** スキルなど、cuse が書いたファイル（パス → 中身） */
  readonly files: Map<string, string>;
  readonly deps: OpsDeps;
}

const optionValue = (args: readonly string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

export const createFakeWorld = (
  options: {
    readonly agents?: RawAgent[];
    readonly ledger?: Ledger;
    readonly env?: NodeJS.ProcessEnv;
    readonly cwd?: string;
  } = {},
): FakeWorld => {
  let counter = 0;
  const nextId = () => {
    counter += 1;
    return `${String(counter).padStart(4, '0')}beef`;
  };
  let clock = Date.parse('2026-11-21T09:00:00Z');

  const world = {
    agents: options.agents ?? [],
    calls: [] as FakeCall[],
    ledger: options.ledger ?? emptyLedger(),
    version: '2.1.325',
    nonRepositories: new Set<string>(),
    untrusted: new Set<string>(),
    resumeCopies: false,
    files: new Map<string, string>(),
  } as Omit<FakeWorld, 'deps'> & { deps?: OpsDeps };

  const runner: CommandRunner = async (command, args, runOptions) => {
    world.calls.push({ command, args: [...args], cwd: runOptions.cwd, env: runOptions.env });

    if (command === 'git') {
      const cwd = optionValue(args, '-C') ?? '';
      if (world.nonRepositories.has(cwd)) {
        throw Object.assign(new Error('not a git repository'), { code: 128 });
      }
      return 'true\n';
    }

    if (args[0] === '--version') {
      return `${world.version} (Claude Code)\n`;
    }
    if (args[0] === 'agents') {
      return JSON.stringify(world.agents);
    }
    if (args[0] === 'stop') {
      const agent = world.agents.find((candidate) => candidate.id === args[1]);
      if (agent === undefined) {
        throw Object.assign(new Error(`no session ${args[1]}`), { code: 1 });
      }
      const index = world.agents.indexOf(agent);
      // 止まると pid と status が消える（プロセスがいなくなる）
      const { pid: _pid, status: _status, ...rest } = agent;
      world.agents[index] = { ...rest, state: 'stopped' };
      return '';
    }
    if (args.includes('--bg') && world.untrusted.has(runOptions.cwd ?? '')) {
      // 本物と同じく、コマンド全体が message に入り、理由は標準エラーに出る
      throw Object.assign(new Error(`Command failed: claude ${args.join(' ')}`), {
        code: 1,
        stderr:
          'Workspace not trusted. The home directory is trusted one session at a time — start this from an interactive terminal there, or from a project directory.\n',
      });
    }
    if (args.includes('--bg')) {
      const resume = optionValue(args, '--resume');
      const id = nextId();
      if (resume !== undefined) {
        const previous = world.agents.find((agent) => agent.sessionId === resume);
        const name = previous?.name ?? 'resumed';
        const sessionId = world.resumeCopies ? `${id}-0000-4000-8000-000000000000` : resume;
        // 写さないときは同じ会話の続き。一覧の行を差し替える
        if (!world.resumeCopies && previous !== undefined) {
          world.agents.splice(world.agents.indexOf(previous), 1);
        }
        world.agents.push({
          kind: 'background',
          id,
          sessionId,
          name,
          cwd: runOptions.cwd ?? '',
          startedAt: clock,
          state: 'working',
          status: 'busy',
          pid: 9000 + counter,
        });
        return `backgrounded · ${id} · ${name}\n`;
      }
      const requested = optionValue(args, '--name') ?? 'session';
      // 同名の生きたセッションがあると名前を変えられる
      const taken = world.agents.some((agent) => agent.name === requested && agent.pid !== undefined);
      const name = taken ? `${requested} (2)` : requested;
      world.agents.push({
        kind: 'background',
        id,
        sessionId: `${id}-0000-4000-8000-000000000000`,
        name,
        cwd: runOptions.cwd ?? '',
        startedAt: clock,
        state: 'working',
        status: 'busy',
        pid: 9000 + counter,
      });
      return `Starting background service…\nbackgrounded · ${id} · ${name}\n  claude attach ${id}\n`;
    }
    throw new Error(`偽の claude が知らない呼び出し: ${command} ${args.join(' ')}`);
  };

  world.deps = {
    env: options.env ?? {},
    cwd: options.cwd ?? '/Users/example/project',
    home: '/Users/example',
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    runner,
    // transcript は読まない（ホームのファイルに触れないように）
    fetchAgents: (fetchOptions) => fetchAgents({ ...fetchOptions, meta: false, runner }),
    readLedger: async () => ({ kind: 'ok', ledger: world.ledger }),
    updateLedger: async (update) => {
      world.ledger = update(world.ledger);
      return world.ledger;
    },
    checkVersion: async (minimum) => judgeClaudeVersion(world.version, minimum),
    readBundled: (relativePath) => readFile(join(ROOT, relativePath), 'utf8'),
    skillFs: {
      read: async (path) => world.files.get(path) ?? null,
      write: async (path, data) => {
        world.files.set(path, data);
      },
    },
  };
  return world as FakeWorld;
};

/** `claude` を `--bg` で呼んだ記録だけを取り出す。 */
export const bgCalls = (world: FakeWorld): FakeCall[] =>
  world.calls.filter((call) => call.command === 'claude' && call.args.includes('--bg'));
