import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '../../src/core';
import { createServices, type RowblyContext } from '../../src/services';
import { createRepositories } from '../../src/storage';
import { fixedClock, fixedIds, makeBoard, makeRootConfig, makeStory, tempRoot } from '../helpers';

const web = 'web';

async function setup(me: string | null = 'alice') {
  const t = await tempRoot();
  await makeRootConfig(t.path, { assignees: [{ handle: 'alice', name: 'Alice' }] });
  await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
  await makeStory(t.path, { boardId: web, key: 'WEB-1' });
  const clock = fixedClock();
  const ctx: RowblyContext = {
    root: t.root,
    local: { version: 1 },
    me,
    now: clock.now,
    newId: fixedIds(),
    warn: () => {},
  };
  const services = createServices(ctx);
  await services.tasks.create('WEB-1', { name: 'Task' });
  return { clock, services, repos: createRepositories(t.root) };
}

describe('comments', () => {
  it('adds to the Story or to a Task by target, authored by Me', async () => {
    const { services, repos } = await setup();
    const onStory = await services.comments.add('web-1', 'on the story');
    const onTask = await services.comments.add('web-1.1', 'on the task');
    expect(onStory).toEqual({
      id: 'id000001',
      author: 'alice',
      body: 'on the story',
      createdAt: '2026-10-12T17:21:07.000Z',
      updatedAt: '2026-10-12T17:21:07.000Z',
    });
    const story = await repos.stories.findByKey('WEB-1');
    expect(story.comments).toEqual([onStory]);
    expect(story.tasks[0]?.comments).toEqual([onTask]);
  });

  it('has no author when Me is unset or not in the roster', async () => {
    for (const me of [null, 'stranger']) {
      const { services } = await setup(me);
      expect((await services.comments.add('WEB-1', 'hi')).author).toBeNull();
    }
  });

  it('rejects an empty body', async () => {
    const { services } = await setup();
    await expect(services.comments.add('WEB-1', '  \n')).rejects.toBeInstanceOf(ValidationError);
    const comment = await services.comments.add('WEB-1', 'hi');
    await expect(services.comments.update('WEB-1', comment.id, '')).rejects.toBeInstanceOf(ValidationError);
  });

  it('lists oldest first, edits with a new updatedAt, and deletes', async () => {
    const { services, clock } = await setup();
    const first = await services.comments.add('WEB-1.1', 'first');
    clock.advance(1000);
    const second = await services.comments.add('WEB-1.1', 'second');
    expect((await services.comments.list('WEB-1.1')).map((c) => c.body)).toEqual(['first', 'second']);
    clock.advance(1000);
    const edited = await services.comments.update('WEB-1.1', first.id, 'changed');
    expect(edited).toMatchObject({
      body: 'changed',
      createdAt: '2026-10-12T17:21:07.000Z',
      updatedAt: '2026-10-12T17:21:09.000Z',
    });
    await services.comments.remove('WEB-1.1', second.id);
    expect(await services.comments.list('WEB-1.1')).toEqual([edited]);
    expect(await services.comments.list('WEB-1')).toEqual([]);
  });

  it('throws NotFoundError for an unknown Comment, Task or Story', async () => {
    const { services } = await setup();
    await expect(services.comments.remove('WEB-1', 'nope0000')).rejects.toBeInstanceOf(NotFoundError);
    await expect(services.comments.add('WEB-1.9', 'x')).rejects.toBeInstanceOf(NotFoundError);
    await expect(services.comments.list('WEB-9')).rejects.toBeInstanceOf(NotFoundError);
  });
});
