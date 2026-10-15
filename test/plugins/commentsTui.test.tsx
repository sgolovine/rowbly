import { describe, expect, it } from 'vitest';
import { comments } from '../../src/plugins/comments';
import { createRepositories } from '../../src/storage';
import type { RouteParams } from '../../src/tui/router';
import { fixedClock, makeStory } from '../helpers';
import { KEYS, waitForFrame } from '../tui/helpers';
import { readCommentThread } from './commentsHelpers';
import { pluginRoot } from './helpers';
import { openPluginApp } from './tuiHelpers';

/** The App over a Data Root with the Comments Plugin on and Me set to alice, opened on `screen`. */
async function open(screen: string, params: RouteParams) {
  const t = await pluginRoot({ comments: true });
  await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Login', assignees: ['alice'] });
  const clock = fixedClock();
  const { app, services } = await openPluginApp(t, [comments], { screen, params }, { me: 'alice', now: clock.now });
  await waitForFrame(app, (frame) => !frame.includes('Loading'));
  const story = () => createRepositories(t.root).stories.findByKey('WEB-1');
  const thread = (task?: number) => readCommentThread(t, 'WEB-1', task);
  return { app, services, clock, story, thread };
}

describe('Comments TUI', () => {
  it('adds, edits and deletes a Comment on the Story screen tab', async () => {
    const { app, clock, story, thread } = await open('story', { key: 'WEB-1' });
    await app.press(KEYS.tab, KEYS.tab);
    await waitForFrame(app, (f) => f.includes('No Comments yet'));

    await app.press('c');
    await waitForFrame(app, (f) => f.includes('New Comment on WEB-1') && f.includes('Comment*'));
    // An empty Comment is refused in the form.
    await app.press(KEYS.ctrlEnter);
    await waitForFrame(app, 'required');
    await app.press(...'first line', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('Added Comment') && f.includes('alice · just now'));
    expect(app.lastFrame()).toContain('first line');
    expect(await thread()).toMatchObject([{ id: 'id000001', author: 'alice', body: 'first line' }]);

    clock.advance(5 * 60_000);
    await app.press('e');
    await waitForFrame(app, (f) => f.includes('Edit Comment on WEB-1') && f.includes('first line'));
    // `enter` starts a new line in the Comment.
    await app.press(KEYS.enter, ...'second line', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('Updated Comment') && f.includes('alice · 5m ago (edited)'));
    expect((await thread())[0]?.body).toBe('first line\nsecond line');

    await app.press('d');
    await waitForFrame(app, (f) => f.includes('Delete the Comment by alice?'));
    await app.press('y');
    await waitForFrame(app, (f) => f.includes('Deleted Comment') && f.includes('No Comments yet'));
    expect(await thread()).toEqual([]);
    expect((await story()).name).toBe('Login');
    app.unmount();
  });

  it('keeps a Task’s Comments on a tab of the Task screen, with a count on Details', async () => {
    const { app, services, thread } = await open('story', { key: 'WEB-1' });
    await services.tasks.create('WEB-1', { name: 'Old' });
    await app.press(KEYS.tab);
    await waitForFrame(app, (f) => f.includes('WEB-1.1 Old'));
    await app.press(KEYS.enter);
    await waitForFrame(app, (f) => f.includes('alice (from the Story)') && /Comments\s+0/.test(f));
    // Comments are on their own tab, so `e` and `d` on Details act on the Task.
    await app.press(KEYS.tab);
    await waitForFrame(app, (f) => f.includes('No Comments yet. Press c to add one.'));
    await app.press('c');
    await waitForFrame(app, (f) => f.includes('New Comment on WEB-1.1') && f.includes('Comment*'));
    await app.press(...'Looks good', KEYS.ctrlEnter);
    await waitForFrame(app, (f) => f.includes('Added Comment'));
    expect(await thread(0)).toMatchObject([{ author: 'alice', body: 'Looks good' }]);
    expect(await thread()).toEqual([]);
    app.unmount();
  });
});
