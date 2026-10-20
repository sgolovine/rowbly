import { expect, it } from 'vitest';
import { comments } from '../../src/plugins/comments';
import { makeStory } from '../helpers';
import { KEYS, waitForFrame } from '../tui/helpers';
import { pluginRoot } from './helpers';
import { openPluginApp } from './tuiHelpers';

it('opens the new Comment form with `n` on the Comments tab, as `n` creates on every screen', async () => {
  const t = await pluginRoot({ comments: true });
  await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Login' });
  const { app } = await openPluginApp(t, [comments], { screen: 'story', params: { key: 'WEB-1' } });
  await waitForFrame(app, (f) => f.includes('move Stage') && f.includes('Login'));
  await app.press(KEYS.tab);
  const tab = await waitForFrame(app, (f) => f.includes('No Comments yet') && f.includes('new Comment'));
  expect(tab).toContain('Press n to add one');
  await app.press('n');
  await waitForFrame(app, (f) => f.includes('New Comment on WEB-1') && f.includes('Comment*'));
});
