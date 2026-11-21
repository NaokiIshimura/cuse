import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { prependPath } from '../core/paths.js';
import { buildShim, installShim, nodeRunnerPath, shellQuote, type ShimFileSystem } from './cuseShim.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('shellQuote', () => {
  it('空白や引用符を含むパスも 1 つの引数にする', () => {
    expect(shellQuote("/Applications/My App's/cuse")).toBe(`'/Applications/My App'\\''s/cuse'`);
  });
});

describe('buildShim', () => {
  it('アプリの Electron を Node として動かし、アプリの中の CLI に引数を渡す', () => {
    expect(buildShim('/Applications/cuse.app/Contents/MacOS/cuse', '/Applications/cuse.app/Contents/Resources/app/dist/cli.js')).toBe(
      [
        '#!/bin/sh',
        '# cuse.app が置いた、指揮役が使う cuse コマンド。cuse.app を開くたびに書き直される。',
        `ELECTRON_RUN_AS_NODE=1 exec '/Applications/cuse.app/Contents/MacOS/cuse' '/Applications/cuse.app/Contents/Resources/app/dist/cli.js' "$@"`,
        '',
      ].join('\n'),
    );
  });

  it('本物の sh で動かすと、引数がそのまま渡る', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cuse-shim-'));
    dirs.push(dir);
    // Electron の代わりに node を使い、CLI の代わりに引数と環境変数を表示するスクリプトを置く
    const script = join(dir, "c l'i.js");
    await writeFile(script, 'console.log(JSON.stringify([process.env.ELECTRON_RUN_AS_NODE, ...process.argv.slice(2)]))');
    const shim = join(dir, 'cuse');
    await writeFile(shim, buildShim(process.execPath, script), { mode: 0o755 });
    const { stdout } = await promisify(execFile)(shim, ['spawn', 'テストを 足して', 'tests']);
    expect(JSON.parse(stdout)).toEqual(['1', 'spawn', 'テストを 足して', 'tests']);
  });
});

describe('nodeRunnerPath', () => {
  const app = '/Applications/cuse.app/Contents';
  const helper = `${app}/Frameworks/cuse Helper.app/Contents/MacOS/cuse Helper`;

  it('.app の本体なら、Dock に出ない補助プロセス（cuse Helper）で動かす', () => {
    expect(nodeRunnerPath(`${app}/MacOS/cuse`, (path) => path === helper)).toBe(helper);
  });

  it('補助プロセスが無い・.app の外（開発中や macOS 以外）なら、本体のまま', () => {
    expect(nodeRunnerPath(`${app}/MacOS/cuse`, () => false)).toBe(`${app}/MacOS/cuse`);
    expect(nodeRunnerPath('/w/cuse/node_modules/electron/dist/electron', () => true)).toBe(
      '/w/cuse/node_modules/electron/dist/electron',
    );
  });

  it('補助プロセスのパスに空白があっても、cuse コマンドは 1 つの引数として埋め込む', () => {
    expect(buildShim(helper, '/c')).toContain(`exec '${helper}' '/c' "$@"`);
  });
});

describe('installShim', () => {
  it('~/.cuse/bin/cuse に置き、中身が同じなら書かない', async () => {
    const files = new Map<string, string>();
    const writes: string[] = [];
    const fs: ShimFileSystem = {
      read: async (path) => files.get(path) ?? null,
      write: async (path, data) => {
        writes.push(path);
        files.set(path, data);
      },
    };
    const options = { home: '/Users/u', execPath: '/e', cliPath: '/c', fs };
    expect(await installShim(options)).toBe('/Users/u/.cuse/bin/cuse');
    await installShim(options);
    expect(writes).toEqual(['/Users/u/.cuse/bin/cuse']);
    // アプリを移したら書き直す
    await installShim({ ...options, execPath: '/moved' });
    expect(writes).toHaveLength(2);
  });

  it('本物のファイルでは実行できる権限で置く', async () => {
    const home = await mkdtemp(join(tmpdir(), 'cuse-home-'));
    dirs.push(home);
    const path = await installShim({ home, execPath: '/e', cliPath: '/c' });
    expect((await stat(path)).mode & 0o111).not.toBe(0);
  });
});

describe('prependPath', () => {
  it('先頭に足し、重複は除く', () => {
    expect(prependPath('/u/.cuse/bin', '/usr/bin:/u/.cuse/bin:/bin')).toBe('/u/.cuse/bin:/usr/bin:/bin');
    expect(prependPath('/u/.cuse/bin', undefined)).toBe('/u/.cuse/bin');
  });
});
