import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * `cuse install-skill [--force]`。
 *
 * cuse スキル（コマンドの使い方）を `~/.claude/skills/cuse/SKILL.md` に置く。
 * 指揮役を起こすたびに呼ばれ、cuse が置いたもの（{@link isManagedSkill}）なら最新の内容に書き直す
 * （cuse を更新したら、スキルの説明も新しいコマンドに合わせて変わる必要があるため）。
 * 人が自分で書いたものは黙って上書きせず、`differs` を返して知らせる（`--force` なら置き換える）。
 */

/** cuse が置いたことを示す印。人が自分で書き換えて使うときは、この印を消してもらう。 */
export const MANAGED_MARKER = '<!-- cuse-managed:';

/**
 * cuse が置いたスキルか。
 *
 * 印を入れる前の版（v0.2.5 まで）が置いたものも、cuse の説明文で始まっていれば cuse のものとみなす。
 */
export const isManagedSkill = (content: string): boolean =>
  content.includes(MANAGED_MARKER) ||
  /^---\nname: cuse\ndescription: cuse の指揮役として、このマシンのほかの Claude Code セッション（配下）を起動・見守り・指示・停止するときに使う。/.test(
    content,
  );

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
  if (current !== null && !options.force && !isManagedSkill(current)) {
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
      return `${result.path} に自分で書いた cuse スキルがあるため、cuse の最新の内容に書き直していません。cuse の内容に戻すには、このファイルを消してから cuse.app を開き直してください。`;
  }
};
