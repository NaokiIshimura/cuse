import { join } from 'node:path';

/**
 * cuse が自分のファイルを置く場所。
 *
 * 台帳・デバッグ記録など、cuse が持つファイルはすべて `~/.cuse/` の下にまとめる。
 * cc-park（`~/.cc-park/`）とは置き場所を分け、互いのファイルに依存しない。
 */
export const STORE_DIRECTORY = '.cuse';

/** 台帳のファイル名。cc-park など他のツールもこの名前で読む。 */
export const LEDGER_FILE = 'ledger.json';

/** 台帳の置き場所（`~/.cuse/ledger.json`）。 */
export const buildLedgerPath = (home: string): string => join(home, STORE_DIRECTORY, LEDGER_FILE);

/**
 * 指揮役の居場所（`~/.cuse/leader`）。
 *
 * アプリを Finder から開いたときなど、置き場所が決まっていないときに指揮役を起こす場所。
 * ホームフォルダは Claude Code が「1 度に 1 セッションだけ」しか信頼しないので使えず、
 * cuse 専用の空のフォルダを置く。初回だけ、人が Claude Code でこのフォルダを信頼する。
 * 指揮役は作業しないので、リポジトリでなくてよい（配下は spawn --cwd でリポジトリに回す）。
 */
export const LEADER_HOME_DIRECTORY = 'leader';

export const buildLeaderHome = (home: string): string =>
  join(home, STORE_DIRECTORY, LEADER_HOME_DIRECTORY);

/** cuse のファイル置き場（`~/.cuse`）の中か。配下をここで起こさないために使う。 */
export const isInsideStore = (path: string, home: string): boolean => {
  const store = join(home, STORE_DIRECTORY);
  return path === store || path.startsWith(`${store}/`);
};
