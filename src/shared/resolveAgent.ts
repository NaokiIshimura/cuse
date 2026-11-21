import type { LedgerWorker } from '../core/ledger.js';
import type { Agent } from '../types/agent.js';

/**
 * 名前で指されたものを探す。
 *
 * 指揮役は配下を名前で指す。取り違えると別のセッションを読んだり止めたりしてしまうので、
 * 1 つに決まらないときは推測せず、候補を並べてエラーにする。
 *
 * 探す順:
 * 1. 名前の完全一致
 * 2. 短縮 ID・sessionId の完全一致
 * 3. 名前・sessionId の前方一致
 * 4. 名前の部分一致
 *
 * 前の段で 1 つでも見つかれば、後の段は見ない（`tests` と `tests-e2e` があるとき、
 * `tests` は完全一致の方に決まる）。
 */

export type ResolveResult<T> =
  | { readonly ok: true; readonly item: T }
  | { readonly ok: false; readonly kind: 'not-found'; readonly message: string }
  | {
      readonly ok: false;
      readonly kind: 'ambiguous';
      readonly message: string;
      readonly candidates: readonly T[];
    };

interface Named {
  readonly name: string;
  readonly shortId: string | undefined;
  readonly sessionId: string;
}

export const resolveNamed = <T>(
  items: readonly T[],
  query: string,
  keys: (item: T) => Named,
  notFoundHint: string,
): ResolveResult<T> => {
  const needle = query.trim();
  if (needle === '') {
    return { ok: false, kind: 'not-found', message: '名前が空です。' };
  }

  const stages: ((named: Named) => boolean)[] = [
    (named) => named.name === needle,
    (named) => named.shortId === needle || named.sessionId === needle,
    (named) => named.name.startsWith(needle) || named.sessionId.startsWith(needle),
    (named) => named.name.includes(needle),
  ];

  for (const matches of stages) {
    const found = items.filter((item) => matches(keys(item)));
    if (found.length === 1 && found[0] !== undefined) {
      return { ok: true, item: found[0] };
    }
    if (found.length > 1) {
      const describe = (item: T): string => {
        const named = keys(item);
        return `${named.name}（${named.shortId ?? named.sessionId.slice(0, 8)}）`;
      };
      return {
        ok: false,
        kind: 'ambiguous',
        message: `「${needle}」に当てはまるものが複数あります: ${found.map(describe).join(', ')}。短縮 ID か完全な名前で指定してください。`,
        candidates: found,
      };
    }
  }

  return { ok: false, kind: 'not-found', message: `「${needle}」が見つかりません。${notFoundHint}` };
};

export type ResolveAgentResult =
  | { readonly ok: true; readonly agent: Agent }
  | { readonly ok: false; readonly kind: 'not-found'; readonly message: string }
  | {
      readonly ok: false;
      readonly kind: 'ambiguous';
      readonly message: string;
      readonly candidates: readonly Agent[];
    };

/** セッションを名前で探す。 */
export const resolveAgent = (agents: readonly Agent[], query: string): ResolveAgentResult => {
  const result = resolveNamed(
    agents,
    query,
    (agent) => ({ name: agent.name, shortId: agent.id, sessionId: agent.sessionId }),
    'cuse agents --all で名前を確かめてください。',
  );
  return result.ok ? { ok: true, agent: result.item } : result;
};

/** 台帳の配下を名前で探す。台帳に無いセッションは対象にしない（安全の約束 3）。 */
export const resolveWorker = (
  workers: readonly LedgerWorker[],
  query: string,
): ResolveResult<LedgerWorker> =>
  resolveNamed(
    workers,
    query,
    (worker) => ({
      name: worker.name,
      shortId: worker.shortId ?? undefined,
      sessionId: worker.sessionId,
    }),
    '台帳（~/.cuse/ledger.json）に載った配下だけを指せます。cuse agents で名前を確かめてください。',
  );
