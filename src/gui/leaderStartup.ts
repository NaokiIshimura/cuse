import type { Outcome } from '../commands/outcome.js';
import type { StartAction, StartResult } from '../commands/start.js';

/**
 * アプリを開いたときに指揮役をそろえる。
 *
 * `cuse start` を打たなくても、ウィンドウを開けば指揮役がいるようにする。
 * 中身は `cuse start` と同じ（`runStart`）で、指揮役がいなければ起こし、止まっていれば再開し、
 * 動いていれば何もしない。指揮役はマシンに 1 人という約束はそのまま守られる。
 *
 * 置き場所は `runStart` が決める。Finder から開いたとき（`/`）やホームなら、指揮役の居場所
 * `~/.cuse/leader` で起こす。初回はそのフォルダを Claude Code が信頼していないので、
 * ウィンドウで人に信頼してもらう（`untrusted`）。
 */

export type LeaderStartup =
  /** 起こしている・確かめている途中 */
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready'; readonly action: StartAction; readonly warnings: readonly string[] }
  | {
      readonly kind: 'failed';
      readonly message: string;
      /**
       * Claude Code がまだ信頼していないフォルダ。null でなければ、そのフォルダで claude を動かして
       * 人に信頼してもらえば起こせる
       */
      readonly untrustedFolder: string | null;
    };

export const STARTING: LeaderStartup = { kind: 'starting' };

export const toLeaderStartup = (outcome: Outcome<StartResult>): LeaderStartup =>
  outcome.ok
    ? { kind: 'ready', action: outcome.value.action, warnings: outcome.warnings }
    : {
        kind: 'failed',
        message: outcome.error.message,
        untrustedFolder:
          outcome.error.kind === 'untrusted' ? (outcome.error.folder ?? null) : null,
      };

/**
 * 指揮役をそろえる処理。重ねて走らせない。
 *
 * 起動中にもう一度頼まれても（ボタンの連打など）、走っているものの結果を返す。
 * 同時に 2 回走ると、指揮役が 2 人起きるおそれがあるため。
 */
export const createLeaderStartup = (
  start: (cwd: string | undefined) => Promise<Outcome<StartResult>>,
  onChange: (status: LeaderStartup) => void = () => undefined,
) => {
  let status: LeaderStartup = STARTING;
  let running: Promise<LeaderStartup> | null = null;
  let cwd: string | undefined;

  const set = (next: LeaderStartup): LeaderStartup => {
    status = next;
    onChange(next);
    return next;
  };

  return {
    status: (): LeaderStartup => status,
    /**
     * 指揮役をそろえる。`folder` を渡すと、新しく起こすときの置き場所をそのフォルダにする
     * （人がフォルダを選んだとき）。以後もそのフォルダを使う。
     */
    ensure: (folder?: string): Promise<LeaderStartup> => {
      if (running !== null) {
        return running;
      }
      if (folder !== undefined) {
        cwd = folder;
      }
      set(STARTING);
      running = start(cwd)
        .then(toLeaderStartup, (error: unknown) => ({
          kind: 'failed' as const,
          message: `指揮役を起こせませんでした: ${String(error)}`,
          untrustedFolder: null,
        }))
        .then((next) => {
          running = null;
          return set(next);
        });
      return running;
    },
  };
};

/**
 * 初回の信頼を待つ間に呼ぶ 1 回ぶんの確かめ。
 *
 * 「信頼していない」で止まっていて、そのフォルダを Claude Code が信頼したと読めたら、
 * 人がボタンを押さなくても指揮役を起こす。読めなければ何もしない（ボタンで起こせる）。
 * 起こしたら true。
 */
export const startWhenTrusted = async (
  startup: { readonly status: () => LeaderStartup; readonly ensure: () => Promise<LeaderStartup> },
  isTrusted: (folder: string) => Promise<boolean>,
): Promise<boolean> => {
  const status = startup.status();
  if (status.kind !== 'failed' || status.untrustedFolder === null) {
    return false;
  }
  if (!(await isTrusted(status.untrustedFolder))) {
    return false;
  }
  // 読んでいる間に状態が変わっていたら（人がボタンを押したなど）、重ねて起こさない
  if (startup.status() !== status) {
    return false;
  }
  await startup.ensure();
  return true;
};
