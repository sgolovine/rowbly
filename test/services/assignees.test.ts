import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../src/core';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { fixedClock, fixedIds, makeBoard, makeRootConfig, makeStory, type TempRoot, tempRoot } from '../helpers';

function contextFor(t: TempRoot, warnings: string[] = []): RowblyContext {
  return {
    root: t.root,
    local: { version: 1 },
    me: null,
    now: fixedClock().now,
    newId: fixedIds(),
    warn: (message) => warnings.push(message),
  };
}

describe('assignees service', () => {
  it('adds, lists and updates Assignees', async () => {
    const t = await tempRoot();
    const { assignees } = createServices(contextFor(t));
    expect(await assignees.list()).toEqual([]);
    expect(await assignees.add({ handle: 'sam', name: 'Sam', email: 'sam@example.com' })).toEqual({
      handle: 'sam',
      name: 'Sam',
      email: 'sam@example.com',
    });
    await assignees.add({ handle: 'ana', name: 'Ana', email: '' });
    expect(await assignees.list()).toEqual([
      { handle: 'sam', name: 'Sam', email: 'sam@example.com' },
      { handle: 'ana', name: 'Ana' },
    ]);
    expect(await assignees.update('sam', { name: 'Samantha' })).toEqual({
      handle: 'sam',
      name: 'Samantha',
      email: 'sam@example.com',
    });
    expect(await assignees.update('sam', { email: null })).toEqual({ handle: 'sam', name: 'Samantha' });
    expect(await assignees.update('ana', { email: 'ana@example.com' })).toMatchObject({
      email: 'ana@example.com',
    });
  });

  it('stores the roster in rowbly.config.json, keeping the global Stages', async () => {
    const t = await tempRoot();
    await makeRootConfig(t.path, { stages: [{ key: 'open', name: 'Open', category: 'todo' }] });
    await createServices(contextFor(t)).assignees.add({ handle: 'sam', name: 'Sam' });
    const file = JSON.parse(await readFile(join(t.path, 'rowbly.config.json'), 'utf8'));
    expect(file).toEqual({
      version: 1,
      assignees: [{ handle: 'sam', name: 'Sam' }],
      stages: [{ key: 'open', name: 'Open', category: 'todo' }],
    });
  });

  it('refuses duplicate handles, invalid emails and unknown Assignees', async () => {
    const t = await tempRoot();
    await makeRootConfig(t.path, { assignees: [{ handle: 'sam', name: 'Sam' }] });
    const { assignees } = createServices(contextFor(t));
    await expect(assignees.add({ handle: 'sam', name: 'Other' })).rejects.toThrow(ConflictError);
    const badEmail = assignees.add({ handle: 'ana', name: 'Ana', email: 'not-an-email' });
    await expect(badEmail).rejects.toThrow(ValidationError);
    await expect(badEmail).rejects.toMatchObject({ details: { issues: [{ path: ['email'] }] } });
    await expect(assignees.update('sam', { email: 'nope' })).rejects.toThrow(ValidationError);
    await expect(assignees.add({ handle: 'Bad Handle', name: 'x' })).rejects.toThrow(ValidationError);
    await expect(assignees.update('ghost', { name: 'x' })).rejects.toThrow(NotFoundError);
    await expect(assignees.remove('ghost')).rejects.toThrow(NotFoundError);
  });

  it('remove strips the handle from every Story on every Board and warns with the count', async () => {
    const t = await tempRoot();
    await makeRootConfig(t.path, {
      assignees: [
        { handle: 'sam', name: 'Sam' },
        { handle: 'ana', name: 'Ana' },
      ],
    });
    await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
    await makeBoard(t.path, { id: 'api', keyPrefix: 'API' });
    await makeStory(t.path, { key: 'WEB-1', boardId: 'web', assignees: ['sam', 'ana'] });
    await makeStory(t.path, { key: 'WEB-2', boardId: 'web', assignees: ['ana'] });
    await makeStory(t.path, { key: 'API-1', boardId: 'api', assignees: ['sam'] });
    const warnings: string[] = [];
    const clock = fixedClock();
    clock.advance(1000);
    const { assignees } = createServices({ ...contextFor(t, warnings), now: clock.now });

    expect(await assignees.remove('sam')).toEqual({ storiesUpdated: 2 });
    expect(warnings).toEqual(['Assignee "sam" removed from 2 stories']);
    expect((await assignees.list()).map((a) => a.handle)).toEqual(['ana']);

    const repos = createRepositories(t.root);
    expect(await repos.stories.findByKey('WEB-1')).toMatchObject({
      assignees: ['ana'],
      updatedAt: '2026-10-12T17:21:08.000Z',
    });
    expect((await repos.stories.findByKey('WEB-2')).updatedAt).toBe('2026-10-12T17:21:07.000Z');
    expect((await repos.stories.findByKey('API-1')).assignees).toEqual([]);

    await assignees.add({ handle: 'bob', name: 'Bob' });
    await makeStory(t.path, { key: 'API-2', boardId: 'api', assignees: ['bob'] });
    expect(await assignees.remove('bob')).toEqual({ storiesUpdated: 1 });
    expect(warnings.at(-1)).toBe('Assignee "bob" removed from 1 story');
  });
});
