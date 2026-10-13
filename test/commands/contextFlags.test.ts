import { describe, expect, it } from 'vitest';
import { boardFlag } from '../../src/commands/_shared';

describe('boardFlag', () => {
  it('prefers --board over ROWBLY_BOARD', () => {
    expect(boardFlag({ board: 'x' }, { ROWBLY_BOARD: 'y' })).toBe('x');
    expect(boardFlag({}, { ROWBLY_BOARD: 'y' })).toBe('y');
    expect(boardFlag({}, { ROWBLY_BOARD: '' })).toBeUndefined();
    expect(boardFlag({}, {})).toBeUndefined();
  });
});
