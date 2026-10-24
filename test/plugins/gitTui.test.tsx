import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { git } from '../../src/plugins/git';
import { KEYS, waitForFrame } from '../tui/helpers';
import { pluginRoot } from './helpers';
import { focusFormField, focusListItem, openPluginApp } from './tuiHelpers';

it('shows Git settings only when loaded and saves frequency, interval and author as personal preferences', async () => {
  const t = await pluginRoot({ git: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: t.dir });
  execFileSync('git', ['config', 'user.name', 'Default Author'], { cwd: t.dir });
  execFileSync('git', ['config', 'user.email', 'default@example.com'], { cwd: t.dir });
  const { app } = await openPluginApp(t, [git], { screen: 'settings', params: {} });
  await waitForFrame(app, 'Global');
  await focusListItem(app, 'Git');
  await waitForFrame(
    app,
    (f) => f.includes('Git automatic commits') && f.includes('default@example.com') && f.includes('Frequency*'),
  );
  await app.press(KEYS.tab);
  await app.press(KEYS.down);
  await focusFormField(app, 'Frequency');
  await app.press(KEYS.right);
  await app.press(KEYS.down);
  await focusFormField(app, 'Interval (seconds, 1–86400)');
  await app.press(
    KEYS.home,
    KEYS.right,
    KEYS.backspace,
    KEYS.right,
    KEYS.backspace,
    KEYS.right,
    KEYS.backspace,
    ...'600',
  );
  await focusFormField(app, 'Author name');
  await app.press(...'Robot');
  await focusFormField(app, 'Author email');
  await app.press(...'robot@example.com', KEYS.ctrlS);
  await waitForFrame(app, 'Updated Git commit preferences');
  const local = JSON.parse(await readFile(join(t.path, 'local.json'), 'utf8'));
  expect(local.plugins.git).toEqual({
    automaticCommits: true,
    synchronization: { enabled: false, intervalSeconds: 300 },
    frequency: 'interval',
    intervalSeconds: 600,
    authorName: 'Robot',
    authorEmail: 'robot@example.com',
  });
});

it('has no Git settings section when Git is disabled', async () => {
  const t = await pluginRoot();
  const { app } = await openPluginApp(t, [git], { screen: 'settings', params: {} });
  const frame = await waitForFrame(app, 'Global');
  expect(frame).not.toMatch(/▌? Git\s/);
});
