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
