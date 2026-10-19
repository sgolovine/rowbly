// The Ink screen-test recipe of src/plugin-api/testing.ts, run as written: a Plugin's screen
// rendered alone with ink-testing-library, over the harness's Data Root and context, and a `PluginUi`
// that records calls. Only the Plugin API, its harness, the Plugin and test libraries are imported.
import { render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PluginUi } from '../../src/plugin-api';
import { createPluginTestHost, type PluginTestHost } from '../../src/plugin-api/testing';
import { type NotesSettings, notes } from './fixtures/notes';
import { notesTui } from './fixtures/notesTui';

let host: PluginTestHost | undefined;
afterEach(async () => {
  await host?.dispose();
  host = undefined;
});

const recordingUi = (): PluginUi => ({
  open: vi.fn(),
  openStory: vi.fn(),
  openBoard: vi.fn(),
  back: vi.fn(),
  toast: vi.fn(),
  error: vi.fn(),
});

describe('the Ink screen-test recipe', () => {
  it('renders a Plugin screen over the harness and waits for its data', async () => {
    host = await createPluginTestHost({ plugins: [notes] });
    await host.services.stories.create('web', { name: 'Login', plugins: { notes: { note: 'remember' } } });
    const NoteScreen = notesTui.screens?.note;
    if (!NoteScreen) throw new Error('the Notes fixture has no note screen');
    const ui = recordingUi();
    const { lastFrame, unmount } = render(
      <NoteScreen params={{ key: 'WEB-1' }} plugin={host.context<NotesSettings>('notes')} ui={ui} />,
    );
    await vi.waitFor(() => expect(lastFrame()).toContain('Note of WEB-1: remember'));
    unmount();
    expect(ui.error).not.toHaveBeenCalled();
  });
});
