import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { isSafeToClean, keepReason, readGitStatus, readPullRequest, type GitStatus } from './gitStatus.js';
import { execFileRunner } from './runCommand.js';

/**
 * 本物の git で確かめる（git は claude ではないので、テストで動かしてよい）。
 * 取り込み先（origin）は一時ディレクトリの bare リポジトリにする。
 */

const run = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const git = (cwd: string, ...args: string[]) =>
  run('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', ...args], { cwd });

/** origin を持つ作業用リポジトリを作る。main は push 済み。 */
const setup = async () => {
  const root = await mkdtemp(join(tmpdir(), 'cuse-git-'));
  dirs.push(root);
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  await run('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  await run('git', ['clone', '-q', origin, work]);
  await writeFile(join(work, 'README.md'), 'hello\n');
  await git(work, 'add', '.');
  await git(work, 'commit', '-q', '-m', 'init');
  await git(work, 'push', '-q', 'origin', 'main');
  await git(work, 'remote', 'set-head', 'origin', 'main');
  return { root, work };
};

const status = (dir: string) => readGitStatus(dir, { runner: execFileRunner });

describe('readGitStatus（本物の git）', () => {
  it('push 済みで変更が無ければ、片付けてよい', async () => {
    const { work } = await setup();
    const result = await status(work);
    expect(result).toMatchObject({ repository: true, branch: 'main', upstream: 'origin/main', uncommitted: [], unpushed: 0 });
    expect(isSafeToClean(result)).toBe(true);
  });

  it('commit していない変更があれば残す', async () => {
    const { work } = await setup();
    await writeFile(join(work, 'README.md'), 'changed\n');
    const result = await status(work);
    expect(result.uncommitted).toEqual([' M README.md']);
    expect(keepReason(result)).toBe('commit していない変更が 1 件');
  });

  it('まだ push していないブランチは、取り込み先に無い commit を数えて残す', async () => {
    const { work } = await setup();
    await git(work, 'switch', '-q', '-c', 'cuse/tests');
    await writeFile(join(work, 'test.txt'), 'x\n');
    await git(work, 'add', '.');
    await git(work, 'commit', '-q', '-m', 'add test');
    const result = await status(work);
    expect(result).toMatchObject({ branch: 'cuse/tests', upstream: null, base: 'origin/HEAD', unpushed: 1 });
    expect(result.diffStat).toBe('1 file changed, 1 insertion(+)');
    expect(keepReason(result)).toBe('push していない commit が 1 件');
  });

  it('push したら片付けてよい', async () => {
    const { work } = await setup();
    await git(work, 'switch', '-q', '-c', 'cuse/tests');
    await writeFile(join(work, 'test.txt'), 'x\n');
    await git(work, 'add', '.');
    await git(work, 'commit', '-q', '-m', 'add test');
    await git(work, 'push', '-q', '-u', 'origin', 'cuse/tests');
    const result = await status(work);
    expect(result).toMatchObject({ upstream: 'origin/cuse/tests', unpushed: 0 });
    expect(isSafeToClean(result)).toBe(true);
  });

  it('リモートが無く確かめられなければ残す（分からないことは残す側に倒す）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cuse-git-'));
    dirs.push(root);
    await git(root, 'init', '-q');
    await writeFile(join(root, 'a'), 'a');
    await git(root, 'add', '.');
    await git(root, 'commit', '-q', '-m', 'a');
    const result = await status(root);
    expect(result.unpushed).toBeNull();
    expect(keepReason(result)).toBe('push したか確かめられない（リモートが無い）');
  });

  it('git リポジトリでなければ、失うものが無いので片付けてよい', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cuse-nogit-'));
    dirs.push(root);
    const result: GitStatus = await status(root);
    expect(result.repository).toBe(false);
    expect(isSafeToClean(result)).toBe(true);
  });
});

describe('readPullRequest', () => {
  it('gh の出力を読む。失敗したら null', async () => {
    expect(
      await readPullRequest('/w', { runner: async () => JSON.stringify({ number: 3, url: 'https://x/pull/3', state: 'OPEN' }) }),
    ).toEqual({ number: 3, url: 'https://x/pull/3', state: 'OPEN' });
    expect(
      await readPullRequest('/w', {
        runner: async () => {
          throw new Error('no pull requests found');
        },
      }),
    ).toBeNull();
  });
});
