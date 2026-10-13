import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RowblyConfigSchema, StorySchema } from '../src/schemas';
import { FIXED_NOW, fixedClock, fixedIds, makeBoard, makeEpic, makeStory, makeWorkspace, tempRoot } from './helpers';

describe('test helpers', () => {
  it('fixedClock only moves when told to', () => {
    const clock = fixedClock();
    expect(clock.now().toISOString()).toBe(FIXED_NOW);
    clock.advance(1000);
    expect(clock.now().toISOString()).toBe('2026-10-12T17:21:08.000Z');
  });

  it('fixedIds yields deterministic 8-character ids', () => {
    const next = fixedIds();
    expect([next(), next()]).toEqual(['id000001', 'id000002']);
  });

  it('tempRoot creates a Data Root and builders write valid files at layout paths', async () => {
    const { path } = await tempRoot();
    RowblyConfigSchema.parse(JSON.parse(await readFile(join(path, 'rowbly.config.json'), 'utf8')));

    await makeWorkspace(path, { id: 'acme', assignees: [{ handle: 'sam', name: 'Sam' }] });
    await makeBoard(path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    await makeEpic(path, { id: 'auth', workspaceId: 'acme' });
    await makeStory(path, { key: 'WEB-1', workspaceId: 'acme', boardId: 'web', epicId: 'auth' });

    const storyFile = join(path, 'workspaces/acme/boards/web/stories/WEB-1.json');
    const text = await readFile(storyFile, 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "version": 1,');
    expect(StorySchema.parse(JSON.parse(text)).epicId).toBe('auth');
    await expect(readFile(join(path, 'workspaces/acme/workspace.config.json'), 'utf8')).resolves.toContain('"sam"');
    await expect(readFile(join(path, 'workspaces/acme/boards/web/board.config.json'), 'utf8')).resolves.toContain(
      '"WEB"',
    );
    await expect(readFile(join(path, 'workspaces/acme/epics/auth.json'), 'utf8')).resolves.toContain('"auth"');
  });
});
