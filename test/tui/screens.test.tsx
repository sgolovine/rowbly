import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { screens } from '../../src/tui/screens';

describe('screen registry', () => {
  it('has one entry per area', () => {
    expect(Object.keys(screens).sort()).toEqual(
      [
        'board',
        'board-detail',
        'board-form',
        'boards',
        'context',
        'demo',
        'doctor',
        'fields',
        'home',
        'plugin',
        'plugins',
        'settings',
        'setup',
        'stages',
        'stories',
        'story',
        'story-form',
      ].sort(),
    );
  });

  // Built screens have their own tests; only the remaining placeholders are checked here.
  const placeholders = Object.entries(screens).filter(([, Screen]) => Screen.displayName?.startsWith('Placeholder('));

  it.each(placeholders)('renders the %s placeholder', (_name, Screen) => {
    const { lastFrame, unmount } = render(<Screen params={{}} />);
    expect(lastFrame()).toMatch(/not implemented \(WP\d\d\)/);
    unmount();
  });
});
