import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCuseBin } from '../core/paths.js';

/**
 * 指揮役が使う `cuse` コマンドを、アプリが用意する。
 *
 * cuse はアプリ（cuse.app）だけで使えるようにし、人に CLI を入れてもらわない。
 * 指揮役は Bash から `cuse spawn` などを呼ぶので、アプリの中の CLI（dist/cli.js）を
 * アプリ自身の Electron を Node として動かして実行する小さなスクリプトを `~/.cuse/bin/cuse` に置く。
 * Node.js や npm は要らない。アプリを移したり更新したりしても、次に開いたときに書き直される。
 */

/** sh の 1 つの引数として安全に埋め込めるよう、単一引用符で囲む。 */
export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

export const buildShim = (execPath: string, cliPath: string): string =>
  [
    '#!/bin/sh',
    '# cuse.app が置いた、指揮役が使う cuse コマンド。cuse.app を開くたびに書き直される。',
    `ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(execPath)} ${shellQuote(cliPath)} "$@"`,
    '',
  ].join('\n');

export interface ShimFileSystem {
  readonly read: (path: string) => Promise<string | null>;
  readonly write: (path: string, data: string) => Promise<void>;
}

export const fsShimFileSystem: ShimFileSystem = {
  read: (path) => readFile(path, 'utf8').catch(() => null),
  write: async (path, data) => {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, data, 'utf8');
    await chmod(path, 0o755);
  },
};

/** `~/.cuse/bin/cuse` を置く。中身が同じなら書かない。置いた場所を返す。 */
export const installShim = async (options: {
  readonly home: string;
  readonly execPath: string;
  readonly cliPath: string;
  readonly fs?: ShimFileSystem;
}): Promise<string> => {
  const fs = options.fs ?? fsShimFileSystem;
  const path = join(buildCuseBin(options.home), 'cuse');
  const shim = buildShim(options.execPath, options.cliPath);
  if ((await fs.read(path)) !== shim) {
    await fs.write(path, shim);
  }
  return path;
};
