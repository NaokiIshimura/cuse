// 写し元: cc-park `src/shared/sortAgents.ts` @ `d1f0f2d`（v0.25.0）
import type { Agent } from '../types/agent.js';
import { getAppearance } from './characters.js';

/**
 * 要対応のものが上に来るよう並べ替える。
 * 優先度が同じ場合は起動が新しい順にする。
 */
export const sortAgents = (agents: readonly Agent[]): Agent[] =>
  [...agents].sort((a, b) => {
    const diff = getAppearance(a.state).priority - getAppearance(b.state).priority;
    if (diff !== 0) {
      return diff;
    }
    return b.startedAt - a.startedAt;
  });
