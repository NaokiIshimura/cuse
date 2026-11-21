import { describe, expect, it } from 'vitest';
import { installSkill, skillPath, type SkillFileSystem } from './installSkill.js';

const memory = (initial?: string) => {
  const files = new Map<string, string>();
  if (initial !== undefined) files.set(skillPath('/h'), initial);
  const fs: SkillFileSystem = {
    read: async (path) => files.get(path) ?? null,
    write: async (path, data) => {
      files.set(path, data);
    },
  };
  return { fs, files };
};

describe('installSkill', () => {
  it('~/.claude/skills/cuse/SKILL.md に置く', async () => {
    const { fs, files } = memory();
    expect(await installSkill('skill', { home: '/h', force: false, fs })).toEqual({
      path: '/h/.claude/skills/cuse/SKILL.md',
      status: 'installed',
    });
    expect(files.get('/h/.claude/skills/cuse/SKILL.md')).toBe('skill');
  });

  it('同じ内容なら何もしない', async () => {
    const { fs } = memory('skill');
    expect((await installSkill('skill', { home: '/h', force: false, fs })).status).toBe('unchanged');
  });

  it('違う内容は --force のときだけ置き換える', async () => {
    const { fs, files } = memory('mine');
    expect((await installSkill('skill', { home: '/h', force: false, fs })).status).toBe('differs');
    expect(files.get(skillPath('/h'))).toBe('mine');
    expect((await installSkill('skill', { home: '/h', force: true, fs })).status).toBe('updated');
    expect(files.get(skillPath('/h'))).toBe('skill');
  });
});
