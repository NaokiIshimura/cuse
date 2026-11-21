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
