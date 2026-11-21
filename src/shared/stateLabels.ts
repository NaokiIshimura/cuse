import type { CharacterState } from '../types/agent.js';

/**
 * ウィンドウのカードに出す状態の言葉。
 *
 * AA の色と動きは cc-park の `characters.ts` のまま使い、言葉だけを日本語にする
 * （cuse の画面は日本語で作るため）。`cuse agents` の表は cc-park と同じ英語のラベル。
 */
export const STATE_LABELS_JA: Readonly<Record<CharacterState, string>> = {
  blocked: '承認待ち',
  justFinished: '完了直後',
  working: '作業中',
  waiting: '入力待ち',
  done: '完了',
  stopped: '停止',
  unknown: '不明',
};
