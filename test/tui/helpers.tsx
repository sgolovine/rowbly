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
  enter: '\r',
  escape: '\u001B',
  tab: '\t',
  backspace: '\u007F',
  ctrlS: '\u0013',
} as const;

/** Lets Ink process input and re-render. `esc` needs longer: Ink waits to tell it apart from escape sequences. */
export const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

export type Rendered = ReturnType<typeof render> & { press(...keys: string[]): Promise<void> };

/** Renders `node` and returns a `press` helper that types each key and waits for the frame. */
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
