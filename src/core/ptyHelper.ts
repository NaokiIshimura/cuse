import { chmod, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';

/**
 * node-pty の `spawn-helper` に実行権限を付ける。
 *
 * macOS の node-pty は、端末を起こすときに `prebuilds/<platform>-<arch>/spawn-helper` を実行する。
 * ところが npm で入れると、この実行ファイルに実行権限が付いていないことがある（node-pty の既知の不具合）。
 * そのままだと `posix_spawnp failed` で端末が起きず、埋め込み端末が真っ暗なままになる。
 * 起動のたびに確かめ、足りなければ付ける（.app も npm で入れた CLI も同じ対処で直る）。
 */

export interface PtyHelperFileSystem {
  readonly mode: (path: string) => Promise<number | null>;
  readonly chmod: (path: string, mode: number) => Promise<void>;
}

export const fsPtyHelperFileSystem: PtyHelperFileSystem = {
  mode: async (path) => {
    try {
      return (await stat(path)).mode;
    } catch {
      return null;
    }
  },
  chmod: (path, mode) => chmod(path, mode),
};

/**
 * asar の中のパスを、展開済みの置き場所（app.asar.unpacked）へ読み替える。
 * 実行ファイルは asar の中からは実行できないので、.app では外に置いてある。
 */
export const unpackedPath = (path: string): string =>
  path.replace(`${sep}app.asar${sep}`, `${sep}app.asar.unpacked${sep}`);

/** `spawn-helper` の置き場所の候補（自前でビルドしたものと、同梱の prebuild）。 */
export const spawnHelperCandidates = (ptyDir: string, platform: string, arch: string): string[] => {
  const dir = unpackedPath(ptyDir);
  return [
    join(dir, 'build', 'Release', 'spawn-helper'),
    join(dir, 'prebuilds', `${platform}-${arch}`, 'spawn-helper'),
  ];
};

/** 誰かが実行できるか（所有者・グループ・その他のどれかに x がある）。 */
const isExecutable = (mode: number): boolean => (mode & 0o111) !== 0;

export type EnsureSpawnHelperResult =
  | { readonly ok: true; readonly fixed: readonly string[] }
  | { readonly ok: false; readonly message: string };

export const ensureSpawnHelperExecutable = async (
  ptyDir: string,
  options: {
    readonly platform: string;
    readonly arch: string;
    readonly fs?: PtyHelperFileSystem;
  },
): Promise<EnsureSpawnHelperResult> => {
  const fs = options.fs ?? fsPtyHelperFileSystem;
  const fixed: string[] = [];
  for (const path of spawnHelperCandidates(ptyDir, options.platform, options.arch)) {
    const mode = await fs.mode(path);
    if (mode === null || isExecutable(mode)) {
      continue;
    }
    try {
      await fs.chmod(path, (mode & 0o777) | 0o755);
      fixed.push(path);
    } catch (error) {
      return {
        ok: false,
        message: `端末を起こす部品（${path}）に実行権限を付けられませんでした: ${String(error)}。端末で chmod +x "${path}" を実行してください。`,
      };
    }
  }
  return { ok: true, fixed };
};
