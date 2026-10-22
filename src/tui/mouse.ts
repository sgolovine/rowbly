// Mouse input. Ink drops mouse reports before they reach `useInput`, so the TUI reads stdin through
// `MouseStdin`, which takes the reports out of the stream and hands the rest of the input to Ink.
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

/** Turns on pointer reporting in SGR encoding for clicks, drag/drop and control hover. */
export const MOUSE_ON = '\u001B[?1000h\u001B[?1003h\u001B[?1006h';
export const MOUSE_OFF = '\u001B[?1006l\u001B[?1003l\u001B[?1000l';

/**
 * A press or release of the left button, a pointer move, or a press of the right button (`menu`, which
 * asks for a context menu), at a 0-based cell.
 */
export interface MouseEvent {
  kind: 'press' | 'release' | 'move' | 'menu';
  x: number;
  y: number;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: SGR mouse reports start with ESC.
const SGR = /\u001B\[<(\d+);(\d+);(\d+)([Mm])/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: an SGR report cut off at the end of a chunk.
const PARTIAL = /\u001B\[<[\d;]*$/;

/**
 * Takes the SGR mouse reports out of `input`. The left button's presses and releases, pointer moves
 * and right-button presses are reported; the right button's release, the wheel and other buttons are
 * dropped. `rest` is the remaining text, `pending` an unfinished report to prepend to
 * the next chunk.
 */
export function extractMouse(input: string): { events: MouseEvent[]; rest: string; pending: string } {
  const events: MouseEvent[] = [];
  let rest = input.replace(SGR, (_all, button: string, x: string, y: string, final: string) => {
    if ((Number(button) & 32) !== 0 && (Number(button) & 64) === 0) {
      events.push({ kind: 'move', x: Number(x) - 1, y: Number(y) - 1 });
    } else if ((Number(button) & 0b1100_0011) === 0) {
      events.push({ kind: final === 'M' ? 'press' : 'release', x: Number(x) - 1, y: Number(y) - 1 });
    } else if ((Number(button) & 0b1100_0011) === 2 && final === 'M') {
      events.push({ kind: 'menu', x: Number(x) - 1, y: Number(y) - 1 });
    }
    return '';
  });
  let pending = '';
  const partial = PARTIAL.exec(rest);
  if (partial) {
    pending = partial[0];
    rest = rest.slice(0, partial.index);
  }
  return { events, rest, pending };
}

type Source = NodeJS.ReadStream | (EventEmitter & { setRawMode?(mode: boolean): unknown });

/**
 * The stdin Ink reads from: the terminal's input without mouse reports, which go to `mouse`. Raw
 * mode and ref counting are passed through to the real stdin.
 */
export class MouseStdin extends PassThrough {
  readonly isTTY = true;
  readonly mouse = new EventEmitter();
  private pending = '';
  private reading = false;

  constructor(private readonly source: Source) {
    super({ encoding: 'utf8' });
  }

  setRawMode(mode: boolean): this {
    this.source.setRawMode?.(mode);
    if (mode && !this.reading) {
      this.reading = true;
      (this.source as NodeJS.ReadStream).setEncoding?.('utf8');
      this.source.on('data', this.feed);
    } else if (!mode && this.reading) {
      this.reading = false;
      this.source.off('data', this.feed);
      (this.source as NodeJS.ReadStream).pause?.();
    }
    return this;
  }

  ref(): this {
    (this.source as NodeJS.ReadStream).ref?.();
    return this;
  }

  unref(): this {
    (this.source as NodeJS.ReadStream).unref?.();
    return this;
  }

  private readonly feed = (chunk: unknown) => {
    const { events, rest, pending } = extractMouse(this.pending + String(chunk));
    this.pending = pending;
    for (const event of events) this.mouse.emit('mouse', event);
    if (rest) this.write(rest);
  };
}
