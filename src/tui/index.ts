import { render, Text } from 'ink';
import { createElement } from 'react';

// Stub: WP02 replaces this with the full-screen app.
export async function startTui(): Promise<void> {
  const app = render(createElement(Text, null, 'Rowbly TUI is not implemented yet (WP02).'));
  app.unmount();
  await app.waitUntilExit();
}
