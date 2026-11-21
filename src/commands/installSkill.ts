import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * `cuse install-skill [--force]`。
 *
 * cuse スキル（コマンドの使い方）を `~/.claude/skills/cuse/SKILL.md` に置く。
 * `cuse start` は無ければ置く。普段のセッションでも使いたいときは自分で実行する。
 * 人が書き換えたものを黙って上書きしないよう、違う内容があるときは `--force` を求める。
 */

export const SKILL_SOURCE = 'skill/cuse/SKILL.md';

export const skillPath = (home: string): string => join(home, '.claude', 'skills', 'cuse', 'SKILL.md');

export type InstallSkillStatus = 'installed' | 'updated' | 'unchanged' | 'differs';

export interface InstallSkillResult {
  readonly path: string;
  readonly status: InstallSkillStatus;
}

export interface SkillFileSystem {
  readonly read: (path: string) => Promise<string | null>;
  readonly write: (path: string, data: string) => Promise<void>;
}

export const fsSkillFileSystem: SkillFileSystem = {
  read: async (path) => {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  },
  write: async (path, data) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, 'utf8');
  },
};

export const installSkill = async (
  bundled: string,
  options: { readonly home: string; readonly force: boolean; readonly fs?: SkillFileSystem },
): Promise<InstallSkillResult> => {
  const fs = options.fs ?? fsSkillFileSystem;
  const path = skillPath(options.home);
  const current = await fs.read(path);
  if (current === bundled) {
    return { path, status: 'unchanged' };
  }
  if (current !== null && !options.force) {
    return { path, status: 'differs' };
  }
  await fs.write(path, bundled);
  return { path, status: current === null ? 'installed' : 'updated' };
};

export const describeInstallSkill = (result: InstallSkillResult): string => {
  switch (result.status) {
    case 'installed':
      return `cuse スキルを置きました: ${result.path}`;
    case 'updated':
      return `cuse スキルを新しくしました: ${result.path}`;
    case 'unchanged':
      return `cuse スキルは最新です: ${result.path}`;
    case 'differs':
      return `cuse スキルが別の内容で置かれています: ${result.path}。同梱の内容で置き換えるには cuse install-skill --force。`;
  }
};
