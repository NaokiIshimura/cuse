import type { CharacterState } from '../types/agent.js';

/**
 * 人の対応が要るかどうか。
 *
 * - `approval`: 権限プロンプトの承認待ち。人が `claude attach` か agent view で承認する
 * - `input`: 次の指示待ち（作業が一区切りした）
 *
 * cuse は承認を代わりにしない（安全の約束 1）。ここでは「人に回すもの」を見分けるだけ。
 */
export type WaitingFor = 'approval' | 'input';

export const waitingForOf = (state: CharacterState): WaitingFor | null => {
  if (state === 'blocked') {
    return 'approval';
  }
  if (state === 'waiting' || state === 'justFinished') {
    return 'input';
  }
  return null;
};

/** 表示用の言葉。 */
export const WAITING_FOR_LABELS: Readonly<Record<WaitingFor, string>> = {
  approval: '承認待ち',
  input: '入力待ち',
};
