import { describe, expect, it } from 'vitest';
import { buildGuiEnv, resolveElectronPath } from './launch.js';

describe('buildGuiEnv', () => {
  it('ELECTRON_RUN_AS_NODE を外し、ほかは残す', () => {
    const env = buildGuiEnv({ ELECTRON_RUN_AS_NODE: '1', PATH: '/bin' });
    expect(env).toEqual({ PATH: '/bin' });
  });
});

describe('resolveElectronPath', () => {
  it('electron パッケージの既定エクスポートを返す', async () => {
    expect(await resolveElectronPath(async () => ({ default: '/bin/electron' }))).toBe(
      '/bin/electron',
    );
  });

  it('読み込めなければ null', async () => {
    expect(
      await resolveElectronPath(async () => {
        throw new Error('missing');
      }),
    ).toBeNull();
  });

  it('パスでなければ null', async () => {
    expect(await resolveElectronPath(async () => ({ default: 1 }))).toBeNull();
  });
});
