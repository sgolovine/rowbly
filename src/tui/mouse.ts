// Mouse input. Ink drops mouse reports before they reach `useInput`, so the TUI reads stdin through
// `MouseStdin`, which takes the reports out of the stream and hands the rest of the input to Ink.
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Store } from "../services/store/store.js";

/** Turns on pointer reporting in SGR encoding for clicks, drag/drop, control hover and the wheel. */
export const MOUSE_ON = "\u001B[?1000h\u001B[?1003h\u001B[?1006h";
export const MOUSE_OFF = "\u001B[?1006l\u001B[?1003l\u001B[?1000l";

/**
 * A press or release of the left button, a pointer move, a press of the right button (`menu`, which
 * ends a drag or pull), or a notch of the wheel (`wheelUp`, `wheelDown`), at a 0-based cell.
 */
export interface MouseEvent {
  kind: "press" | "release" | "move" | "menu" | "wheelUp" | "wheelDown";
  x: number;
  y: number;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: SGR mouse reports start with ESC.
const SGR = /\u001B\[<(\d+);(\d+);(\d+)([Mm])/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: an SGR report cut off at the end of a chunk.
const PARTIAL = /\u001B\[<[\d;]*$/;

/** The mouse event of one SGR report, or `undefined` for a report that Rowbly drops. */
function mouseEvent(button: number, x: number, y: number, final: string): MouseEvent | undefined {
  const at = { x: x - 1, y: y - 1 };

  if ((button & 32) !== 0 && (button & 64) === 0) {
    return { kind: "move", ...at };
  }

  if ((button & 0b1100_0011) === 0) {
    return { kind: final === "M" ? "press" : "release", ...at };
  }

  if ((button & 0b1100_0011) === 2 && final === "M") {
    return { kind: "menu", ...at };
  }

  if ((button & 0b1100_0010) === 64 && final === "M") {
    // Wheel buttons 4 and 5 report as 64 and 65.
    return { kind: (button & 1) === 0 ? "wheelUp" : "wheelDown", ...at };
  }

  return undefined;
}

/**
 * Takes the SGR mouse reports out of `input`. The left button's presses and releases, pointer moves,
 * right-button presses and wheel notches are reported; the right button's release and other buttons
 * are dropped. `rest` is the remaining text, `pending` an unfinished report to prepend to
 * the next chunk.
 */
function extractMouse(input: string): { events: MouseEvent[]; rest: string; pending: string } {
  const events = [...input.matchAll(SGR)].flatMap(
    ([, button, x, y, final]) => mouseEvent(Number(button), Number(x), Number(y), final ?? "") ?? [],
  );
  const text = input.replace(SGR, "");
  const partial = PARTIAL.exec(text);

  return { events, rest: partial ? text.slice(0, partial.index) : text, pending: partial?.[0] ?? "" };
}

type Source = NodeJS.ReadStream | (EventEmitter & { setRawMode?(mode: boolean): unknown });

/**
 * The stdin Ink reads from: the terminal's input without mouse reports, which go to `mouse`. Raw
 * mode and ref counting are passed through to the real stdin.
 */
export class MouseStdin extends PassThrough {
  readonly isTTY = true;
  readonly mouse = new EventEmitter();
  /** `pending` is an unfinished report from the last chunk; `reading` tells whether `feed` listens to the source. */
  readonly #state = new Store({ pending: "", reading: false });

  constructor(private readonly source: Source) {
    super({ encoding: "utf8" });
  }

  setRawMode(mode: boolean): this {
    const { reading } = this.#state.current;

    this.source.setRawMode?.(mode);

    if (mode && !reading) {
      this.#startReading();
    } else if (!mode && reading) {
      this.#stopReading();
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

  #startReading(): void {
    this.#state.update(() => ({ reading: true }));
    (this.source as NodeJS.ReadStream).setEncoding?.("utf8");
    (this.source as EventEmitter).on("data", this.feed);
    // Ink turns raw mode off when its last `useInput` goes, for example between two Modals. A paused
    // stream does not start again for a new listener, and then Node has no more work and exits.
    (this.source as NodeJS.ReadStream).resume?.();
  }

  #stopReading(): void {
    this.#state.update(() => ({ reading: false }));
    (this.source as EventEmitter).off("data", this.feed);
    (this.source as NodeJS.ReadStream).pause?.();
  }

  #receive(chunk: unknown): void {
    const { events, rest, pending } = extractMouse(this.#state.current.pending + String(chunk));

    this.#state.update(() => ({ pending }));

    for (const event of events) {
      this.mouse.emit("mouse", event);
    }

    if (rest) {
      this.write(rest);
    }
  }

  // One reference, so that `off` removes the listener that `on` added.
  private readonly feed = (chunk: unknown): void => this.#receive(chunk);
}
