import type { Agent } from '../types/agent.js';

/**
 * 名前で指されたセッションを探す。
 *
 * 指揮役は配下を名前で指す。取り違えると別のセッションの出力を読んでしまうので、
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

export type ResolveAgentResult =
  | { readonly ok: true; readonly agent: Agent }
  | { readonly ok: false; readonly kind: 'not-found'; readonly message: string }
  | {
      readonly ok: false;
      readonly kind: 'ambiguous';
      readonly message: string;
      readonly candidates: readonly Agent[];
    };

const describe = (agent: Agent): string =>
  `${agent.name}（${agent.id ?? agent.sessionId.slice(0, 8)}）`;

export const resolveAgent = (agents: readonly Agent[], query: string): ResolveAgentResult => {
  const needle = query.trim();
  if (needle === '') {
    return { ok: false, kind: 'not-found', message: '名前が空です。' };
  }

  const stages: ((agent: Agent) => boolean)[] = [
    (agent) => agent.name === needle,
    (agent) => agent.id === needle || agent.sessionId === needle,
    (agent) => agent.name.startsWith(needle) || agent.sessionId.startsWith(needle),
    (agent) => agent.name.includes(needle),
  ];

  for (const matches of stages) {
    const found = agents.filter(matches);
    if (found.length === 1 && found[0] !== undefined) {
      return { ok: true, agent: found[0] };
    }
    if (found.length > 1) {
      return {
        ok: false,
        kind: 'ambiguous',
        message: `「${needle}」に当てはまるセッションが複数あります: ${found.map(describe).join(', ')}。短縮 ID か完全な名前で指定してください。`,
        candidates: found,
      };
    }
  }

  return {
    ok: false,
    kind: 'not-found',
    message: `「${needle}」という名前のセッションが見つかりません。cuse agents --all で名前を確かめてください。`,
  };
};
