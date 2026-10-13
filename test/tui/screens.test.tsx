import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { screens } from '../../src/tui/screens';
import { CommentsPanel } from '../../src/tui/screens/comments/CommentsPanel';
import { StoryTasksTab } from '../../src/tui/screens/tasks/StoryTasksTab';

describe('screen registry', () => {
  it('has one entry per area', () => {
    expect(Object.keys(screens).sort()).toEqual(
      [
        'assignees',
        'board',
        'boards',
        'comments',
        'demo',
        'doctor',
        'epics',
        'fields',
        'home',
        'setup',
        'stages',
        'stories',
        'tasks',
        'workspaces',
      ].sort(),
    );
  });

  // WP02 built `home` and `demo`; they have their own tests.
  const placeholders = Object.entries(screens).filter(([name]) => name !== 'home' && name !== 'demo');

  it.each(placeholders)('renders the %s placeholder', (_name, Screen) => {
    const { lastFrame, unmount } = render(<Screen params={{}} />);
    expect(lastFrame()).toMatch(/not implemented \(WP\d\d\)/);
    unmount();
  });

  it('renders the Tasks tab and Comments panel placeholders', () => {
    expect(render(<StoryTasksTab storyKey="WEB-1" />).lastFrame()).toContain('Tasks for WEB-1');
    expect(render(<CommentsPanel target="WEB-1.2" />).lastFrame()).toContain('Comments on WEB-1.2');
  });
});
