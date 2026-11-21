/**
 * まだ決まっていない事項の仮の値（docs/HANDOFF.md「未決事項と仮の既定値」）。
 *
 * 後から変えやすいよう、決まっていない値はすべてここに集める。
 * 値を変えたら README の該当箇所も合わせて直す。
 */

/** 同時に動かす配下の上限。第 1 段階では上端のバーに表示するだけ（仮の値）。 */
export const MAX_WORKERS = 3;

/** 指揮役のセッション名。指揮役はマシンに 1 人だけ置く。 */
export const LEADER_NAME = 'cuse-leader';

/**
 * background セッション（`claude --bg`）に対応した Claude Code の最小バージョン。
 * これより古いと配下を起動・観察できないので、分かる言葉で知らせる。
 */
export const MIN_CLAUDE_VERSION = '2.1.139';

/** `cuse output` が既定で出す `claude logs` の末尾の行数。 */
export const DEFAULT_OUTPUT_LINES = 20;

/**
 * 配下 1 つあたりの `cuse prompt` の回数の上限（仮の値）。
 * 指揮役と配下が終わらないやり取りを続けないための歯止め。
 */
export const MAX_PROMPTS_PER_WORKER = 20;

/**
 * 指揮役を起こすのに要る Claude Code のバージョン。
 * 指揮役は配下へ `SendMessage`（cross-session messaging）で指示を送るため、v2.1.224 以降が要る。
 */
export const MIN_LEADER_CLAUDE_VERSION = '2.1.224';

/** 指揮役から外すツール。作業は必ず配下に渡すため、ファイルを書けないようにする。 */
export const LEADER_DISALLOWED_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit'];

/**
 * `cuse wait` の既定の時間切れ（秒）。
 * Claude Code の Bash ツールの既定の時間切れ（2 分）より短くし、指揮役の Bash が先に切れないようにする。
 */
export const DEFAULT_WAIT_TIMEOUT_SEC = 110;

/** `cuse wait` が一覧を取り直す間隔。 */
export const WAIT_INTERVAL_MS = 3000;
