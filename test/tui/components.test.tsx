import { EventEmitter } from 'node:events';
import { Text, useInput } from 'ink';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConflictError, ValidationError } from '../../src/core';
import { App } from '../../src/tui/app';
import {
  ConfirmDialog,
  DetailView,
  Form,
  type FormField,
  markdownToPlain,
  SelectList,
  StageBadge,
  TextArea,
  TextInput,
} from '../../src/tui/components';
import { createToastStore, useIsActive } from '../../src/tui/hooks';
import { useRouter } from '../../src/tui/router';
import { KEYS, renderApp, renderTui, tick, waitForFrame } from './helpers';

const ITEMS = [
  { value: 'ada', label: 'ada' },
  { value: 'grace', label: 'grace' },
  { value: 'linus', label: 'linus' },
];

describe('SelectList', () => {
  it('moves with arrows and j/k and selects with enter', async () => {
    const onSelect = vi.fn();
    const ui = renderTui(<SelectList items={ITEMS} onSelect={onSelect} />);
    await ui.press('j', KEYS.down, 'k', KEYS.enter);
    expect(onSelect).toHaveBeenCalledWith(ITEMS[1]);
    expect(ui.lastFrame()).toContain('› grace');
    ui.unmount();
  });

  it('leaves shift+arrows to the screen', async () => {
    const ui = renderTui(<SelectList items={ITEMS} />);
    await ui.press(KEYS.shiftDown);
    expect(ui.lastFrame()).toContain('› ada');
    ui.unmount();
  });

  it('filters by label with / and clears the filter on esc', async () => {
    const onSelect = vi.fn();
    const ui = renderTui(<SelectList items={ITEMS} onSelect={onSelect} />);
    await ui.press('/', 'l', 'i');
    expect(ui.lastFrame()).toContain('/li');
    expect(ui.lastFrame()).toContain('linus');
    expect(ui.lastFrame()).not.toContain('grace');
    await ui.press(KEYS.enter, KEYS.enter);
    expect(onSelect).toHaveBeenCalledWith(ITEMS[2]);
    await ui.press('/', KEYS.escape);
    expect(ui.lastFrame()).toContain('grace');
    expect(ui.lastFrame()).not.toContain('/');
    ui.unmount();
  });

  it('shows an empty state and a no-match state', async () => {
    const empty = renderTui(<SelectList items={[]} emptyText="No stories yet." />);
    expect(empty.lastFrame()).toContain('No stories yet.');
    empty.unmount();

    const ui = renderTui(<SelectList items={ITEMS} />);
    await ui.press('/', 'z', 'z');
    expect(ui.lastFrame()).toContain('No matches for "zz".');
    ui.unmount();
  });

  it('toggles items with space and submits them in multi-select mode', async () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    const ui = renderTui(
      <SelectList items={ITEMS} multi defaultSelected={['ada']} onChange={onChange} onSubmit={onSubmit} />,
    );
    expect(ui.lastFrame()).toContain('[x] ada');
    await ui.press(' ', 'j', 'j', ' ');
    expect(ui.lastFrame()).toContain('[ ] ada');
    expect(ui.lastFrame()).toContain('[x] linus');
    expect(onChange).toHaveBeenLastCalledWith(['linus']);
    // Filtering keeps the checked set.
    await ui.press('/', 'g', KEYS.enter, ' ', KEYS.enter);
    expect(onSubmit).toHaveBeenCalledWith(['linus', 'grace']);
    ui.unmount();
  });

  it('ignores keys when inactive', async () => {
    const onSelect = vi.fn();
    const ui = renderTui(<SelectList items={ITEMS} onSelect={onSelect} isActive={false} />);
    await ui.press(KEYS.enter);
    expect(onSelect).not.toHaveBeenCalled();
    ui.unmount();
  });
});

const FIELDS: FormField[] = [
  { name: 'name', label: 'Name', kind: 'text', required: true },
  { name: 'points', label: 'Points', kind: 'number' },
  { name: 'due', label: 'Due', kind: 'date' },
  { name: 'blocked', label: 'Blocked', kind: 'boolean' },
  { name: 'priority', label: 'Priority', kind: 'select', options: ['P0', 'P1', 'P2'] },
  { name: 'labels', label: 'Labels', kind: 'multiselect', options: ['api', 'ui'] },
];

describe('Form', () => {
  it('shows inline validation messages and does not submit', async () => {
    const onSubmit = vi.fn();
    const ui = renderTui(<Form fields={FIELDS} onSubmit={onSubmit} />);
    await ui.press(KEYS.down, 'x', KEYS.down, '2', '0', '2', '6', KEYS.ctrlEnter);
    expect(onSubmit).not.toHaveBeenCalled();
    const frame = ui.lastFrame() ?? '';
    expect(frame).toContain('required');
    expect(frame).toContain('must be a number');
    expect(frame).toContain('must be a date (YYYY-MM-DD)');
    ui.unmount();
  });

  it('submits typed values of every kind with ctrl+enter', async () => {
    const onSubmit = vi.fn();
    const ui = renderTui(<Form fields={FIELDS} initialValues={{ name: 'Fix' }} onSubmit={onSubmit} />);
    await ui.press(' ', 'l', 'o', 'g', 'i', 'n', KEYS.backspace, 'n');
    await ui.press(KEYS.down, '3', KEYS.down, ...'2026-10-12');
    await ui.press(KEYS.down, ' ', KEYS.down, KEYS.right, KEYS.right, KEYS.down, KEYS.right, ' ', KEYS.ctrlEnter);
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Fix login',
      points: 3,
      due: '2026-10-12',
      blocked: true,
      priority: 'P1',
      labels: ['ui'],
    });
    ui.unmount();
  });

  it('submits with ctrl+s', async () => {
    const onSubmit = vi.fn();
    const ui = renderTui(<Form fields={FIELDS} initialValues={{ name: 'Fix' }} onSubmit={onSubmit} />);
    await ui.press(KEYS.ctrlS);
    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Fix',
      points: null,
      due: null,
      blocked: false,
      priority: null,
      labels: [],
    });
    ui.unmount();
  });

  it('shows ValidationError issues next to their fields', async () => {
    const ui = renderTui(
      <Form
        fields={FIELDS}
        initialValues={{ name: 'Fix' }}
        onSubmit={() => {
          throw new ValidationError('story is invalid', {
            details: {
              issues: [
                { path: ['name'], message: 'name is already taken' },
                { path: ['customFields', 'size'], message: 'size must be one of S, M, L' },
              ],
            },
          });
        }}
      />,
    );
    await ui.press(KEYS.ctrlEnter);
    const frame = ui.lastFrame() ?? '';
    expect(frame).toMatch(/Name\*\s+Fix\s*\n\s+name is already taken/);
    expect(frame).toContain('size must be one of S, M, L');
    ui.unmount();
  });

  it('shows any other error from submit as a toast', async () => {
    const screens = {
      a: () => (
        <Form
          fields={[{ name: 'id', label: 'Id', kind: 'text' }]}
          onSubmit={() => Promise.reject(new ConflictError('board "web" already exists'))}
        />
      ),
    };
    const app = renderApp(screens);
    await app.press(KEYS.ctrlEnter);
    expect(app.lastFrame()).toContain('error: board "web" already exists');
    app.unmount();
  });

  it('moves to the next field with enter and tab, back with shift+tab, and saves with enter on Save', async () => {
    const onSubmit = vi.fn();
    const ui = renderTui(
      <Form
        fields={[
          { name: 'name', label: 'Name', kind: 'text' },
          { name: 'points', label: 'Points', kind: 'number' },
        ]}
        onSubmit={onSubmit}
      />,
    );
    await ui.press('a', KEYS.enter, '1', KEYS.shiftTab, 'b', KEYS.tab, '2', KEYS.tab);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(ui.lastFrame()).toContain('enter save');
    await ui.press(KEYS.enter);
    expect(onSubmit).toHaveBeenCalledWith({ name: 'ab', points: 12 });
    ui.unmount();
  });

  it('edits text at the caret', async () => {
    const onSubmit = vi.fn();
    const ui = renderTui(
      <Form
        fields={[{ name: 'name', label: 'Name', kind: 'text' }]}
        initialValues={{ name: 'Fx' }}
        onSubmit={onSubmit}
      />,
    );
    await ui.press(KEYS.left, 'i', KEYS.home, '[', KEYS.end, ']', KEYS.ctrlS);
    expect(onSubmit).toHaveBeenCalledWith({ name: '[Fix]' });
    ui.unmount();
  });

  it('edits multiline fields in place: enter starts a line, ↑/↓ leave from the edges', async () => {
    const onSubmit = vi.fn();
    const ui = renderTui(
      <Form
        fields={[
          { name: 'name', label: 'Name', kind: 'text' },
          { name: 'description', label: 'Description', kind: 'multiline' },
          { name: 'points', label: 'Points', kind: 'number' },
        ]}
        initialValues={{ name: 'Fix', description: 'first line' }}
        onSubmit={onSubmit}
      />,
    );
    await ui.press(KEYS.tab, KEYS.enter, ...'second', KEYS.up, KEYS.up, KEYS.down, KEYS.down, KEYS.down, '3');
    expect(ui.lastFrame()).toMatch(/first line\s*\n\s*second/);
    await ui.press(KEYS.ctrlEnter);
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Fix', description: 'first line\nsecond', points: 3 });
    ui.unmount();
  });
});

describe('TextInput', () => {
  it('scrolls long text to keep the caret in view', async () => {
    const onChange = vi.fn();
    const ui = renderTui(<TextInput value="abcdefghij" onChange={onChange} width={4} />);
    await ui.press();
    expect(ui.lastFrame()).toBe('hij');
    await ui.press(...Array(8).fill(KEYS.left));
    expect(ui.lastFrame()).toBe('cdef');
    await ui.press(KEYS.backspace);
    expect(onChange).toHaveBeenCalledWith('acdefghij');
    ui.unmount();
  });
});

describe('TextArea', () => {
  it('wraps long lines and moves between wrapped rows with ↑/↓', async () => {
    const onLeave = vi.fn();
    function Editor() {
      const [value, setValue] = useState('abcdefgh');
      return <TextArea value={value} onChange={setValue} width={5} rows={3} onLeave={onLeave} expandable={false} />;
    }
    const ui = renderTui(<Editor />);
    await ui.press();
    expect(ui.lastFrame()?.trimEnd()).toBe('abcd\nefgh');
    await ui.press(KEYS.up, 'x');
    expect(ui.lastFrame()?.trimEnd()).toBe('abcd\nxefg\nh');
    await ui.press(KEYS.up, KEYS.up);
    expect(onLeave).toHaveBeenCalledWith(-1);
    ui.unmount();
  });
});

describe('TextArea full screen', () => {
  function Notes({ onValue }: { onValue?(value: string): void }) {
    const [value, setValue] = useState('');
    return (
      <TextArea
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
        width={30}
        rows={3}
        title="Notes"
      />
    );
  }

  it('opens with ctrl+f, edits in a titled modal and keeps the text when closed with esc', async () => {
    const onValue = vi.fn();
    const ui = renderTui(<Notes onValue={onValue} />);
    await waitForFrame(ui, '[Full screen] ctrl+f');
    await ui.press(KEYS.ctrlF);
    await waitForFrame(ui, (f) => f.includes('Notes') && f.includes('esc/ctrl+f close') && f.includes('✕'));
    await ui.press('one', KEYS.enter, 'two');
    expect(onValue).toHaveBeenLastCalledWith('one\ntwo');
    await ui.press(KEYS.escape);
    const frame = await waitForFrame(ui, (f) => !f.includes('esc/ctrl+f close'));
    expect(frame).toMatch(/one\s*\ntwo/);
    expect(frame).toContain('[Full screen]');
    // The text box takes keys again.
    await ui.press('!');
    expect(onValue).toHaveBeenLastCalledWith(expect.stringMatching(/!/));
    ui.unmount();
  });

  it('covers the screen in the shell, and esc closes it without leaving the screen', async () => {
    const onSubmit = vi.fn();
    function Opener() {
      const router = useRouter();
      useInput((input) => input === 'n' && router.push('b'), { isActive: useIsActive() });
      return <Text>Screen A</Text>;
    }
    const screens = {
      a: Opener,
      b: () => <Form fields={[{ name: 'description', label: 'Description', kind: 'multiline' }]} onSubmit={onSubmit} />,
    };
    const app = renderApp(screens);
    await app.press('n');
    await waitForFrame(app, (f) => f.includes('Save') && f.includes('ctrl+f full screen'));
    await app.press(KEYS.ctrlF);
    await waitForFrame(app, (f) => f.includes('Description') && f.includes('esc/ctrl+f close') && !f.includes('Save'));
    // The form below takes no keys: `tab` is not a field move and `ctrl+s` does not save.
    await app.press('Hello', KEYS.tab, KEYS.ctrlS);
    expect(onSubmit).not.toHaveBeenCalled();
    await app.press(KEYS.escape);
    await waitForFrame(app, (f) => f.includes('Save') && f.includes('Hello') && !f.includes('esc/ctrl+f close'));
    await app.press(KEYS.ctrlS);
    expect(onSubmit).toHaveBeenCalledWith({ description: 'Hello' });
    app.unmount();
  });

  it('opens from its button and closes from the ✕ in the border with a click', async () => {
    const mouse = new EventEmitter();
    const app = renderTui(
      <App
        ctx={null}
        services={null}
        initial={{ screen: 'a', params: {} }}
        screens={{ a: () => <Notes /> }}
        toasts={createToastStore()}
        mouse={mouse}
      />,
    );
    const click = async (text: string) => {
      const lines = (app.lastFrame() ?? '').split('\n');
      const y = lines.findIndex((line) => line.includes(text));
      mouse.emit('mouse', { kind: 'press', x: lines[y]?.indexOf(text) ?? -1, y });
      mouse.emit('mouse', { kind: 'release', x: lines[y]?.indexOf(text) ?? -1, y });
      await tick();
    };
    await waitForFrame(app, '[Full screen]');
    // Click targets register in effects, which can trail the first frame on a busy machine.
    await tick(200);
    await click('[Full screen]');
    await waitForFrame(app, 'esc/ctrl+f close');
    await app.press('kept');
    await tick(200);
    await click('✕');
    const frame = await waitForFrame(app, (f) => f.includes('[Full screen]') && !f.includes('esc/ctrl+f close'));
    expect(frame).toContain('kept');
    app.unmount();
  });
});

describe('TextArea blank lines and fast keys', () => {
  function Editor({ initial, onValue }: { initial: string; onValue?(value: string): void }) {
    const [value, setValue] = useState(initial);
    return (
      <TextArea
        value={value}
        onChange={(next) => {
          setValue(next);
          onValue?.(next);
        }}
        width={20}
        rows={6}
      />
    );
  }

  it('keeps a row for every blank line, wherever the caret is', async () => {
    const ui = renderTui(<Editor initial={'one\n\n\ntwo'} />);
    await ui.press();
    expect(
      ui
        .lastFrame()
        ?.split('\n')
        .slice(0, 4)
        .map((l) => l.trimEnd()),
    ).toEqual(['one', '', '', 'two']);
    await ui.press(KEYS.up);
    expect(
      ui
        .lastFrame()
        ?.split('\n')
        .slice(0, 4)
        .map((l) => l.trimEnd()),
    ).toEqual(['one', '', '', 'two']);
    ui.unmount();
  });

  it('applies keys that arrive before a re-render', async () => {
    const onValue = vi.fn();
    const ui = renderTui(<Editor initial="" onValue={onValue} />);
    await ui.press();
    for (const key of ['a', KEYS.enter, KEYS.enter, 'b']) ui.stdin.write(key);
    await ui.press();
    expect(onValue).toHaveBeenLastCalledWith('a\n\nb');
    ui.unmount();
  });
});

describe('ConfirmDialog', () => {
  const setup = () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const ui = renderTui(<ConfirmDialog message="Delete story WEB-42?" onConfirm={onConfirm} onCancel={onCancel} />);
    return { ui, onConfirm, onCancel };
  };

  it('confirms with y and with enter on the confirm button', async () => {
    const { ui, onConfirm, onCancel } = setup();
    expect(ui.lastFrame()).toContain('Delete story WEB-42?');
    await ui.press('y');
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await ui.press(KEYS.left, KEYS.enter);
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onCancel).not.toHaveBeenCalled();
    ui.unmount();
  });

  it('cancels with n, esc and enter by default', async () => {
    const { ui, onConfirm, onCancel } = setup();
    await ui.press('n', KEYS.escape, KEYS.enter);
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).not.toHaveBeenCalled();
    ui.unmount();
  });

  it('keeps esc from reaching the shell', async () => {
    const onCancel = vi.fn();
    function Opener() {
      const router = useRouter();
      useInput((input) => input === 'n' && router.push('b'), { isActive: useIsActive() });
      return <Text>Screen A</Text>;
    }
    const screens = {
      a: Opener,
      b: () => <ConfirmDialog message="Sure?" onConfirm={() => {}} onCancel={onCancel} />,
    };
    const app = renderApp(screens);
    await app.press('n', KEYS.escape);
    expect(onCancel).toHaveBeenCalledTimes(1);
    // Still on b: the shell did not go back.
    expect(app.lastFrame()).toContain('Sure?');
    app.unmount();
  });
});

describe('DetailView and StageBadge', () => {
  it('renders rows and a markdown body as plain text', () => {
    const ui = renderTui(
      <DetailView
        rows={[
          { label: 'Key', value: 'WEB-1' },
          { label: 'Stage', value: <StageBadge stage={{ name: 'Done', category: 'done' }} /> },
        ]}
        body={'# Title\nSome **bold** and `code`, see [docs](https://x.dev).'}
      />,
    );
    const frame = ui.lastFrame() ?? '';
    expect(frame).toMatch(/Key\s+WEB-1/);
    expect(frame).toContain('● Done');
    expect(frame).toContain('Title\nSome bold and code, see docs (https://x.dev).');
    ui.unmount();
  });

  it('strips list markers', () => {
    expect(markdownToPlain('- one\n  * two')).toBe('• one\n  • two');
  });
});
