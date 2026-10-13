import { describe, expect, it } from 'vitest';
import { screens } from '../../src/tui/screens';
import { KEYS, renderApp } from './helpers';

/** The spinner frame depends on timing; pin it for the snapshot. */
const stable = (frame = '') => frame.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, '⠋');

describe('demo screen', () => {
  it('renders every primitive', async () => {
    const app = renderApp(screens, 'demo');
    await app.press();
    const frame = stable(app.lastFrame());
    for (const primitive of ['StageBadge', 'DetailView', 'Loading', 'SelectList', 'Form', 'ConfirmDialog']) {
      expect(frame).toContain(primitive);
    }
    expect(frame).toContain('● In Progress');
    expect(frame).toContain('[x] ada');
    expect(frame).toContain('Labels      [ ] api  [x] ui  [ ] docs');
    expect(frame).toContain('Delete (y)');
    expect(frame).toMatchSnapshot();
    app.unmount();
  });

  it('moves focus between sections with tab and shows form validation inline', async () => {
    const app = renderApp(screens, 'demo');
    await app.press(KEYS.tab);
    expect(app.lastFrame()).toContain('▸ Form');
    await app.press(...Array(15).fill(KEYS.backspace), ...'invalid', KEYS.enter);
    expect(app.lastFrame()).toContain('name is already taken');
    await app.press(KEYS.tab, 'y');
    expect(app.lastFrame()).toContain('▸ ConfirmDialog');
    expect(app.lastFrame()).toContain('confirmed');
    app.unmount();
  });
});

describe('home screen', () => {
  it('lists the go-to destinations and opens one', async () => {
    const app = renderApp(screens, 'home');
    await app.press();
    for (const label of [
      'Board',
      'Stories',
      'Epics',
      'Workspaces',
      'Boards',
      'Assignees',
      'Stages',
      'Fields',
      'Context',
    ]) {
      expect(app.lastFrame()).toContain(label);
    }
    await app.press('j', 'j', KEYS.enter);
    expect(app.lastFrame()).toContain('Home › Epics');
    // No Data Root in this test, so the Epics screen reports that instead of listing Epics.
    expect(app.lastFrame()).toContain('no Data Root found');
    app.unmount();
  });
});
