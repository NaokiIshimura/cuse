import { describe, expect, it } from 'vitest';
import { makeAgent } from '../../test/support/agents.js';
import {
  buildBackgroundArgs,
  findByShortId,
  launchBackground,
  parseBackgrounded,
  stopSession,
} from './claudeBg.js';

describe('buildBackgroundArgs', () => {
  it('配下: 名前・権限モード・エージェント・モデル・指示', () => {
    expect(
      buildBackgroundArgs({
        name: 'tests',
        prompt: 'テストを追加して',
        permissionMode: 'acceptEdits',
        agent: 'reviewer',
        model: 'sonnet',
      }),
    ).toEqual([
      '--bg',
      '--name',
      'tests',
      '--permission-mode',
      'acceptEdits',
      '--agent',
      'reviewer',
      '--model',
      'sonnet',
      'テストを追加して',
    ]);
  });

  it('指揮役: 編集系ツールを外し、心得とトークンを渡す。指示はいちばん後ろ', () => {
    const args = buildBackgroundArgs({
      name: 'cuse-leader',
      prompt: '待機して',
      disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
      appendSystemPrompt: '心得',
      settings: { env: { CUSE_LEADER_TOKEN: 't' } },
    });
    expect(args).toEqual([
      '--bg',
      '--name',
      'cuse-leader',
      '--settings',
      '{"env":{"CUSE_LEADER_TOKEN":"t"}}',
      '--disallowedTools',
      'Edit',
      'Write',
      'NotebookEdit',
      '--append-system-prompt',
      '心得',
      '待機して',
    ]);
  });

  it('心得が無ければ、外すツールはカンマ区切りの 1 つの値にする', () => {
    expect(
      buildBackgroundArgs({ prompt: 'p', disallowedTools: ['Edit', 'Write'] }),
    ).toEqual(['--bg', '--disallowedTools', 'Edit,Write', 'p']);
  });

  it('再開: --resume <sessionId> --bg', () => {
    expect(buildBackgroundArgs({ resume: 'uuid', prompt: '続き' })).toEqual([
      '--resume',
      'uuid',
      '--bg',
      '続き',
    ]);
  });

  it('権限確認を飛ばすモードは組み立てない', () => {
    expect(() => buildBackgroundArgs({ prompt: 'p', permissionMode: 'bypassPermissions' })).toThrow(
      '使えません',
    );
  });

  it('--dangerously-skip-permissions はどの組み合わせでも出さない', () => {
    const args = buildBackgroundArgs({
      name: 'n',
      prompt: 'p',
      permissionMode: 'auto',
      disallowedTools: ['Edit'],
      appendSystemPrompt: 'x',
    });
    expect(args.join(' ')).not.toContain('dangerously');
  });
});

describe('parseBackgrounded', () => {
  it('ドキュメントの出力例を読める', () => {
    const stdout = [
      'Starting background service…',
      'backgrounded · 7c5dcf5d · flaky-test-fix',
      '  claude agents             list sessions',
      '  claude attach 7c5dcf5d    open in this terminal',
    ].join('\n');
    expect(parseBackgrounded(stdout)).toEqual({ shortId: '7c5dcf5d', name: 'flaky-test-fix' });
  });

  it('名前が変えられていれば、その名前を返す', () => {
    expect(parseBackgrounded('backgrounded · abc12345 · tests (2)\n')).toEqual({
      shortId: 'abc12345',
      name: 'tests (2)',
    });
  });

  it('読めなければ null', () => {
    expect(parseBackgrounded('error: something')).toBeNull();
  });
});

describe('launchBackground', () => {
  it('claude を cwd と env 付きで実行し、短縮 ID を返す', async () => {
    const calls: { args: readonly string[]; cwd?: string; env?: NodeJS.ProcessEnv }[] = [];
    const result = await launchBackground(
      { name: 'tests', prompt: 'p' },
      {
        cwd: '/w',
        env: { PATH: '/bin' },
        runner: async (_command, args, options) => {
          calls.push({
            args,
            ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
            ...(options.env === undefined ? {} : { env: options.env }),
          });
          return 'backgrounded · abcd1234 · tests\n';
        },
      },
    );
    expect(result).toMatchObject({ ok: true, shortId: 'abcd1234', name: 'tests' });
    expect(calls).toEqual([{ args: ['--bg', '--name', 'tests', 'p'], cwd: '/w', env: { PATH: '/bin' } }]);
  });

  it('出力を読めなければ失敗にする', async () => {
    const result = await launchBackground({ prompt: 'p' }, { runner: async () => 'hmm' });
    expect(result.ok).toBe(false);
  });

  it('実行の失敗を理由にして返す', async () => {
    const result = await launchBackground(
      { prompt: 'p' },
      {
        runner: async () => {
          throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
        },
      },
    );
    expect(result).toEqual({
      ok: false,
      message: 'claude コマンドが見つかりません。PATH を確認してください。',
    });
  });
});

describe('stopSession', () => {
  it('claude stop <短縮 ID>', async () => {
    const calls: string[][] = [];
    const result = await stopSession('abcd1234', {
      runner: async (command, args) => {
        calls.push([command, ...args]);
        return '';
      },
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([['claude', 'stop', 'abcd1234']]);
  });
});

describe('findByShortId', () => {
  it('一覧に載るまで取り直す', async () => {
    let calls = 0;
    const found = await findByShortId(
      async () => {
        calls += 1;
        return calls < 3 ? [] : [makeAgent({ name: 'tests', id: 'abcd1234' })];
      },
      'abcd1234',
      { sleep: async () => undefined },
    );
    expect(found?.name).toBe('tests');
    expect(calls).toBe(3);
  });

  it('見つからなければ null', async () => {
    const found = await findByShortId(async () => [], 'x', {
      attempts: 2,
      sleep: async () => undefined,
    });
    expect(found).toBeNull();
  });
});
