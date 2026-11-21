import { describe, expect, it } from 'vitest';
import {
  ensureSpawnHelperExecutable,
  spawnHelperCandidates,
  unpackedPath,
  type PtyHelperFileSystem,
} from './ptyHelper.js';

const memory = (modes: Record<string, number>) => {
  const chmods: [string, number][] = [];
  const fs: PtyHelperFileSystem = {
    mode: async (path) => modes[path] ?? null,
    chmod: async (path, mode) => {
      chmods.push([path, mode]);
    },
  };
  return { fs, chmods };
};

describe('unpackedPath', () => {
  it('.app の asar の中のパスを、展開済みの置き場所へ読み替える', () => {
    expect(unpackedPath('/A/cuse.app/Contents/Resources/app.asar/node_modules/node-pty')).toBe(
      '/A/cuse.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty',
    );
    expect(unpackedPath('/lib/node_modules/cuse/node_modules/node-pty')).toBe(
      '/lib/node_modules/cuse/node_modules/node-pty',
    );
  });
});

describe('ensureSpawnHelperExecutable', () => {
  const dir = '/A/app.asar/node_modules/node-pty';
  const helper = '/A/app.asar.unpacked/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper';

  it('候補は自前のビルドと、その機種の prebuild', () => {
    expect(spawnHelperCandidates(dir, 'darwin', 'arm64')).toEqual([
      '/A/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper',
      helper,
    ]);
  });

  it('実行権限が無ければ付ける（npm で入れたときの rw-r--r-- を直す）', async () => {
    const { fs, chmods } = memory({ [helper]: 0o100644 });
    expect(await ensureSpawnHelperExecutable(dir, { platform: 'darwin', arch: 'arm64', fs })).toEqual({
      ok: true,
      fixed: [helper],
    });
    expect(chmods).toEqual([[helper, 0o755]]);
  });

  it('付いていれば何もしない。無いファイルは飛ばす', async () => {
    const { fs, chmods } = memory({ [helper]: 0o100755 });
    expect(await ensureSpawnHelperExecutable(dir, { platform: 'darwin', arch: 'arm64', fs })).toEqual({
      ok: true,
      fixed: [],
    });
    expect(chmods).toEqual([]);
  });

  it('付けられなければ、手で直すコマンドを伝える', async () => {
    const fs: PtyHelperFileSystem = {
      mode: async () => 0o100644,
      chmod: async () => {
        throw new Error('EPERM');
      },
    };
    const result = await ensureSpawnHelperExecutable(dir, { platform: 'darwin', arch: 'arm64', fs });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('chmod +x');
  });
});
