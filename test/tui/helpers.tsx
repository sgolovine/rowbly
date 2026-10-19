import { render } from 'ink-testing-library';
import type { ReactElement } from 'react';
import { App } from '../../src/tui/app';
import { createToastStore } from '../../src/tui/hooks';
import type { ScreenRegistry } from '../../src/tui/screens';

export const KEYS = {
  up: '\u001B[A',
  down: '\u001B[B',
  left: '\u001B[D',
  right: '\u001B[C',
  shiftUp: '\u001B[1;2A',
  shiftDown: '\u001B[1;2B',
  shiftLeft: '\u001B[1;2D',
  shiftRight: '\u001B[1;2C',
  home: '\u001B[H',
  end: '\u001B[F',
  enter: '\r',
  escape: '\u001B',
  tab: '\t',
  shiftTab: '\u001B[Z',
  backspace: '\u007F',
  ctrlS: '\u0013',
  ctrlF: '\u0006',
  ctrlN: '\u000E',
  /** As terminals with the kitty keyboard protocol send it. */
  ctrlEnter: '\u001B[13;5u',
} as const;

/** Lets Ink process input and re-render. `esc` needs longer: Ink waits to tell it apart from escape sequences. */
export const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

export type FrameMatcher = string | RegExp | ((frame: string) => boolean);

/**
 * Polls the last frame until it matches, then returns it. Use this instead of a fixed sleep before
 * asserting on anything that waits for a service call, so tests hold up on a busy machine.
 */
export async function waitForFrame(
  app: { lastFrame(): string | undefined },
  match: FrameMatcher,
  timeout = 5_000,
): Promise<string> {
  const ok =
    typeof match === 'function'
      ? match
      : (f: string) => (typeof match === 'string' ? f.includes(match) : match.test(f));
  const deadline = Date.now() + timeout;
  for (;;) {
    const frame = app.lastFrame() ?? '';
    if (ok(frame)) return frame;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${String(match)}; last frame:\n${frame}`);
    await tick(20);
  }
}

export type Rendered = ReturnType<typeof render> & { press(...keys: string[]): Promise<void> };

/**
 * Renders `node` and returns a `press` helper that paces input for Ink. It does not wait for async
 * work: use `waitForFrame` for the state needed by the next key before pressing it.
 */
export function renderTui(node: ReactElement): Rendered {
  const result = render(node);
  return Object.assign(result, {
    async press(...keys: string[]) {
      await tick();
      for (const key of keys) {
        result.stdin.write(key);
        await tick(key === KEYS.escape ? 120 : 30);
      }
    },
  });
}

/** The App with test screens and no Data Root. */
export function renderApp(screens: ScreenRegistry, initial = 'a', toasts = createToastStore()) {
  return renderTui(
    <App ctx={null} services={null} initial={{ screen: initial, params: {} }} screens={screens} toasts={toasts} />,
  );
}
