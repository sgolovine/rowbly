import { describe, expect, it } from 'vitest';
import { boardFlag, workspaceFlag } from '../../src/commands/_shared';

describe('workspaceFlag', () => {
  it('prefers --workspace over ROWBLY_WORKSPACE', () => {
    expect(workspaceFlag({ workspace: 'a' }, { ROWBLY_WORKSPACE: 'b' })).toBe('a');
    expect(workspaceFlag({}, { ROWBLY_WORKSPACE: 'b' })).toBe('b');
    expect(workspaceFlag({}, { ROWBLY_WORKSPACE: '' })).toBeUndefined();
  });
});

describe('boardFlag', () => {
  it('prefers --board over ROWBLY_BOARD', () => {
    expect(boardFlag({ board: 'x' }, { ROWBLY_BOARD: 'y' })).toBe('x');
    expect(boardFlag({}, { ROWBLY_BOARD: 'y' })).toBe('y');
    expect(boardFlag({}, {})).toBeUndefined();
  });

  it('qualifies a bare board with the Workspace flag', () => {
    expect(boardFlag({ workspace: 'a', board: 'x' }, {})).toBe('a/x');
    expect(boardFlag({ board: 'x' }, { ROWBLY_WORKSPACE: 'b' })).toBe('b/x');
    expect(boardFlag({ workspace: 'a', board: 'c/x' }, {})).toBe('c/x');
  });
});
