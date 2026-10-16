// RES-19 (`r10-prefix-cache`): a long-lived service instance (the TUI) finds Stories by key after
// another instance (a CLI) creates, deletes or re-prefixes Boards. A former prefix never resolves to
// a Board that has changed, and a failed prefix lookup can be retried.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DataIntegrityError, NotFoundError } from '../../src/core';
import { BoardConfigSchema } from '../../src/schemas';
import { createRepositories } from '../../src/storage';
import { makeBoard, makeStory, writeFixture } from '../helpers';
import { pluginRoot, withPlugins } from '../plugins/helpers';

describe('Story lookup by key across service instances', () => {
  it('finds a Story on a Board another instance created (r10)', async () => {
    const t = await pluginRoot();
    const tui = await withPlugins(t, []);
    await tui.services.stories.get('WEB-9').catch(() => undefined); // warms the prefix lookup
    const cli = await withPlugins(t, []);
    await cli.services.boards.create({ id: 'api', name: 'API', keyPrefix: 'API' });
    await cli.services.stories.create('api', { name: 'New on API' });

    expect((await tui.services.stories.get('api-1')).name).toBe('New on API');
    expect((await tui.services.stories.create('api', { name: 'From TUI' })).key).toBe('API-2');
  });

  it('stops finding Stories of a Board another instance deleted', async () => {
    const t = await pluginRoot();
    await makeBoard(t.path, { id: 'api', name: 'API', keyPrefix: 'API' });
    await makeStory(t.path, { boardId: 'api', key: 'API-1' });
    const tui = await withPlugins(t, []);
    expect((await tui.services.stories.get('API-1')).key).toBe('API-1');
    const cli = await withPlugins(t, []);
    await cli.services.boards.remove('api', { force: true });
    await expect(tui.services.stories.get('API-1')).rejects.toThrow(NotFoundError);
  });

  it('never resolves a former prefix to the Board that changed it', async () => {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', name: 'Old web' });
    const repos = createRepositories(t.root);
    expect((await repos.stories.findByKey('WEB-1')).name).toBe('Old web');

    // Edited by hand or by another process: `web` takes prefix SITE, and a new Board takes WEB.
    const web = await repos.boards.get('web');
    await writeFixture(join(t.path, 'boards/web/board.config.json'), BoardConfigSchema, { ...web, keyPrefix: 'SITE' });
    await makeBoard(t.path, { id: 'www', name: 'WWW', keyPrefix: 'WEB' });
    await makeStory(t.path, { boardId: 'www', key: 'WEB-1', name: 'New www' });

    expect((await repos.stories.findByKey('WEB-1')).name).toBe('New www');
    expect(await repos.boards.findByPrefix('WEB')).toMatchObject({ id: 'www' });
  });

  it('can be retried after the prefix lookup failed', async () => {
    const t = await pluginRoot();
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const repos = createRepositories(t.root);
    const config = join(t.path, 'boards/web/board.config.json');
    const good = await repos.boards.get('web');
    await writeFile(config, '{ not json');
    await expect(repos.stories.findByKey('WEB-1')).rejects.toThrow(DataIntegrityError);
    await writeFixture(config, BoardConfigSchema, good);
    expect((await repos.stories.findByKey('WEB-1')).key).toBe('WEB-1');
  });
});
