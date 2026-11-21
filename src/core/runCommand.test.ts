// 写し元: cc-park `src/core/runCommand.test.ts` @ `d1f0f2d`（v0.25.0）
import { describe, expect, it } from 'vitest';
import { execFileRunner, toCommandError } from './runCommand.js';

const TIMEOUT_MESSAGE = 'タイムアウトしました。';

describe('toCommandError', () => {
  it('ENOENT を not-found にする', () => {
    const error = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    expect(toCommandError(error, TIMEOUT_MESSAGE)).toEqual({
      kind: 'not-found',
      message: 'claude コマンドが見つかりません。PATH を確認してください。',
    });
  });

  it('AbortError を aborted にする', () => {
    const error = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(toCommandError(error, TIMEOUT_MESSAGE).kind).toBe('aborted');
  });

  it('killed を timeout にし、渡した文言を使う', () => {
    const error = Object.assign(new Error('killed'), { killed: true });
    expect(toCommandError(error, TIMEOUT_MESSAGE)).toEqual({
      kind: 'timeout',
      message: TIMEOUT_MESSAGE,
    });
  });

  it('SIGTERM を timeout にする', () => {
    const error = Object.assign(new Error('terminated'), { signal: 'SIGTERM' });
    expect(toCommandError(error, TIMEOUT_MESSAGE).kind).toBe('timeout');
  });

  it('それ以外は exit にしてメッセージを保つ', () => {
    expect(toCommandError(new Error('boom'), TIMEOUT_MESSAGE)).toEqual({
      kind: 'exit',
      message: 'boom',
    });
  });

  it('標準エラーがあれば、それを理由にする', () => {
    const error = Object.assign(new Error('Command failed: claude --bg --settings {"env":{"CUSE_LEADER_TOKEN":"secret"}}'), {
      code: 1,
      stderr: 'Workspace not trusted.\n',
    });
    expect(toCommandError(error, TIMEOUT_MESSAGE)).toEqual({ kind: 'exit', message: 'Workspace not trusted.' });
  });

  it('コマンド全体（トークンや心得を含む）を理由に出さない', () => {
    const error = Object.assign(new Error('Command failed: claude --bg --settings {"env":{"CUSE_LEADER_TOKEN":"secret"}}'), {
      code: 2,
    });
    const { message } = toCommandError(error, TIMEOUT_MESSAGE);
    expect(message).toBe('コマンドが終了コード 2 で失敗しました。');
    expect(message).not.toContain('secret');
  });

  it('Error 以外でも文字列化して扱う', () => {
    expect(toCommandError('plain failure', TIMEOUT_MESSAGE)).toEqual({
      kind: 'exit',
      message: 'plain failure',
    });
  });

  it('null でも落ちない', () => {
    expect(toCommandError(null, TIMEOUT_MESSAGE)).toEqual({ kind: 'exit', message: 'null' });
  });
});

describe('execFileRunner', () => {
  it('標準出力を返す', async () => {
    const stdout = await execFileRunner('echo', ['hello'], {
      timeoutMs: 5000,
      signal: undefined,
    });
    expect(stdout.trim()).toBe('hello');
  });

  it('存在しないコマンドでは reject する', async () => {
    await expect(
      execFileRunner('cc-park-no-such-command', [], {
        timeoutMs: 5000,
        signal: undefined,
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cwd を指定するとそのディレクトリで実行する', async () => {
    const stdout = await execFileRunner('pwd', [], {
      timeoutMs: 5000,
      signal: undefined,
      cwd: '/tmp',
    });
    // macOS の /tmp は /private/tmp への symlink なので末尾で判定する
    expect(stdout.trim().endsWith('/tmp')).toBe(true);
  });

  it('signal で中断できる', async () => {
    const controller = new AbortController();
    const promise = execFileRunner('sleep', ['5'], {
      timeoutMs: 5000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).rejects.toBeDefined();
  });
});

describe('execFileRunner（本物の子プロセス）', () => {
  it('失敗したとき、標準エラーを理由として受け取れる', async () => {
    const error = await execFileRunner('sh', ['-c', 'echo oops >&2; exit 3'], {
      timeoutMs: 5000,
      signal: undefined,
    }).catch((caught: unknown) => caught);
    expect(toCommandError(error, 'timeout')).toEqual({ kind: 'exit', message: 'oops' });
  });
});
