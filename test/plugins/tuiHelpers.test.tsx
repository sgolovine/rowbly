import { describe, expect, it } from 'vitest';
import { makeBoard } from '../helpers';
import { waitForFrame } from '../tui/helpers';
import { notes } from './fixtures';
import { pluginRoot } from './helpers';
import { focusFormField, focusListItem, openPluginApp } from './tuiHelpers';

describe('TUI navigation helpers', () => {
  it('fail with the last frame when the field or item is not on screen', async () => {
    const t = await pluginRoot({ notes: true });
    const form = await openPluginApp(t, [notes], { screen: 'story-form', params: { boardId: 'web' } });
    await waitForFrame(form.app, 'Note');
    await expect(focusFormField(form.app, 'Missing')).rejects.toThrow(/no form field "Missing".*last frame:\n.*Note/s);
    form.app.unmount();
    // With a second Board, the App opens on the home menu.
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    const home = await openPluginApp(t, [notes], { screen: 'home', params: {} });
    await waitForFrame(home.app, 'Notes');
    await expect(focusListItem(home.app, 'Missing')).rejects.toThrow(/no list item "Missing".*Doctor/s);
    home.app.unmount();
  });
});
