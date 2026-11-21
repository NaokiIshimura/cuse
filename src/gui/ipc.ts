import type { ClaudeVersionCheck } from '../core/claudeVersion.js';
import type { FetchAgentsResult } from '../core/fetchAgents.js';
import type { ReadLedgerResult } from '../core/ledger.js';

/**
 * main / preload / renderer で共有する IPC チャンネル名。
 * 文字列を直接書かず、ここだけを参照する。
 *
 * 第 1 段階のウィンドウは読み取り専用なので、ここに並ぶのは読み取りの口だけ。
 * セッションを起動・停止・承認する口は作らない（承認の口は第 2 段階以降も作らない）。
 */
export const IPC_CHANNELS = {
  /** 起動時の環境（Claude Code のバージョン確認・上限など）の取得 */
  getEnvironment: 'environment:get',
  /** セッション一覧と台帳の取得 */
  getSnapshot: 'snapshot:get',
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
  /** 取得した時刻（epoch ms） */
  readonly at: number;
}

/** preload が `window.cuse` として公開する API。 */
export interface CuseBridge {
  readonly getEnvironment: () => Promise<GuiEnvironment>;
  readonly getSnapshot: () => Promise<Snapshot>;
}
