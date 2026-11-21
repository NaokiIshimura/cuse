import { describe, expect, it } from 'vitest';
import {
  describeInstallSkill,
  installSkill,
  isManagedSkill,
  MANAGED_MARKER,
  skillPath,
  type SkillFileSystem,
} from './installSkill.js';

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

  it('cuse が置いた古い内容は、自動で最新に書き直す（印のあるもの・印の無い古い版）', async () => {
    const marked = memory(`---\nname: cuse\n---\n${MANAGED_MARKER} … -->\n古い説明`);
    expect((await installSkill('skill', { home: '/h', force: false, fs: marked.fs })).status).toBe('updated');
    expect(marked.files.get(skillPath('/h'))).toBe('skill');

    const legacy = memory(
      '---\nname: cuse\ndescription: cuse の指揮役として、このマシンのほかの Claude Code セッション（配下）を起動・見守り・指示・停止するときに使う。cuse start で起動した指揮役（cuse-leader）専用。\n---\n',
    );
    expect((await installSkill('skill', { home: '/h', force: false, fs: legacy.fs })).status).toBe('updated');
  });

  it('同梱のスキルには印が入っている（次の版でも自動で書き直せるように）', async () => {
    const { readFile } = await import('node:fs/promises');
    const bundled = await readFile(new URL('../../skill/cuse/SKILL.md', import.meta.url), 'utf8');
    expect(isManagedSkill(bundled)).toBe(true);
  });

  it('人が書いた内容は --force のときだけ置き換え、案内に CLI のコマンドを出さない', async () => {
    const { fs, files } = memory('mine');
    expect(describeInstallSkill({ path: '/p', status: 'differs' })).toContain('このファイルを消してから cuse.app を開き直してください');
    expect(describeInstallSkill({ path: '/p', status: 'differs' })).not.toContain('install-skill');
    expect((await installSkill('skill', { home: '/h', force: false, fs })).status).toBe('differs');
    expect(files.get(skillPath('/h'))).toBe('mine');
    expect((await installSkill('skill', { home: '/h', force: true, fs })).status).toBe('updated');
    expect(files.get(skillPath('/h'))).toBe('skill');
  });
});
