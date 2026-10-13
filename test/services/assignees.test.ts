import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../src/core';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { fixedClock, fixedIds, makeBoard, makeStory, makeWorkspace, type TempRoot, tempRoot } from '../helpers';

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
    await makeWorkspace(t.path, { id: 'acme' });
    const { assignees } = createServices(contextFor(t));
    expect(await assignees.add('acme', { handle: 'sam', name: 'Sam', email: 'sam@example.com' })).toEqual({
      handle: 'sam',
      name: 'Sam',
      email: 'sam@example.com',
    });
    await assignees.add('acme', { handle: 'ana', name: 'Ana', email: '' });
    expect(await assignees.list('acme')).toEqual([
      { handle: 'sam', name: 'Sam', email: 'sam@example.com' },
      { handle: 'ana', name: 'Ana' },
    ]);
    expect(await assignees.update('acme', 'sam', { name: 'Samantha' })).toEqual({
      handle: 'sam',
      name: 'Samantha',
      email: 'sam@example.com',
    });
    expect(await assignees.update('acme', 'sam', { email: null })).toEqual({ handle: 'sam', name: 'Samantha' });
    expect(await assignees.update('acme', 'ana', { email: 'ana@example.com' })).toMatchObject({
      email: 'ana@example.com',
    });
  });

  it('refuses duplicate handles, invalid emails and unknown Assignees', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, { id: 'acme', assignees: [{ handle: 'sam', name: 'Sam' }] });
    await makeWorkspace(t.path, { id: 'labs' });
    const { assignees } = createServices(contextFor(t));
    await expect(assignees.add('acme', { handle: 'sam', name: 'Other' })).rejects.toThrow(ConflictError);
    // Handles are unique per Workspace only.
    await assignees.add('labs', { handle: 'sam', name: 'Sam' });
    const badEmail = assignees.add('acme', { handle: 'ana', name: 'Ana', email: 'not-an-email' });
    await expect(badEmail).rejects.toThrow(ValidationError);
    await expect(badEmail).rejects.toMatchObject({ details: { issues: [{ path: ['email'] }] } });
    await expect(assignees.update('acme', 'sam', { email: 'nope' })).rejects.toThrow(ValidationError);
    await expect(assignees.add('acme', { handle: 'Bad Handle', name: 'x' })).rejects.toThrow(ValidationError);
    await expect(assignees.update('acme', 'ghost', { name: 'x' })).rejects.toThrow(NotFoundError);
    await expect(assignees.remove('acme', 'ghost')).rejects.toThrow(NotFoundError);
    await expect(assignees.list('nope')).rejects.toThrow(NotFoundError);
  });

  it('remove strips the handle from every Story in the Workspace and warns with the count', async () => {
    const t = await tempRoot();
    await makeWorkspace(t.path, {
      id: 'acme',
      assignees: [
        { handle: 'sam', name: 'Sam' },
        { handle: 'ana', name: 'Ana' },
      ],
    });
    await makeWorkspace(t.path, { id: 'labs', assignees: [{ handle: 'sam', name: 'Sam' }] });
    await makeBoard(t.path, { id: 'web', workspaceId: 'acme', keyPrefix: 'WEB' });
    await makeBoard(t.path, { id: 'api', workspaceId: 'acme', keyPrefix: 'API' });
    await makeBoard(t.path, { id: 'ml', workspaceId: 'labs', keyPrefix: 'ML' });
    await makeStory(t.path, { key: 'WEB-1', workspaceId: 'acme', boardId: 'web', assignees: ['sam', 'ana'] });
    await makeStory(t.path, { key: 'WEB-2', workspaceId: 'acme', boardId: 'web', assignees: ['ana'] });
    await makeStory(t.path, { key: 'API-1', workspaceId: 'acme', boardId: 'api', assignees: ['sam'] });
    await makeStory(t.path, { key: 'ML-1', workspaceId: 'labs', boardId: 'ml', assignees: ['sam'] });
    const warnings: string[] = [];
    const clock = fixedClock();
    clock.advance(1000);
    const { assignees } = createServices({ ...contextFor(t, warnings), now: clock.now });

    expect(await assignees.remove('acme', 'sam')).toEqual({ storiesUpdated: 2 });
    expect(warnings).toEqual(['Assignee "sam" removed from 2 stories']);
    expect((await assignees.list('acme')).map((a) => a.handle)).toEqual(['ana']);

    const repos = createRepositories(t.root);
    expect(await repos.stories.findByKey('WEB-1')).toMatchObject({
      assignees: ['ana'],
      updatedAt: '2026-10-12T17:21:08.000Z',
    });
    expect((await repos.stories.findByKey('WEB-2')).updatedAt).toBe('2026-10-12T17:21:07.000Z');
    expect((await repos.stories.findByKey('API-1')).assignees).toEqual([]);
    // Other Workspaces are untouched.
    expect((await repos.stories.findByKey('ML-1')).assignees).toEqual(['sam']);

    expect(await assignees.remove('acme', 'ana')).toEqual({ storiesUpdated: 2 });
    expect(await assignees.remove('labs', 'sam')).toEqual({ storiesUpdated: 1 });
    expect(warnings.at(-1)).toBe('Assignee "sam" removed from 1 story');
  });
});
