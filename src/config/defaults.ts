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
