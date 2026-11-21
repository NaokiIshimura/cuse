import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { fetchAgents } from './core/fetchAgents.js';
import type { CommandRunner } from './core/runCommand.js';
import { runCli, type CliDeps, type CliFlags } from './runCli.js';

/**
 * CLI 全体の流れを、本物の `claude` を呼ばずに確かめる。
 * `claude agents --json` の出力は test/fixtures の実物の見本を返す偽物に差し替える。
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures');
const agentsJson = JSON.stringify([
  ...JSON.parse(readFileSync(join(FIXTURES, 'agents', 'background.json'), 'utf8')),
  ...JSON.parse(readFileSync(join(FIXTURES, 'agents', 'interactive-busy.json'), 'utf8')),
]);

const flags = (overrides: Partial<CliFlags> = {}): CliFlags => ({
  all: false,
  json: false,
  lines: undefined,
  debug: false,
  ...overrides,
});

const fakeRunner =
  (stdout: string, calls: string[][] = []): CommandRunner =>
  async (command, args) => {
    calls.push([command, ...args]);
    return stdout;
  };

const deps = (overrides: Partial<CliDeps> = {}): CliDeps => ({
  // meta は読まない（ホームの transcript に触れないように）
  fetchAgents: (options) => fetchAgents({ ...options, meta: false, runner: fakeRunner(agentsJson) }),
  readLedger: async () => ({ kind: 'missing' }),
  checkVersion: async () => ({ ok: true, version: '2.1.325' }),
  readLastReport: async () => 'テストを追加しました',
  readLogs: async () => ({ ok: true, lines: ['log 1', 'log 2'] }),
  now: () => 1789881296899,
  home: '/home/example',
  ...overrides,
});

const parse = (stdout: string): unknown => JSON.parse(stdout);

describe('runCli', () => {
  it('agents --all --json は全セッションを JSON で返す', async () => {
    const result = await runCli('agents', [], flags({ all: true, json: true }), deps());
    expect(result.code).toBe(0);
    const output = parse(result.stdout) as { agents: { name: string; state: string }[] };
    expect(output.agents.map((agent) => [agent.name, agent.state])).toEqual([
      ['claude agents setup', 'blocked'],
      ['project-96', 'working'],
      ['refactor', 'working'],
    ]);
  });

  it('agents は既定で台帳の配下だけ（台帳が無ければ空）', async () => {
    const result = await runCli('agents', [], flags({ json: true }), deps());
    expect(parse(result.stdout)).toEqual({ scope: 'workers', ledger: 'missing', agents: [] });
  });

  it('claude agents は常に --all で呼ぶ（完了した配下も DONE に出すため）', async () => {
    const calls: string[][] = [];
    await runCli(
      'status',
      [],
      flags(),
      deps({
        fetchAgents: (options) =>
          fetchAgents({ ...options, meta: false, runner: fakeRunner(agentsJson, calls) }),
      }),
    );
    expect(calls).toEqual([['claude', 'agents', '--json', '--all']]);
  });

  it('status --all は人の対応が要るものを返す', async () => {
    const result = await runCli('status', [], flags({ all: true, json: true }), deps());
    const output = parse(result.stdout) as { total: number; attention: { name: string }[] };
    expect(output.total).toBe(3);
    expect(output.attention.map((item) => item.name)).toEqual(['claude agents setup']);
  });

  it('output は名前で探して最後の報告とログを返す', async () => {
    const result = await runCli('output', ['refactor'], flags({ json: true }), deps());
    expect(parse(result.stdout)).toMatchObject({
      name: 'refactor',
      shortId: '3a71b0de',
      lastReport: 'テストを追加しました',
      logs: ['log 1', 'log 2'],
    });
  });

  it('output の --lines を claude logs の読み取りへ渡す', async () => {
    const lines: number[] = [];
    await runCli(
      'output',
      ['refactor'],
      flags({ lines: 5 }),
      deps({
        readLogs: async (_agent, count) => {
          lines.push(count);
          return { ok: true, lines: [] };
        },
      }),
    );
    expect(lines).toEqual([5]);
  });

  it('名前が曖昧なら候補を並べてエラー（終了コード 1）', async () => {
    const result = await runCli('output', ['e'], flags({ json: true }), deps());
    expect(result.code).toBe(1);
    expect(parse(result.stdout)).toMatchObject({
      error: { kind: 'ambiguous', candidates: ['claude agents setup', 'refactor', 'project-96'] },
    });
  });

  it('見つからなければ not-found', async () => {
    const result = await runCli('output', ['nothing'], flags(), deps());
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('見つかりません');
  });

  it('名前の無い output は使い方のエラー', async () => {
    const result = await runCli('output', [], flags({ json: true }), deps());
    expect(parse(result.stdout)).toMatchObject({ error: { kind: 'usage' } });
  });

  it('知らないコマンドは使い方のエラー', async () => {
    const result = await runCli('spawn', [], flags({ json: true }), deps());
    expect(result.code).toBe(1);
    expect(parse(result.stdout)).toMatchObject({ error: { kind: 'usage' } });
  });

  it('claude が無ければ not-found のエラー', async () => {
    const result = await runCli(
      'agents',
      [],
      flags({ json: true }),
      deps({
        fetchAgents: (options) =>
          fetchAgents({
            ...options,
            runner: async () => {
              throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
            },
          }),
        checkVersion: async () => ({
          ok: false,
          kind: 'not-found',
          version: null,
          message: 'claude コマンドが見つかりません。',
        }),
      }),
    );
    expect(result.code).toBe(1);
    expect(parse(result.stdout)).toMatchObject({ error: { kind: 'not-found' } });
    // 同じことを二重に知らせない
    expect(result.stderr).toBe('');
  });

  it('Claude Code が古ければ標準エラーで知らせ、結果は返す', async () => {
    const result = await runCli(
      'agents',
      [],
      flags({ all: true, json: true }),
      deps({
        checkVersion: async () => ({
          ok: false,
          kind: 'too-old',
          version: '2.1.100',
          message: 'Claude Code v2.1.100 は background セッションに対応していません。',
        }),
      }),
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('v2.1.100');
    expect(() => parse(result.stdout)).not.toThrow();
  });

  it('壊れた台帳は使わずに続け、標準エラーで知らせる', async () => {
    const result = await runCli(
      'status',
      [],
      flags(),
      deps({ readLedger: async () => ({ kind: 'invalid', message: '壊れています' }) }),
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('台帳を使わずに続けます: 壊れています');
  });

  it('--lines に負の数は渡せない', async () => {
    const result = await runCli('output', ['refactor'], flags({ lines: -1 }), deps());
    expect(result.code).toBe(1);
  });
});
