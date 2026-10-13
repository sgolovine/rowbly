import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { extractMouse, type MouseEvent, MouseStdin } from '../../src/tui/mouse';
import { boardKey } from '../../src/tui/shell';

describe('mouse input', () => {
  it('takes left-button SGR reports out of the input, 0-based', () => {
    expect(extractMouse('a\u001B[<0;5;3Mb\u001B[<0;6;4m')).toEqual({
      events: [
        { kind: 'press', x: 4, y: 2 },
        { kind: 'release', x: 5, y: 3 },
      ],
      rest: 'ab',
      pending: '',
    });
    // The wheel and the right button are dropped; the escape key and arrows pass through.
    expect(extractMouse('\u001B[<64;1;1M\u001B[<2;1;1M\u001B\u001B[A')).toEqual({
      events: [],
      rest: '\u001B\u001B[A',
      pending: '',
    });
  });

  it('holds back a report cut off at the end of a chunk', () => {
    expect(extractMouse('x\u001B[<0;1')).toEqual({ events: [], rest: 'x', pending: '\u001B[<0;1' });
  });

  it('passes keys on to Ink and reports clicks while in raw mode', async () => {
    const source = Object.assign(new EventEmitter(), { setRawMode: vi.fn(), setEncoding: vi.fn(), pause: vi.fn() });
    const stdin = new MouseStdin(source as unknown as NodeJS.ReadStream);
    const events: MouseEvent[] = [];
    stdin.mouse.on('mouse', (event) => events.push(event));
    stdin.setRawMode(true);
    source.emit('data', 'j\u001B[<0;2');
    source.emit('data', ';2M');
    expect(stdin.read()).toBe('j');
    expect(events).toEqual([{ kind: 'press', x: 1, y: 1 }]);
    stdin.setRawMode(false);
    source.emit('data', 'k');
    expect(stdin.read()).toBeNull();
    expect(source.setRawMode.mock.calls).toEqual([[true], [false]]);
  });
});

describe('Board keys', () => {
  it('steps with [ and ] (wrapping) and jumps with 1-9', () => {
    expect(boardKey(']', 0, 3)).toBe(1);
    expect(boardKey(']', 2, 3)).toBe(0);
    expect(boardKey('[', 0, 3)).toBe(2);
    expect(boardKey('2', 0, 3)).toBe(1);
    expect(boardKey('4', 0, 3)).toBeNull();
    expect(boardKey('x', 0, 3)).toBeNull();
  });
});
