import type { Outcome } from '../commands/outcome.js';
import type { StartAction, StartResult } from '../commands/start.js';

/**
 * アプリを開いたときに指揮役をそろえる。
 *
 * `cuse start` を打たなくても、ウィンドウを開けば指揮役がいるようにする。
 * 中身は `cuse start` と同じ（`runStart`）で、指揮役がいなければ起こし、止まっていれば再開し、
 * 動いていれば何もしない。指揮役はマシンに 1 人という約束はそのまま守られる。
 *
 * 新しく起こすときは置き場所（作業ディレクトリ）が要る。Claude Code はホームフォルダや
 * 信頼していないフォルダでは background セッションを起こさないので、決まっていなければ人に選んでもらう。
 */

export type LeaderStartup =
  /** 起こしている・確かめている途中 */
  | { readonly kind: 'starting' }
  /** 指揮役がいなくて、起こすフォルダが決まっていない。人に選んでもらう */
  | { readonly kind: 'needs-folder' }
  | { readonly kind: 'ready'; readonly action: StartAction; readonly warnings: readonly string[] }
  | {
      readonly kind: 'failed';
      readonly message: string;
      /** フォルダを Claude Code が信頼していないために起こせなかった（別のフォルダを選べば済む） */
      readonly untrusted: boolean;
    };

export const STARTING: LeaderStartup = { kind: 'starting' };

/**
 * アプリを開いたディレクトリが、指揮役の置き場所に使えるか。使えなければ null。
 *
 * Finder や Dock から `.app` を開くと作業ディレクトリは `/` になる。ホームフォルダは Claude Code が
 * 「1 度に 1 セッションだけ」しか信頼しないので、指揮役を常駐させる場所には使えない。
 * `cuse app` を作業するリポジトリで実行したときは、そのディレクトリを使う。
 */
export const startupCwd = (cwd: string, home: string): string | null =>
  cwd === '' || cwd === '/' || cwd === home ? null : cwd;

export const toLeaderStartup = (outcome: Outcome<StartResult>): LeaderStartup =>
  outcome.ok
    ? { kind: 'ready', action: outcome.value.action, warnings: outcome.warnings }
    : {
        kind: 'failed',
        message: outcome.error.message,
        untrusted: outcome.error.kind === 'untrusted',
      };

export interface LeaderStartupOptions {
  /** 指揮役をそろえる（`runStart`）。cwd は新しく起こすときの置き場所 */
  readonly start: (cwd: string | undefined) => Promise<Outcome<StartResult>>;
  /** 台帳に指揮役がいるか。いれば置き場所は台帳の記録を使う（再開・開くだけ） */
  readonly hasLeader: () => Promise<boolean>;
  /** アプリを開いたディレクトリ（{@link startupCwd} 済み） */
  readonly initialCwd: string | null;
  readonly onChange?: (status: LeaderStartup) => void;
}

/**
 * 指揮役をそろえる処理。重ねて走らせない。
 *
 * 起動中にもう一度頼まれても（「もう一度」ボタンの連打など）、走っているものの結果を返す。
 * 同時に 2 回走ると、指揮役が 2 人起きるおそれがあるため。
 */
export const createLeaderStartup = (options: LeaderStartupOptions) => {
  let status: LeaderStartup = STARTING;
  let running: Promise<LeaderStartup> | null = null;
  let cwd = options.initialCwd;

  const set = (next: LeaderStartup): LeaderStartup => {
    status = next;
    options.onChange?.(next);
    return next;
  };

  const run = async (): Promise<LeaderStartup> => {
    if (cwd === null && !(await options.hasLeader())) {
      return { kind: 'needs-folder' };
    }
    return toLeaderStartup(await options.start(cwd ?? undefined));
  };

  return {
    status: (): LeaderStartup => status,
    /**
     * 指揮役をそろえる。`folder` を渡すと、新しく起こすときの置き場所をそのフォルダにする
     * （人がフォルダを選んだとき）。
     */
    ensure: (folder?: string): Promise<LeaderStartup> => {
      if (running !== null) {
        return running;
      }
      if (folder !== undefined) {
        cwd = folder;
      }
      set(STARTING);
      running = run()
        .catch(
          (error: unknown): LeaderStartup => ({
            kind: 'failed',
            message: `指揮役を起こせませんでした: ${String(error)}`,
            untrusted: false,
          }),
        )
        .then((next) => {
          running = null;
          return set(next);
        });
      return running;
    },
  };
};
