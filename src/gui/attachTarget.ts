import type { Ledger } from '../core/ledger.js';
import type { Agent } from '../types/agent.js';

/**
 * 埋め込み端末で `claude attach` する相手を決める。
 *
 * renderer から来るのは sessionId だけで、実行するコマンドは main がここで決める
 * （renderer から任意のコマンドを走らせない）。開けるのは background セッションだけ
 * （`claude attach` は background セッションにしか使えない）。
 */

export type AttachRole = 'leader' | 'worker' | 'other';

export type AttachTarget =
  | { readonly ok: true; readonly shortId: string; readonly name: string; readonly role: AttachRole }
  | { readonly ok: false; readonly message: string };

export const resolveAttachTarget = (
  sessionId: string,
  ledger: Ledger | null,
  agents: readonly Agent[],
): AttachTarget => {
  const agent = agents.find((candidate) => candidate.sessionId === sessionId);
  const leader = ledger?.leader;
  const worker = ledger?.workers.find((candidate) => candidate.sessionId === sessionId);
  const role: AttachRole =
    leader?.sessionId === sessionId ? 'leader' : worker !== undefined ? 'worker' : 'other';

  // 一覧の短縮 ID を正とする（再開で変わることがあるため）。一覧に無ければ台帳の記録を使う
  const shortId =
    agent?.id ??
    (role === 'leader' ? (leader?.shortId ?? undefined) : (worker?.shortId ?? undefined));
  const name = agent?.name ?? (role === 'leader' ? leader?.name : worker?.name) ?? sessionId.slice(0, 8);

  if (agent !== undefined && agent.kind !== 'background') {
    return {
      ok: false,
      message: `${name} は background セッションではないので、ここでは開けません。起動した端末で操作してください。`,
    };
  }
  if (shortId === undefined || !/^[0-9A-Za-z_-]+$/.test(shortId)) {
    return { ok: false, message: `${name} の短縮 ID が分からないため開けません。` };
  }
  return { ok: true, shortId, name, role };
};
