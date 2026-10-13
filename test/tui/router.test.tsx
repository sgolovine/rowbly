import { Text, useInput } from 'ink';
import { describe, expect, it } from 'vitest';
import { Form } from '../../src/tui/components';
import { useIsActive } from '../../src/tui/hooks';
import { useRouter } from '../../src/tui/router';
import type { ScreenRegistry } from '../../src/tui/screens';
import { KEYS, renderApp } from './helpers';

/** A screen that opens others: `n` pushes b, `r` replaces with c, `p` pops. */
function testScreen(label: string): ScreenRegistry[string] {
  return function TestScreen() {
    const router = useRouter();
    useInput(
      (input) => {
        if (input === 'n') router.push('b', { title: 'Bee' });
        if (input === 'r') router.replace('c');
        if (input === 'p') router.pop();
      },
      { isActive: useIsActive() },
    );
    return <Text>Screen {label}</Text>;
  };
}

const screens: ScreenRegistry = {
  a: testScreen('A'),
  b: testScreen('B'),
  c: testScreen('C'),
  form: () => <Form fields={[{ name: 'name', label: 'Name', kind: 'text' }]} onSubmit={() => {}} />,
  form2: () => (
    <Form
      fields={[
        { name: 'name', label: 'Name', kind: 'text' },
        { name: 'done', label: 'Done', kind: 'boolean' },
      ]}
      onSubmit={() => {}}
    />
  ),
};

describe('router', () => {
  it('pushes a screen and goes back on esc', async () => {
    const app = renderApp(screens);
    await app.press('n');
    expect(app.lastFrame()).toContain('Screen B');
    expect(app.lastFrame()).toContain('A › Bee');
    expect(app.lastFrame()).toContain('esc back');
    await app.press(KEYS.escape);
    expect(app.lastFrame()).toContain('Screen A');
    expect(app.lastFrame()).not.toContain('Screen B');
    app.unmount();
  });

  it('does nothing on esc at the root', async () => {
    const app = renderApp(screens);
    await app.press(KEYS.escape);
    expect(app.lastFrame()).toContain('Screen A');
    expect(app.lastFrame()).toContain('q quit');
    app.unmount();
  });

  it('replaces the current screen and pops programmatically', async () => {
    const app = renderApp(screens);
    await app.press('n', 'r');
    expect(app.lastFrame()).toContain('Screen C');
    expect(app.lastFrame()).toContain('A › C');
    await app.press('p');
    expect(app.lastFrame()).toContain('Screen A');
    app.unmount();
  });

  it('keeps the screen below mounted and inactive', async () => {
    const app = renderApp(screens);
    await app.press('n', 'n');
    expect(app.lastFrame()).toContain('A › Bee › Bee');
    await app.press(KEYS.escape, KEYS.escape);
    expect(app.lastFrame()).toContain('Screen A');
    app.unmount();
  });

  it('opens the go-to palette with g and pushes the picked screen', async () => {
    const app = renderApp(screens);
    await app.press('g');
    expect(app.lastFrame()).toContain('Go to');
    expect(app.lastFrame()).toContain('Assignees');
    expect(app.lastFrame()).not.toContain('Screen A');
    await app.press(KEYS.down, KEYS.enter);
    // The test registry has no "stories" screen.
    expect(app.lastFrame()).toContain('A › Stories');
    expect(app.lastFrame()).toContain('screen "stories" is not available');
    app.unmount();
  });

  it('closes the palette on esc without leaving the screen', async () => {
    const app = renderApp(screens, 'b');
    await app.press('g', KEYS.escape);
    expect(app.lastFrame()).toContain('Screen B');
    expect(app.lastFrame()).not.toContain('Go to');
    app.unmount();
  });

  it('opens the help overlay with ? listing the current keys', async () => {
    const app = renderApp(screens);
    await app.press('?');
    expect(app.lastFrame()).toContain('Keys');
    expect(app.lastFrame()).toContain('go to');
    expect(app.lastFrame()).toContain('filter lists');
    await app.press('?');
    expect(app.lastFrame()).toContain('Screen A');
    app.unmount();
  });

  it('asks before going back from a dirty form', async () => {
    const app = renderApp({ ...screens, a: testScreen('A'), b: screens.form as ScreenRegistry[string] });
    await app.press('n', 'x');
    // Typing goes into the field, not to the shell.
    expect(app.lastFrame()).toContain('Name x');
    await app.press(KEYS.escape);
    expect(app.lastFrame()).toContain('Go back and discard unsaved changes?');
    await app.press('n');
    expect(app.lastFrame()).not.toContain('discard');
    expect(app.lastFrame()).toContain('Name x');
    await app.press(KEYS.escape, 'y');
    expect(app.lastFrame()).toContain('Screen A');
    app.unmount();
  });

  it('asks before quitting from a dirty form at the root', async () => {
    const app = renderApp(screens, 'form2');
    await app.press('x', 'q');
    // `q` typed into a text field is text, not quit.
    expect(app.lastFrame()).toContain('Name xq');
    await app.press(KEYS.down, 'q');
    expect(app.lastFrame()).toContain('Quit and discard unsaved changes?');
    await app.press(KEYS.escape);
    expect(app.lastFrame()).not.toContain('Quit and discard');
    expect(app.lastFrame()).toContain('Name xq');
    app.unmount();
  });
});
