import { describe, expect, it } from 'vitest';
import type { CharacterState } from '../types/agent.js';
import { CHARACTERS, CHARACTER_HEIGHT, CHARACTER_WIDTH, LEADER_WIDTH, getFrame, getLeaderFrame } from './characters.js';

/*
 * 指揮役の AA（cuse だけのもの）。配下の AA の制約（characters.test.ts）に加えて、指揮棒の置き方を固定する。
 */

const STATES = Object.keys(CHARACTERS) as CharacterState[];
const ALLOWED_CHARS = new Set([' ', ...'▀▁▂▃▄▅▆▇█▉▊▋▌▍▎▏▐░▒▓▔▕▖▗▘▙▚▛▜▝▞▟']);
const framesOf = (state: CharacterState): string[] =>
  Array.from({ length: 6 }, (_, frame) => getLeaderFrame(state, frame));

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

  it.each(STATES)('%s は必ず指揮棒を 1 本だけ持つ', (state) => {
    for (const frame of framesOf(state)) {
      const batons = frame.split('\n').map((row) => [...row][CHARACTER_WIDTH]);
      expect(batons.filter((cell) => cell !== ' ')).toHaveLength(1);
    }
  });

  it('左手を上げていれば棒は頭の行で右上へ、下ろしていれば身体の行で右下へ（手・身体の端と隣り合う）', () => {
    const [up, down] = [getLeaderFrame('working', 0), getLeaderFrame('working', 1)].map((frame) =>
      frame.split('\n').map((row) => [...row]),
    );
    expect(up?.[0]?.slice(CHARACTER_WIDTH - 1)).toEqual(['▗', '▞']);
    expect(down?.[0]?.[CHARACTER_WIDTH - 1]).toBe(' ');
    expect(down?.[1]?.slice(CHARACTER_WIDTH - 1)).toEqual(['▀', '▚']);
  });

  it('作業中は歩かずに指揮棒を上げ下げする', () => {
    expect(getLeaderFrame('working', 0)).not.toBe(getLeaderFrame('working', 1));
    expect(getLeaderFrame('working', 2)).toBe(getLeaderFrame('working', 0));
  });

  it.each<CharacterState>(['waiting', 'done', 'blocked', 'justFinished', 'stopped', 'unknown'])(
    '%s はふだん指揮棒を上げている。ほかは配下と同じ Clawd（承認待ちに右手で呼ぶ、など）',
    (state) => {
      for (let frame = 0; frame < 4; frame += 1) {
        const rows = getLeaderFrame(state, frame).split('\n').map((row) => [...row]);
        expect(rows[0]?.slice(CHARACTER_WIDTH - 1)).toEqual(['▗', '▞']);
        const worker = getFrame(state, frame).split('\n').map((row) => [...row]);
        // 左手（頭の行の桁 8）と指揮棒の桁を除けば、配下と同じ
        expect(rows.map((row, index) => row.slice(0, index === 0 ? CHARACTER_WIDTH - 1 : CHARACTER_WIDTH).join(''))).toEqual(
          worker.map((row, index) => row.slice(0, index === 0 ? CHARACTER_WIDTH - 1 : CHARACTER_WIDTH).join('')),
        );
      }
    },
  );
});
