// 写し元: cc-park `src/shared/characters.ts` @ `d1f0f2d`（v0.25.0）
import type { CharacterState } from '../types/agent.js';

/**
 * キャラクターの見た目定義。GUI の renderer とメニューバーのアイコンが参照する UI 非依存の共有資産。
 *
 * Claude Code の起動バナーと同じブロックアートを使う。
 * レイアウトを揺らさないため、全フレームは 3 行・表示幅 9 桁に揃えている。
 * 使用する Block Elements（U+2580-U+259F）は Menlo / SF Mono の双方に収録されており、
 * 字送り幅が ASCII と同じであることを `cmap` / `hmtx` の実測で確認済み。
 */
export const CHARACTER_HEIGHT = 3;
export const CHARACTER_WIDTH = 9;

/** 頭の行の中央（桁 1-7）。両端の桁 0 / 8 には手が入る。 */
const HEAD = '▐▛███▛█';

/** 身体の行（桁 0-8）。全フレーム共通。 */
export const BODY = '▝▜██████▀';

/** 足の行（桁 0-8）。起動バナーと同じ形で、状態によらず静止させる。 */
export const LEGS = '  ▝▝ ▝▝  ';

/*
 * 歩くときの足。足は桁 2 / 3（右足）と桁 5 / 6（左足）に 2 本ずつある。
 * 左右はキャラクター自身から見た向きで、手と同じく正面を向いているため入れ替わる。
 *
 * 踏み出す向きは常に左手側（桁 8 の方向）。半セルぶん右へずらすので、
 * 「開く」は外側の足が隣の桁へ出て `▘` になり、
 * 「閉じる」は内側の足が寄ってペアが 1 つの `▀` に繋がる。
 */
const LEGS_RIGHT_OPEN = '  ▝ ▘▝▝  ';
const LEGS_RIGHT_CLOSED = '   ▀ ▝▝  ';
const LEGS_LEFT_OPEN = '  ▝▝ ▝ ▘ ';
const LEGS_LEFT_CLOSED = '  ▝▝  ▀  ';

/** 未知の状態は足を不揃いにする。 */
const UNEVEN_LEGS = '  ▘▝ ▝▘  ';

/**
 * 上げた手。左右とも身体の端（桁 0 の `▝` と桁 8 の `▀`）の真上に乗るよう、
 * セルの右下を使う。
 *
 * 左右で鏡像にはできない。桁 0 の身体は右半分しか無いので手も右半分に置く必要があり、
 * 桁 8 を左半分（`▖` `▌`）にすると隣の `█` と横に隣接して頭とくっついてしまう。
 */
const RAISED = '▗';
const LOWERED = ' ';

/**
 * 手のポーズ。
 *
 * 左右はキャラクター自身から見た向き。正面を向いているため、
 * 桁 0（向かって左）が右手、桁 8（向かって右）が左手になる。
 */
type Pose = 'down' | 'rightHand' | 'leftHand' | 'both';

/** ポーズと足の形から 1 フレームを組み立てる。 */
const frame = (pose: Pose, legs: string = LEGS): string => {
  const rightHand = pose === 'rightHand' || pose === 'both' ? RAISED : LOWERED;
  const leftHand = pose === 'leftHand' || pose === 'both' ? RAISED : LOWERED;
  return `${rightHand}${HEAD}${leftHand}\n${BODY}\n${legs}`;
};

export interface CharacterAppearance {
  /** アニメーションフレーム（各要素は改行区切りの 3 行） */
  readonly frames: readonly string[];
  /** 色名（`cyan` など。renderer の colors.ts で CSS 変数へ対応付ける） */
  readonly color: string;
  /** 一覧に出すステータスラベル */
  readonly label: string;
  /** 状態の説明文 */
  readonly description: string;
  /** ソート優先度（小さいほど上に出る） */
  readonly priority: number;
}

/*
 * 動くのは「作業中」と「こちらの操作待ち」だけ。
 * 動いている行だけを見れば済むよう、それ以外は 1 フレームで静止させる。
 *
 * 動かす部位で役割を分けている。
 * こちらの操作を待つ `blocked` / `justFinished` は手、作業中の `working` は足。
 */
export const CHARACTERS: Readonly<Record<CharacterState, CharacterAppearance>> = {
  blocked: {
    // 右手を上げ下げして呼ぶ
    frames: [frame('rightHand'), frame('down')],
    color: 'yellow',
    label: 'BLOCKED',
    description: 'needs your approval',
    priority: 0,
  },
  justFinished: {
    // 両手を上げ下げして喜ぶ
    frames: [frame('down'), frame('both')],
    color: 'greenBright',
    label: 'DONE!',
    description: 'just finished - your turn',
    priority: 1,
  },
  working: {
    // 手は下ろしたまま、右足 → 左足 の順に左手側へ閉じて開き、毎回標準へ戻って歩く
    frames: [
      frame('down', LEGS_RIGHT_CLOSED),
      frame('down', LEGS_RIGHT_OPEN),
      frame('down'),
      frame('down', LEGS_LEFT_CLOSED),
      frame('down', LEGS_LEFT_OPEN),
      frame('down'),
    ],
    color: 'cyan',
    label: 'BUSY',
    description: 'working...',
    priority: 2,
  },
  waiting: {
    frames: [frame('down')],
    color: 'gray',
    label: 'IDLE',
    description: 'waiting for input',
    priority: 3,
  },
  done: {
    frames: [frame('down')],
    color: 'green',
    label: 'DONE',
    description: 'completed',
    priority: 4,
  },
  stopped: {
    frames: [frame('down')],
    color: 'gray',
    label: 'STOPPED',
    description: 'stopped',
    priority: 5,
  },
  unknown: {
    frames: [frame('down', UNEVEN_LEGS)],
    color: 'red',
    label: 'UNKNOWN',
    description: 'unknown state',
    priority: 6,
  },
};

/*
 * ミニキャラクター。実行中のサブエージェント 1 体を表す。
 *
 * 親の AA の下へ 1 行だけ並べるので、1 行 x 2 桁に収める。
 * 上半分が身体、下半分が足で、親と同じ「開く / 閉じる」で歩かせる。
 * 動く部位を足に揃えることで、動いている = 作業中、という役割分担を崩さない。
 */

/** ミニキャラクター 1 体の桁数。 */
export const MINI_WIDTH = 2;

/** 足を開いた形（外向きに 1 本ずつ）と、閉じた形（中央で 1 本に繋がる）。 */
const MINI_FRAMES: readonly string[] = ['▛▜', '▜▛'];

/** フレーム番号からミニキャラクター 1 体を取り出す。負の番号でも循環させる。 */
export const getMiniFrame = (frame: number): string => {
  const index = ((frame % MINI_FRAMES.length) + MINI_FRAMES.length) % MINI_FRAMES.length;
  return MINI_FRAMES[index] ?? '';
};

/*
 * 指揮役（cuse-leader）の AA。cuse だけのもの（cc-park には無い）。
 *
 * 配下と同じ Clawd の右側（桁 9）に 1 桁足し、指揮棒を持たせる。
 * - ふだんは左手（桁 8）を上げ、手の右下から右上へ伸びる棒 `▞`（左下と右上の象限）を頭の行に置く
 * - 作業中に振り下ろすときだけ手を下ろし、身体の端から右下へ伸びる棒 `▚`（左上と右下の象限）を身体の行に置く
 * どちらも手・身体の端と象限が隣り合い、棒が離れて見えない。
 * 作業中は、歩く代わりに指揮棒を振る（上げる → 下ろす）。
 */

/** 指揮役の AA の桁数（配下より指揮棒の 1 桁ぶん広い）。 */
export const LEADER_WIDTH = CHARACTER_WIDTH + 1;

const BATON_UP = '▞';
const BATON_DOWN = '▚';

/**
 * 配下の 1 フレームに指揮棒を足す。
 * 指揮役はふだん左手（桁 8）と指揮棒を上げておく（`raise`）。下ろすのは、作業中に振り下ろすときだけ。
 */
const withBaton = (base: string, raise: boolean): string => {
  const [head = '', body = '', legs = ''] = base.split('\n');
  const cells = [...head];
  cells[CHARACTER_WIDTH - 1] = raise ? RAISED : cells[CHARACTER_WIDTH - 1] ?? LOWERED;
  const raised = cells[CHARACTER_WIDTH - 1] === RAISED;
  return [
    `${cells.join('')}${raised ? BATON_UP : ' '}`,
    `${body}${raised ? ' ' : BATON_DOWN}`,
    `${legs} `,
  ].join('\n');
};

/** 作業中の指揮役は、指揮棒を上げ下げする。 */
const LEADER_CONDUCTING: readonly string[] = [withBaton(frame('leftHand'), true), withBaton(frame('down'), false)];

/**
 * 指揮役の、状態とフレーム番号に対応する AA。
 * 作業中は指揮棒を振り、それ以外は配下と同じ動き（承認待ちに右手で呼ぶ、など）に、上げた指揮棒を足す。
 */
export const getLeaderFrame = (state: CharacterState, frame: number): string => {
  if (state === 'working') {
    const index = ((frame % LEADER_CONDUCTING.length) + LEADER_CONDUCTING.length) % LEADER_CONDUCTING.length;
    return LEADER_CONDUCTING[index] ?? '';
  }
  return withBaton(getFrame(state, frame), true);
};

/** 状態に対応する見た目を取得する。 */
export const getAppearance = (state: CharacterState): CharacterAppearance =>
  CHARACTERS[state] ?? CHARACTERS.unknown;

/** 状態とフレーム番号から描画する AA を取得する。 */
export const getFrame = (state: CharacterState, frame: number): string => {
  const { frames } = getAppearance(state);
  const index = ((frame % frames.length) + frames.length) % frames.length;
  return frames[index] ?? frames[0] ?? '';
};
