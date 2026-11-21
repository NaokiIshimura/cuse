import type { Outcome } from '../commands/outcome.js';
import type { StartAction, StartResult } from '../commands/start.js';

/**
 * アプリを開いたときに指揮役をそろえる。
 *
 * `cuse start` を打たなくても、ウィンドウを開けば指揮役がいるようにする。
 * 中身は `cuse start` と同じ（`runStart`）で、指揮役がいなければ起こし、止まっていれば再開し、
 * 動いていれば何もしない。指揮役はマシンに 1 人という約束はそのまま守られる。
 */

export type LeaderStartup =
  /** 起こしている・確かめている途中 */
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready'; readonly action: StartAction; readonly warnings: readonly string[] }
  | { readonly kind: 'failed'; readonly message: string };

export const STARTING: LeaderStartup = { kind: 'starting' };

/**
 * 指揮役を起こす作業ディレクトリ。
 *
 * Finder や Dock から `.app` を開くと作業ディレクトリが `/` になるので、そのときはホームにする
 * （指揮役は配下を `spawn --cwd` でどのリポジトリにも回せるので、起点はどこでもよい）。
 * `cuse app` を端末から実行したときは、そのディレクトリを使う。
 */
export const startupCwd = (cwd: string, home: string): string =>
  cwd === '' || cwd === '/' ? home : cwd;

export const toLeaderStartup = (outcome: Outcome<StartResult>): LeaderStartup =>
  outcome.ok
    ? { kind: 'ready', action: outcome.value.action, warnings: outcome.warnings }
    : { kind: 'failed', message: outcome.error.message };

/**
 * 指揮役をそろえる処理を、重ねて走らせないようにする。
 *
 * 起動中にもう一度頼まれても（「もう一度」ボタンの連打など）、走っているものの結果を返す。
 * 同時に 2 回走ると、指揮役が 2 人起きるおそれがあるため。
 */
export const createLeaderStartup = (
  start: () => Promise<Outcome<StartResult>>,
  onChange: (status: LeaderStartup) => void = () => undefined,
) => {
  let status: LeaderStartup = STARTING;
  let running: Promise<LeaderStartup> | null = null;

  const set = (next: LeaderStartup): LeaderStartup => {
    status = next;
    onChange(next);
    return next;
  };

  return {
    status: (): LeaderStartup => status,
    ensure: (): Promise<LeaderStartup> => {
      if (running !== null) {
        return running;
      }
      set(STARTING);
      running = start()
        .then(toLeaderStartup, (error: unknown) => ({
          kind: 'failed' as const,
          message: `指揮役を起こせませんでした: ${String(error)}`,
        }))
        .then((next) => {
          running = null;
          return set(next);
        });
      return running;
    },
  };
};
