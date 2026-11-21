import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Claude Code がフォルダを信頼したかを読む（読むだけ。書かない）。
 *
 * 初回、指揮役の居場所を人に信頼してもらったら、ボタンを押さなくても指揮役を起こせるようにするため。
 * Claude Code は信頼したフォルダを `~/.claude.json`（`CLAUDE_CONFIG_DIR` があればその中）の
 * `projects[<フォルダ>].hasTrustDialogAccepted` に残す。非公開の形式なので、読めなければ
 * 「分からない」として扱い、人がボタンで起こす流れに任せる。
 */

/** Claude Code の設定ファイルの置き場所。 */
export const claudeConfigPath = (home: string, env: NodeJS.ProcessEnv): string => {
  const dir = env['CLAUDE_CONFIG_DIR'];
  return dir !== undefined && dir !== '' ? join(dir, '.claude.json') : join(home, '.claude.json');
};

/** 設定ファイルの中身から、フォルダが信頼済みかを読む。形が違えば false。 */
export const isFolderTrusted = (config: unknown, folder: string): boolean => {
  const projects = (config as { readonly projects?: unknown } | null)?.projects;
  if (typeof projects !== 'object' || projects === null) {
    return false;
  }
  const project = (projects as Record<string, unknown>)[folder];
  return (
    typeof project === 'object' &&
    project !== null &&
    (project as { readonly hasTrustDialogAccepted?: unknown }).hasTrustDialogAccepted === true
  );
};

export const readFolderTrusted = async (
  folder: string,
  options: {
    readonly home: string;
    readonly env: NodeJS.ProcessEnv;
    readonly read?: (path: string) => Promise<string>;
  },
): Promise<boolean> => {
  try {
    const text = await (options.read ?? ((path: string) => readFile(path, 'utf8')))(
      claudeConfigPath(options.home, options.env),
    );
    return isFolderTrusted(JSON.parse(text), folder);
  } catch {
    return false;
  }
};
