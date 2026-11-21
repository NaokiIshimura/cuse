import type { ClaudeVersionCheck } from '../core/claudeVersion.js';
import type { FetchAgentsResult } from '../core/fetchAgents.js';
import type { ReadLedgerResult } from '../core/ledger.js';
import type { LeaderStartup } from './leaderStartup.js';

/**
 * main / preload / renderer で共有する IPC チャンネル名。
 * 文字列を直接書かず、ここだけを参照する。
 *
 * 承認の口は作らない（安全の約束 1）。端末で動かすのは `claude attach` だけで、相手は main が決める。
 * 止める口は台帳の配下だけに効く（安全の約束 3）。
 */
export const IPC_CHANNELS = {
  /** 起動時の環境（Claude Code のバージョン確認・上限など）の取得 */
  getEnvironment: 'environment:get',
  /** セッション一覧と台帳の取得 */
  getSnapshot: 'snapshot:get',
  /** 埋め込み端末で claude attach を始める */
  openTerminal: 'terminal:open',
  /** 端末への入力 */
  writeTerminal: 'terminal:write',
  /** 端末の大きさの変更 */
  resizeTerminal: 'terminal:resize',
  /** 端末を閉じる（attach を切るだけで、セッションは止めない） */
  closeTerminal: 'terminal:close',
  /** 端末の出力（main → renderer） */
  terminalData: 'terminal:data',
  /** 端末の終了（main → renderer） */
  terminalExit: 'terminal:exit',
  /** 人が配下を止める（台帳の配下だけ） */
  stopWorker: 'worker:stop',
  /** 指揮役をそろえ直す（起こせなかったときの「もう一度」） */
  ensureLeader: 'leader:ensure',
  /** 指揮役を起こすフォルダを人に選んでもらい、そこで起こす */
  chooseLeaderFolder: 'leader:chooseFolder',
} as const;

/** 起動時に 1 回だけ取る環境。 */
export interface GuiEnvironment {
  readonly claudeVersion: ClaudeVersionCheck;
  /** 同時に動かす配下の上限（仮の値） */
  readonly maxWorkers: number;
  readonly platform: string;
}

/** ポーリングのたびに取る一覧。 */
export interface Snapshot {
  readonly agents: FetchAgentsResult;
  readonly ledger: ReadLedgerResult;
  /** アプリを開いたときに指揮役をそろえた結果 */
  readonly leaderStartup: LeaderStartup;
  /** 取得した時刻（epoch ms） */
  readonly at: number;
}

export interface OpenTerminalRequest {
  /** renderer が決めるタブの ID */
  readonly tabId: string;
  /** 開く相手。実行するコマンドは main が決める */
  readonly sessionId: string;
  readonly cols: number;
  readonly rows: number;
}

export type OpenTerminalResult =
  | {
      readonly ok: true;
      readonly name: string;
      readonly shortId: string;
      readonly role: 'leader' | 'worker' | 'other';
    }
  | { readonly ok: false; readonly message: string };

export type StopWorkerResult = { readonly ok: true; readonly message: string } | { readonly ok: false; readonly message: string };

/** preload が `window.cuse` として公開する API。 */
export interface CuseBridge {
  readonly getEnvironment: () => Promise<GuiEnvironment>;
  readonly getSnapshot: () => Promise<Snapshot>;
  readonly openTerminal: (request: OpenTerminalRequest) => Promise<OpenTerminalResult>;
  readonly writeTerminal: (tabId: string, data: string) => void;
  readonly resizeTerminal: (tabId: string, cols: number, rows: number) => void;
  readonly closeTerminal: (tabId: string) => void;
  /** 端末の出力を購読する。購読を解除する関数を返す */
  readonly onTerminalData: (listener: (tabId: string, data: string) => void) => () => void;
  readonly onTerminalExit: (listener: (tabId: string, exitCode: number) => void) => () => void;
  readonly stopWorker: (sessionId: string, reason: string) => Promise<StopWorkerResult>;
  readonly ensureLeader: () => Promise<LeaderStartup>;
  /** フォルダを選ぶダイアログを出し、選ばれたらそこで指揮役を起こす。取り消したらいまの状態を返す */
  readonly chooseLeaderFolder: () => Promise<LeaderStartup>;
}
