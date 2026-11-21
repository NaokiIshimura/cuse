/**
 * 埋め込み端末（node-pty）の管理。main プロセスで使う。
 *
 * タブ 1 つにつき `claude attach <短縮 ID>` を 1 つ動かす。閉じるときは attach を切るだけで、
 * 指揮役や配下のセッションは止めない（attach は表示と入力のつなぎ役でしかない）。
 * node-pty は差し替えられるようにして、テストではネイティブモジュールを使わない。
 */

export interface Pty {
  readonly onData: (listener: (data: string) => void) => void;
  readonly onExit: (listener: (event: { readonly exitCode: number }) => void) => void;
  readonly write: (data: string) => void;
  readonly resize: (cols: number, rows: number) => void;
  readonly kill: () => void;
}

export type SpawnPty = (
  file: string,
  args: readonly string[],
  options: { readonly cols: number; readonly rows: number; readonly cwd: string; readonly env: NodeJS.ProcessEnv },
) => Pty;

export interface TerminalManagerOptions {
  readonly spawnPty: SpawnPty;
  readonly cwd: string;
  readonly env: () => NodeJS.ProcessEnv;
  readonly onData: (tabId: string, data: string) => void;
  readonly onExit: (tabId: string, exitCode: number) => void;
  /** 実行するコマンド（既定: claude） */
  readonly command?: string;
}

/** 端末の大きさとして使える値に丸める。renderer から来た値なので、おかしな値は既定に倒す。 */
export const clampSize = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 1000 ? value : fallback;

export interface TerminalManager {
  readonly open: (tabId: string, shortId: string, cols: number, rows: number) => void;
  readonly write: (tabId: string, data: string) => void;
  readonly resize: (tabId: string, cols: number, rows: number) => void;
  readonly close: (tabId: string) => void;
  readonly closeAll: () => void;
  readonly has: (tabId: string) => boolean;
}

export const createTerminalManager = (options: TerminalManagerOptions): TerminalManager => {
  const ptys = new Map<string, Pty>();

  const close = (tabId: string): void => {
    const pty = ptys.get(tabId);
    if (pty === undefined) {
      return;
    }
    ptys.delete(tabId);
    pty.kill();
  };

  return {
    open: (tabId, shortId, cols, rows) => {
      // 開き直すときは前の attach を切ってからつなぐ
      close(tabId);
      const pty = options.spawnPty(options.command ?? 'claude', ['attach', shortId], {
        cols: clampSize(cols, 80),
        rows: clampSize(rows, 24),
        cwd: options.cwd,
        env: options.env(),
      });
      ptys.set(tabId, pty);
      pty.onData((data) => {
        if (ptys.get(tabId) === pty) {
          options.onData(tabId, data);
        }
      });
      pty.onExit(({ exitCode }) => {
        if (ptys.get(tabId) === pty) {
          ptys.delete(tabId);
          options.onExit(tabId, exitCode);
        }
      });
    },
    write: (tabId, data) => {
      if (typeof data === 'string') {
        ptys.get(tabId)?.write(data);
      }
    },
    resize: (tabId, cols, rows) => {
      ptys.get(tabId)?.resize(clampSize(cols, 80), clampSize(rows, 24));
    },
    close,
    closeAll: () => {
      for (const tabId of [...ptys.keys()]) {
        close(tabId);
      }
    },
    has: (tabId) => ptys.has(tabId),
  };
};
