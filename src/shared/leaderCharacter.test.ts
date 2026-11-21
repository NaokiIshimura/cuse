import { describe, expect, it } from 'vitest';
import type { CharacterState } from '../types/agent.js';
import {
  CHARACTERS,
  CHARACTER_HEIGHT,
  CHARACTER_WIDTH,
  LEADER_BATON_COLUMN,
  LEADER_WIDTH,
  getFrame,
  getLeaderFrame,
} from './characters.js';

/*
 * 指揮役の AA（cuse だけのもの）。配下の AA の制約（characters.test.ts）に加えて、指揮棒の持ち方を固定する。
 * 指揮棒はキャラクター自身の右手（向かって左）に持ち、いちばん左の桁に置く。
 */

const STATES = Object.keys(CHARACTERS) as CharacterState[];
const ALLOWED_CHARS = new Set([' ', ...'▀▁▂▃▄▅▆▇█▉▊▋▌▍▎▏▐░▒▓▔▕▖▗▘▙▚▛▜▝▞▟']);
const QUADRANTS: Readonly<Record<string, readonly [number, number][]>> = {
  ' ': [],
  '▘': [[0, 0]],
  '▝': [[0, 1]],
  '▖': [[1, 0]],
  '▗': [[1, 1]],
  '▀': [[0, 0], [0, 1]],
  '▄': [[1, 0], [1, 1]],
  '▌': [[0, 0], [1, 0]],
  '▐': [[0, 1], [1, 1]],
  '▚': [[0, 0], [1, 1]],
  '▞': [[0, 1], [1, 0]],
  '▛': [[0, 0], [0, 1], [1, 0]],
  '▜': [[0, 0], [0, 1], [1, 1]],
  '▙': [[0, 0], [1, 0], [1, 1]],
  '▟': [[0, 1], [1, 0], [1, 1]],
  '█': [[0, 0], [0, 1], [1, 0], [1, 1]],
};

/** 1 フレームを 2 倍解像度の点にする。 */
const toPixels = (frame: string): Set<string> => {
  const pixels = new Set<string>();
  frame.split('\n').forEach((row, rowIndex) => {
    [...row].forEach((char, column) => {
      for (const [dy, dx] of QUADRANTS[char] ?? []) {
        pixels.add(`${rowIndex * 2 + dy},${column * 2 + dx}`);
      }
    });
  });
  return pixels;
};

/** 点が 8 近傍（斜めも含む）で 1 つの塊か。指揮棒は斜めにつながるので 8 近傍で見る。 */
const isSingleShape = (pixels: Set<string>): boolean => {
  const [start] = pixels;
  if (start === undefined) {
    return true;
  }
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) {
    const [y = 0, x = 0] = (stack.pop() ?? '').split(',').map(Number);
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const key = `${y + dy},${x + dx}`;
        if (pixels.has(key) && !seen.has(key)) {
          seen.add(key);
          stack.push(key);
        }
      }
    }
  }
  return seen.size === pixels.size;
};

const framesOf = (state: CharacterState): string[] =>
  Array.from({ length: 6 }, (_, frame) => getLeaderFrame(state, frame));
const batonOf = (frame: string): string[] => frame.split('\n').map((row) => [...row][LEADER_BATON_COLUMN] ?? ' ');

describe('getLeaderFrame', () => {
  it.each(STATES)('%s は 3 行 x 10 桁で、等幅が保証された文字だけを使う', (state) => {
    for (const frame of framesOf(state)) {
      const rows = frame.split('\n');
      expect(rows).toHaveLength(CHARACTER_HEIGHT);
      for (const row of rows) {
        expect([...row]).toHaveLength(LEADER_WIDTH);
        expect([...row].filter((char) => !ALLOWED_CHARS.has(char))).toEqual([]);
      }
    }
  });

  it.each(STATES)('%s は指揮棒を 1 本だけ持ち、手や腕から離れていない', (state) => {
    for (const frame of framesOf(state)) {
      expect(batonOf(frame).filter((cell) => cell !== ' ')).toHaveLength(1);
      expect(isSingleShape(toPixels(frame))).toBe(true);
    }
  });

  it('ふだんは右手で指揮棒を左上へ上げ、作業中は左下へ振り下ろす', () => {
    expect(batonOf(getLeaderFrame('waiting', 0))).toEqual(['▚', ' ', ' ']);
    expect(batonOf(getLeaderFrame('working', 0))).toEqual(['▚', ' ', ' ']);
    expect(batonOf(getLeaderFrame('working', 1))).toEqual([' ', '▞', ' ']);
    expect(getLeaderFrame('working', 2)).toBe(getLeaderFrame('working', 0));
  });

  it('承認待ちは、空いている左手（右端）を配下と同じ間合いで振って呼ぶ', () => {
    const lastOfHead = (frame: string) => [...(frame.split('\n')[0] ?? '')].at(-1);
    expect(lastOfHead(getLeaderFrame('blocked', 0))).toBe('▗');
    expect(lastOfHead(getLeaderFrame('blocked', 1))).toBe(' ');
  });

  it.each(STATES.filter((state) => state !== 'working'))('%s の頭の中央と身体・足は配下と同じ', (state) => {
    for (let frame = 0; frame < 4; frame += 1) {
      const leader = getLeaderFrame(state, frame).split('\n').map((row) => [...row].slice(1));
      const worker = getFrame(state, frame).split('\n').map((row) => [...row]);
      // 頭の行の両端（手）と身体の行の左端（腕）を除けば同じ
      expect(leader[0]?.slice(1, CHARACTER_WIDTH - 1)).toEqual(worker[0]?.slice(1, CHARACTER_WIDTH - 1));
      expect(leader[1]?.slice(1)).toEqual(worker[1]?.slice(1));
      expect(leader[2]).toEqual(worker[2]);
    }
  });
});
