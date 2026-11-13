import { EventEmitter } from "node:events";
import { stripVTControlCharacters } from "node:util";
import { render } from "ink-testing-library";
import type { ReactElement } from "react";
import { createToastStore, type ToastStore } from "../hooks/index.js";
import type { MouseEvent } from "../mouse.js";
import { TuiProviders } from "../tui-providers.js";

/** The terminal input of the keys that tests press. */
export const keys = {
  up: "\u001B[A",
  down: "\u001B[B",
  right: "\u001B[C",
  left: "\u001B[D",
  shiftUp: "\u001B[1;2A",
  shiftDown: "\u001B[1;2B",
  ctrlShiftUp: "\u001B[1;6A",
  ctrlShiftDown: "\u001B[1;6B",
  shiftRight: "\u001B[1;2C",
  shiftLeft: "\u001B[1;2D",
  home: "\u001B[H",
  end: "\u001B[F",
  pageUp: "\u001B[5~",
  pageDown: "\u001B[6~",
  delete: "\u001B[3~",
  enter: "\r",
  escape: "\u001B",
  tab: "\t",
  shiftTab: "\u001B[Z",
  backspace: "\u007F",
  space: " ",
  /** `ctrl` with a letter, for example `keys.ctrl("s")`. */
  ctrl: (letter: string) => String.fromCharCode(letter.toLowerCase().charCodeAt(0) - 96),
} as const;

// Kept from load, so the waits still run while a test fakes the timers.
const realSetTimeout = globalThis.setTimeout;

/** Waits `ms` milliseconds, so that Ink can handle the pending input and React can commit the renders. */
export function settle(ms = 10): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, ms));
}

type Ink = ReturnType<typeof render>;

/** Waits for two quiet steps in a row, for at most `steps` more steps. */
async function quiet(ink: Ink, count: number, calm: number, steps: number): Promise<void> {
  if (calm >= 2 || steps >= 50) {
    return;
  }

  await settle(10);

  const next = ink.frames.length;

  await quiet(ink, next, next === count ? calm + 1 : 0, steps + 1);
}

/**
 * Waits at least `min` milliseconds, then until Ink writes no new frame for two steps. A key can open
 * an overlay or start a measurement, which takes a chain of renders and effects.
 */
async function idle(ink: Ink, min: number): Promise<void> {
  await settle(min);
  await quiet(ink, ink.frames.length, 0, 0);
}

export interface TuiTest {
  /** The last frame without colours and other escape codes. */
  frame(): string;
  /** Writes each input to stdin and waits until the frame stops changing. A lone `esc` waits for Ink's escape timeout. */
  press(...inputs: string[]): Promise<void>;
  /** Types `text` one character at a time. */
  type(text: string): Promise<void>;
  /** Sends a mouse event at a 0-based cell. */
  mouse(kind: MouseEvent["kind"], x: number, y: number): Promise<void>;
  /** A left click (a press and a release) on the first cell of the first occurrence of `text`. */
  click(text: string): Promise<void>;
  /** The 0-based cell where `text` first shows in the frame. */
  locate(text: string): { x: number; y: number };
  rerender(node: ReactElement): Promise<void>;
  unmount(): void;
  toasts: ToastStore;
  /** The raw ink-testing-library instance, for frames and stdin. */
  ink: ReturnType<typeof render>;
}

/** The last frame without colours and other escape codes. */
function plainFrame(ink: Ink): string {
  return stripVTControlCharacters(ink.lastFrame() ?? "");
}

function locateText(ink: Ink, text: string): { x: number; y: number } {
  const lines = plainFrame(ink).split("\n");
  const y = lines.findIndex((line) => line.includes(text));

  if (y < 0) {
    throw new Error(`"${text}" is not on screen:\n${plainFrame(ink)}`);
  }

  return { x: [...(lines[y] ?? "").slice(0, lines[y]?.indexOf(text))].length, y };
}

async function sendMouse(
  ink: Ink,
  source: EventEmitter,
  kind: MouseEvent["kind"],
  x: number,
  y: number,
): Promise<void> {
  source.emit("mouse", { kind, x, y } satisfies MouseEvent);
  await idle(ink, 0);
}

async function pressKeys(ink: Ink, inputs: readonly string[]): Promise<void> {
  for (const input of inputs) {
    ink.stdin.write(input);
    await idle(ink, input === keys.escape ? 30 : 0);
  }
}

async function typeText(ink: Ink, text: string): Promise<void> {
  for (const char of text) {
    ink.stdin.write(char);
    await settle(5);
  }

  await idle(ink, 0);
}

async function clickText(ink: Ink, source: EventEmitter, text: string): Promise<void> {
  const { x, y } = locateText(ink, text);

  await sendMouse(ink, source, "press", x, y);
  await sendMouse(ink, source, "release", x, y);
}

/** The providers of the app around one test node. */
function Wrap({ toasts, mouse, children }: { toasts: ToastStore; mouse: EventEmitter; children: ReactElement }) {
  return (
    <TuiProviders toasts={toasts} mouse={mouse} fullscreen={false}>
      {children}
    </TuiProviders>
  );
}

async function rerenderNode(ink: Ink, toasts: ToastStore, mouse: EventEmitter, node: ReactElement): Promise<void> {
  ink.rerender(
    <Wrap toasts={toasts} mouse={mouse}>
      {node}
    </Wrap>,
  );
  await idle(ink, 0);
}

/**
 * Renders `node` in the providers that the app uses (`TuiProviders`, not full screen) with a mouse
 * source, and waits for the first effects to run. The terminal is 100 columns wide.
 */
export async function renderTui(node: ReactElement, options: { toasts?: ToastStore } = {}): Promise<TuiTest> {
  const toasts = options.toasts ?? createToastStore();
  const mouseSource = new EventEmitter();
  const ink = render(
    <Wrap toasts={toasts} mouse={mouseSource}>
      {node}
    </Wrap>,
  );

  await idle(ink, 10);

  return {
    frame: () => plainFrame(ink),
    press: (...inputs) => pressKeys(ink, inputs),
    type: (text) => typeText(ink, text),
    mouse: (kind, x, y) => sendMouse(ink, mouseSource, kind, x, y),
    click: (text) => clickText(ink, mouseSource, text),
    locate: (text) => locateText(ink, text),
    rerender: (next) => rerenderNode(ink, toasts, mouseSource, next),
    unmount: () => ink.unmount(),
    toasts,
    ink,
  };
}
