import type { ClaudeVersionCheck } from '../core/claudeVersion.js';
import type { FetchAgentsResult } from '../core/fetchAgents.js';
import type { ReadLedgerResult } from '../core/ledger.js';
import type { PreviewContent } from '../core/previewContent.js';
import type { PreviewItem } from '../shared/previewItems.js';
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
  /** 指揮役の居場所を信頼してもらうため、そのフォルダで claude を動かす（初回だけ） */
  openTrustTerminal: 'terminal:openTrust',
  /** 人が終わった配下を片付ける（台帳の配下だけ。未 commit / 未 push は残す） */
  cleanWorkers: 'workers:clean',
  /** 通知を押したときに、そのセッションを開いてもらう（main → renderer） */
  openSession: 'session:open',
  /** セッションに出てきたファイル・URL の一覧 */
  getPreviewItems: 'preview:items',
  /** プレビューの中身を読む（セッションに出てきたものだけ） */
  readPreview: 'preview:read',
  /** セッションに出てきた URL を普段のブラウザで開く */
  openExternalUrl: 'preview:openExternal',
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

export interface OpenTrustTerminalRequest {
  readonly tabId: string;
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

/** プレビューの中身。ファイルなら PreviewContent、URL なら隔離したブラウザ表示で開く URL。 */
export type PreviewResult =
  | PreviewContent
  | { readonly kind: 'url'; readonly url: string };

export type CleanWorkersResult =
  | { readonly ok: true; readonly message: string; readonly cleaned: number }
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
  /**
   * 指揮役を起こせなかった理由が「フォルダを信頼していない」とき、そのフォルダで claude を動かす。
   * どのフォルダかは main が決める（renderer からフォルダは渡さない）
   */
  readonly cleanWorkers: () => Promise<CleanWorkersResult>;
  /** セッションに出てきたファイル・URL（新しい順） */
  readonly getPreviewItems: (sessionId: string) => Promise<readonly PreviewItem[]>;
  /**
   * プレビューの中身を読む。`key` は previewKey。main がそのセッションに出てきたものかを確かめ、
   * そうでなければ読まない。`reveal` は `.env` などの中身を見ると人が決めたとき
   */
  readonly readPreview: (sessionId: string, key: string, reveal: boolean) => Promise<PreviewResult>;
  /** セッションに出てきた URL を普段のブラウザで開く。出てきていない URL は開かない */
  readonly openExternalUrl: (sessionId: string, url: string) => Promise<boolean>;
  /** 通知を押したときに開くセッションを受け取る。購読を解除する関数を返す */
  readonly onOpenSession: (listener: (sessionId: string) => void) => () => void;
  readonly openTrustTerminal: (
    request: OpenTrustTerminalRequest,
  ) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
}
