import type { CharacterState } from '../types/agent.js';
import type { SendToLeaderResult } from './ipc.js';

/**
 * 会話の画面から指揮役に送る（main で使う）。
 *
 * 送り方は、指揮役の端末（`claude attach`）へ「貼り付け」として書き込み、少し待って Enter を送るだけ。
 * 貼り付け（bracketed paste）にするのは、文の中の改行で途中まで送られてしまわないようにするため。
 *
 * 安全のため、指揮役が依頼を待っているときだけ送る。
 * - 承認待ち（blocked）のときに Enter を送ると、権限の確認に「はい」と答えてしまう（安全の約束 1）
 * - 作業中（working）は、送るまでの間に権限の確認が出ることがあるので、同じ理由で送らない
 * どちらのときも、人は「端末」に切り替えて Claude Code の画面で答える。
 */

/** 送ってよい指揮役の状態（依頼を待っている）。 */
const READY_STATES: ReadonlySet<CharacterState> = new Set(['waiting', 'done', 'justFinished']);

/** 送れる文の長さの上限（貼り付けとして送るので大きすぎるものは断る）。 */
export const MAX_MESSAGE_LENGTH = 20_000;

/** Enter を送るまでの間（貼り付けが取り込まれるのを待つ）。 */
const ENTER_DELAY_MS = 80;

export interface LeaderInputState {
  /** 台帳の指揮役の短縮 ID と、いまの状態。いなければ null */
  readonly leader: { readonly shortId: string; readonly state: CharacterState | null } | null;
  /** 指揮役のタブで attach している相手の短縮 ID。つないでいなければ null */
  readonly attachedShortId: string | null;
}

export interface LeaderInputDeps {
  readonly readState: () => Promise<LeaderInputState>;
  readonly write: (data: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}

export const sendToLeader = async (text: unknown, deps: LeaderInputDeps): Promise<SendToLeaderResult> => {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, reason: 'invalid', message: '送る文を書いてください。' };
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, reason: 'invalid', message: `長すぎるので送れません（${MAX_MESSAGE_LENGTH} 文字まで）。` };
  }
  const { leader, attachedShortId } = await deps.readState();
  if (leader === null) {
    return { ok: false, reason: 'unavailable', message: '指揮役がいません。' };
  }
  if (attachedShortId !== leader.shortId) {
    return { ok: false, reason: 'unavailable', message: '指揮役の端末がつながっていません。「端末」でつなぎ直してください。' };
  }
  if (leader.state === 'blocked') {
    return {
      ok: false,
      reason: 'blocked',
      message: '指揮役が承認を待っています。「端末」に切り替えて、Claude Code の画面で答えてください（承認待ちの間は会話から送りません）。',
    };
  }
  if (leader.state === null || !READY_STATES.has(leader.state)) {
    return {
      ok: false,
      reason: 'busy',
      message: '指揮役が作業中です。手が空いてから送ってください（急ぎなら「端末」から送れます）。',
    };
  }
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // 改行は端末の Enter（\r）にそろえ、貼り付けとして送る
  deps.write(`\x1b[200~${text.replace(/\r?\n/g, '\r')}\x1b[201~`);
  await sleep(ENTER_DELAY_MS);
  deps.write('\r');
  return { ok: true };
};
