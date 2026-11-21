import { describe, expect, it } from 'vitest';
import { claudeConfigPath, isFolderTrusted, readFolderTrusted } from './claudeTrust.js';

describe('claudeConfigPath', () => {
  it('既定は ~/.claude.json、CLAUDE_CONFIG_DIR があればその中', () => {
    expect(claudeConfigPath('/Users/u', {})).toBe('/Users/u/.claude.json');
    expect(claudeConfigPath('/Users/u', { CLAUDE_CONFIG_DIR: '/c' })).toBe('/c/.claude.json');
  });
});

describe('isFolderTrusted', () => {
  it('projects[フォルダ].hasTrustDialogAccepted が true なら信頼済み', () => {
    const config = { projects: { '/Users/u/.cuse/leader': { hasTrustDialogAccepted: true } } };
    expect(isFolderTrusted(config, '/Users/u/.cuse/leader')).toBe(true);
    expect(isFolderTrusted(config, '/Users/u/other')).toBe(false);
  });

  it('形が違えば false（分からないものは信頼済みとみなさない）', () => {
    expect(isFolderTrusted(null, '/f')).toBe(false);
    expect(isFolderTrusted({ projects: [] }, '/f')).toBe(false);
    expect(isFolderTrusted({ projects: { '/f': { hasTrustDialogAccepted: 'yes' } } }, '/f')).toBe(false);
  });
});

describe('readFolderTrusted', () => {
  it('読めない・壊れているなら false', async () => {
    const options = { home: '/Users/u', env: {} };
    expect(await readFolderTrusted('/f', { ...options, read: async () => '{' })).toBe(false);
    expect(
      await readFolderTrusted('/f', {
        ...options,
        read: async () => {
          throw new Error('ENOENT');
        },
      }),
    ).toBe(false);
    expect(
      await readFolderTrusted('/f', {
        ...options,
        read: async () => JSON.stringify({ projects: { '/f': { hasTrustDialogAccepted: true } } }),
      }),
    ).toBe(true);
  });
});
