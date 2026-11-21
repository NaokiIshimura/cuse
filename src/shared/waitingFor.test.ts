import { describe, expect, it } from 'vitest';
import { waitingForOf } from './waitingFor.js';

describe('waitingForOf', () => {
  it.each([
    ['blocked', 'approval'],
    ['waiting', 'input'],
    ['justFinished', 'input'],
    ['working', null],
    ['done', null],
    ['stopped', null],
    ['unknown', null],
  ] as const)('%s → %s', (state, expected) => {
    expect(waitingForOf(state)).toBe(expected);
  });
});

describe('waitingForOf（claude agents --json の waitingFor）', () => {
  it.each([
    ['permission prompt', 'approval'],
    ['sandbox request', 'approval'],
    ['worker request', 'approval'],
    ['input needed', 'input'],
    ['dialog open', 'input'],
  ] as const)('%s → %s', (raw, expected) => {
    expect(waitingForOf('waiting', raw)).toBe(expected);
  });

  it('知らない値なら状態で決める', () => {
    expect(waitingForOf('blocked', 'something new')).toBe('approval');
  });
});
