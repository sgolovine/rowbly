import { Text, useInput } from 'ink';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../src/core';
import { useAsync, useIsActive, useServices } from '../../src/tui/hooks';
import { useRouter } from '../../src/tui/router';
import type { ScreenRegistry } from '../../src/tui/screens';
import { KEYS, renderApp, waitForFrame } from './helpers';

function Opener() {
  const router = useRouter();
  useInput((input) => input === 'n' && router.push('broken'), { isActive: useIsActive() });
  return <Text>Screen A</Text>;
}

describe('service errors', () => {
  it('shows a failed service call as a toast and keeps running', async () => {
    function Loader() {
      const [count, setCount] = useState(0);
      const { error } = useAsync(() => Promise.reject(new NotFoundError('story "WEB-9" not found')), []);
      useInput((input) => input === '+' && setCount((c) => c + 1), { isActive: useIsActive() });
      return <Text>{error ? `failed, count ${count}` : 'loading'}</Text>;
    }
    const app = renderApp({ a: Loader });
    await waitForFrame(app, 'error: story "WEB-9" not found');
    await app.press('+', '+');
    expect(app.lastFrame()).toContain('failed, count 2');
    await app.press('?');
    expect(app.lastFrame()).toContain('Keys');
    app.unmount();
  });

  it('turns a RowblyError thrown while rendering a screen into a toast', async () => {
    const screens: ScreenRegistry = {
      a: Opener,
      broken: () => {
        throw new NotFoundError('epic "q4" not found');
      },
    };
    const app = renderApp(screens);
    await app.press('n');
    expect(app.lastFrame()).toContain('error: epic "q4" not found');
    expect(app.lastFrame()).toContain('This screen could not be shown');
    await app.press(KEYS.escape);
    expect(app.lastFrame()).toContain('Screen A');
    app.unmount();
  });

  it('reports a missing Data Root from useServices() the same way', async () => {
    function NeedsServices() {
      useServices();
      return <Text>unreachable</Text>;
    }
    const app = renderApp({ a: Opener, broken: NeedsServices });
    await app.press('n');
    expect(app.lastFrame()).toContain('error: no Data Root found (run `rowbly init` to create one)');
    app.unmount();
  });
});
