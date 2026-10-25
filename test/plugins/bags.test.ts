import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRepositories } from '../../src/storage';
import { makeBoard, makeStory } from '../helpers';
import { notes } from './fixtures';
import { pluginRoot, readJsonFile, storyFile, withPlugins } from './helpers';

/** The bag of a Plugin that this Rowbly version does not know. */
const GHOST = { ghost: { deep: { list: [1, 2] }, flag: true } };

/** Every kind of record, each with a ghost bag; Notes is off. */
async function bagged() {
  const t = await pluginRoot(
    {},
    {
      customFields: [{ key: 'size', name: 'Size', type: 'text', required: false }],
      plugins: { ghost: { enabled: false, setting: 1 }, notes: { enabled: false, marker: 'm' } },
    },
  );
  await makeBoard(t.path, { id: 'web', name: 'Website', keyPrefix: 'WEB', plugins: GHOST });
  await writeFile(join(t.path, 'local.json'), `${JSON.stringify({ version: 1, plugins: GHOST })}\n`);
  await makeStory(t.path, {
    boardId: 'web',
    key: 'WEB-1',
    customFields: { size: 's' },
    plugins: { ...GHOST, notes: { note: 'kept while off' } },
  });
  await makeStory(t.path, { boardId: 'web', key: 'WEB-2', rank: 'a1' });
  return t;
}

describe('Plugin Data is kept unchanged by core (ADR-0011)', () => {
  it('through every core operation, for Plugins that are off or unknown', async () => {
    const t = await bagged();
    // Local State as a run reads it from local.json.
    const local = await createRepositories(t.root).localState.get();
    const { services } = await withPlugins(t, [notes], { local });
    await services.stories.update('WEB-1', { name: 'Renamed', labels: ['x'] });
    await services.stories.move('WEB-1', 'todo');
    await services.stories.rank('WEB-1', 'bottom');
    await services.boards.update('web', { description: 'Changed' });
    await services.stages.remove({ level: 'global' }, 'in-progress', { moveTo: 'todo' });
    await services.fields.remove({ level: 'global' }, 'size');
    await services.context.use('web');
    await services.context.setMe('alice');
    await services.doctor.fix();

    const story = await readJsonFile(t, storyFile('WEB-1'));
    expect(story).toMatchObject({
      name: 'Renamed',
      stage: 'todo',
      plugins: { ...GHOST, notes: { note: 'kept while off' } },
    });

    const root = await readJsonFile(t, 'rowbly.config.json');
    expect(root.plugins).toEqual({ ghost: { enabled: false, setting: 1 }, notes: { enabled: false, marker: 'm' } });
    expect((await readJsonFile(t, 'boards/web/board.config.json')).plugins).toEqual(GHOST);
    expect(await readJsonFile(t, 'local.json')).toEqual({ version: 1, board: 'web', me: 'alice', plugins: GHOST });
  });
});

it('reconciles only supported owned formats while Off, preserves future bags and refuses out-of-scope output before saving', async () => {
  const { definePlugin, z } = await import('../../src/plugin-api');
  const { mergeData } = await import('../../src/services/plugins/mergeData');
  const t = await bagged();
  const file = (v: unknown) => ({
    data: Buffer.from(`${JSON.stringify(v)}\n`).toString('base64'),
    mode: '100644' as const,
  });
  const root = await readJsonFile(t, 'rowbly.config.json'),
    board = await readJsonFile(t, 'boards/web/board.config.json');
  const story = (await import('../../src/schemas')).StorySchema.parse(await readJsonFile(t, storyFile('WEB-1')));
  const path = storyFile('WEB-1');
  const base = {
    id: 'base',
    files: {
      'rowbly.config.json': file(root),
      'boards/web/board.config.json': file(board),
      [path]: file(story),
      'plugins/format/source.bin': file({ exact: 'original' }),
    },
  };
  const left = {
    id: 'left',
    files: {
      ...base.files,
      [path]: file({
        ...story,
        plugins: {
          ...story.plugins,
          format: { version: 1, count: 1 },
          future: { version: 100, list: ['left'], raw: null },
        },
      }),
    },
  };
  const right = {
    id: 'right',
    files: {
      ...base.files,
      [path]: file({
        ...story,
        plugins: {
          ...story.plugins,
          format: { version: 1, count: 2 },
          future: { version: 100, list: ['right'], bytes: 'unchanged' },
        },
      }),
    },
  };
  let started = 0,
    called = 0;
  const format = definePlugin({
    id: 'format',
    name: 'Format',
    description: '',
    bags: { story: z.strictObject({ version: z.literal(1), count: z.number() }) },
    start() {
      started++;
    },
    reconcile({ base, left, right, helpers, replay }) {
      called++;
      expect(Object.keys(left.bags)).toEqual(['boards/web/stories/WEB-1']);
      expect(left.bags['boards/web/stories/WEB-1']).toEqual({ version: 1, count: 1 });
      expect(() => {
        left.bags.bad = 1;
      }).toThrow();
      expect(helpers.same(right.bags['boards/web/stories/WEB-1'], { version: 1, count: 2 })).toBe(true);
      expect(replay?.base).toEqual({});
      expect(replay?.left).toEqual({ 'boards/web/stories/WEB-1': { old: 'new' } });
      const moved = base.files['plugins/format/source.bin'];
      if (!moved) throw new Error('Expected original scoped file');
      return {
        bags: { 'boards/web/stories/WEB-1': { version: 1, count: 3 } },
        files: { 'plugins/format/moved.bin': moved },
        removedFiles: ['plugins/format/source.bin'],
        identities: [{ source: 'right', scope: 'boards/web/stories/WEB-1', from: 'one', to: 'two' }],
      };
    },
  });
  const result = mergeData(base, left, right, [format], {
    left: { format: { 'boards/web/stories/WEB-1': { old: 'new' } }, other: { '': { private: 'other owner' } } },
  });
  expect(result.identities).toEqual([
    { owner: 'format', source: 'right', scope: 'boards/web/stories/WEB-1', from: 'one', to: 'two' },
  ]);
  expect(result.files['plugins/format/source.bin']).toBeUndefined();
  expect(result.files['plugins/format/moved.bin']).toEqual(base.files['plugins/format/source.bin']);
  const merged = JSON.parse(Buffer.from(result.files[path]?.data ?? '', 'base64').toString());
  expect(merged.plugins.format).toEqual({ version: 1, count: 3 });
  expect(merged.plugins.future).toMatchObject({ version: 100, raw: null, bytes: 'unchanged' });
  expect(merged.plugins.ghost).toEqual(story.plugins?.ghost);
  expect(started).toBe(0);
  expect(called).toBe(1);
  expect(result.evidence).toHaveLength(1);
  for (const reconcile of [
    () => ({ bags: {}, files: { 'plugins/other/data.json': file({ corrupt: true }) } }),
    () => ({ bags: { 'boards/missing/stories/MIS-1': {} }, files: {} }),
    () => ({ bags: {}, files: {}, requiredStories: [{ source: 'left', key: 'WEB-999' }] }),
    () => ({ bags: {}, files: {}, requiredStages: [{ source: 'left', board: 'web', key: 'missing' }] }),
    () => ({ bags: {}, files: {}, identities: [{ source: 'unknown', scope: '', from: 'a', to: 'b' }] }),
    () => ({ bags: {}, files: {}, identities: [{ source: 'left', scope: 'boards/missing', from: 'a', to: 'b' }] }),
    () => ({ bags: {}, files: {}, removedFiles: ['plugins/format/../source.bin'] }),
    () => ({ bags: {}, files: {}, removedFiles: ['plugins/other/source.bin'] }),
    () => ({ bags: {}, files: {}, removedFiles: ['plugins/format/missing.bin'] }),
    () => ({ bags: {}, files: {}, removedFiles: 'not-an-array' as unknown as string[] }),
    () => ({ bags: {}, files: {}, removedFiles: [7] as unknown as string[] }),
    () => ({ bags: {}, files: {}, removedFiles: ['plugins/format/source.bin', 'plugins/format/source.bin'] }),
    () => ({ bags: {}, files: { 'plugins/format/source.bin': file({}) }, removedFiles: ['plugins/format/source.bin'] }),
    () => {
      throw new Error('format failed');
    },
  ])
    expect(() => mergeData(base, left, right, [{ ...format, reconcile }], {})).toThrow();
  expect(() =>
    mergeData(base, left, right, [
      { ...format, reconcile: () => ({ bags: {}, files: {}, removedFiles: ['plugins/format/source.bin'] }) },
    ]),
  ).toThrow('Invalid replay file removals');
  expect(await readJsonFile(t, path)).toEqual(story);

  const { emptyReplayProjection, transportReplayData, replayProjectionFor } = await import(
    '../../src/services/plugins/replayData'
  );
  const boardPath = 'boards/web/board.config.json';
  const numericPath = storyFile('WEB-2'),
    textPath = storyFile('WEB-3');
  const fieldBase = {
    id: 'field-base',
    files: {
      'rowbly.config.json': file({ ...root, customFields: [] }),
      [boardPath]: file({ ...board, customFields: [] }),
      [path]: file({ ...story, customFields: {} }),
    },
  };
  const fieldSource = (id: string, type: 'number' | 'text', key: string, rank: string, value: number | string) => ({
    id,
    files: {
      ...fieldBase.files,
      [boardPath]: file({ ...board, customFields: [{ key: 'x', name: 'X', type, required: false }] }),
      [storyFile(key)]: file({ ...story, key, rank, customFields: { x: value } }),
    },
  });
  const numeric = fieldSource('a-number', 'number', 'WEB-2', 'a1', 42);
  let localField = fieldSource('b-text', 'text', 'WEB-3', 'a2', 'original');
  let fieldProjection = transportReplayData(localField, emptyReplayProjection(), []).projection;
  let fieldResult = mergeData(fieldBase, numeric, localField, [], {});
  fieldProjection = replayProjectionFor(localField, fieldProjection, fieldResult);
  expect(fieldProjection.fields).toEqual({ 'boards/web': { x: 'x-2' } });
  for (const value of ['later', 'pending']) {
    const next = fieldSource(`c-${value}`, 'text', 'WEB-3', 'a2', value);
    const projected = transportReplayData(next, fieldProjection, []);
    fieldResult = mergeData(
      transportReplayData(localField, fieldProjection, []).source,
      { id: 'a-current', files: fieldResult.files },
      projected.source,
      [],
      {},
    );
    fieldProjection = replayProjectionFor(next, projected.projection, fieldResult);
    localField = next;
    expect(JSON.parse(Buffer.from(fieldResult.files[textPath]?.data ?? '', 'base64').toString()).customFields).toEqual({
      'x-2': value,
    });
    expect(
      JSON.parse(Buffer.from(fieldResult.files[numericPath]?.data ?? '', 'base64').toString()).customFields,
    ).toEqual({ x: 42 });
  }
  expect(() =>
    transportReplayData(
      {
        ...localField,
        files: {
          ...localField.files,
          [boardPath]: file({
            ...board,
            customFields: ['x', 'x-2'].map((key) => ({ key, name: key, type: 'text', required: false })),
          }),
        },
      },
      fieldProjection,
      [],
    ),
  ).toThrow('Ambiguous new Custom Field at a replay destination');

  const { tasks } = await import('../../src/plugins/tasks');
  const { comments } = await import('../../src/plugins/comments');
  const { epics } = await import('../../src/plugins/epics');
  const epicPath = 'plugins/epics/same.json';
  const currentEpic = {
    version: 1,
    id: 'same',
    name: 'current',
    description: '',
    closed: false,
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
  };
  const futureEpic = { version: 99, id: 'same', future: { exact: ['unchanged'] } };
  const opaqueSide = { id: 'a-opaque', files: { ...base.files, [epicPath]: file(futureEpic) } };
  const currentSide = { id: 'b-current', files: { ...base.files, [epicPath]: file(currentEpic) } };
  expect(() =>
    mergeData(base, opaqueSide, currentSide, [epics], {
      'b-current': { epics: { '': { same: 'same-2' } } },
    }),
  ).toThrow('Opaque Epic at moved replay path');
  expect(opaqueSide.files[epicPath]).toEqual(file(futureEpic));
  const opaqueDestination = {
    id: 'a-future-destination',
    files: { ...base.files, 'plugins/epics/same-2.json': file({ ...futureEpic, id: 'same-2' }) },
  };
  expect(() =>
    mergeData(base, opaqueDestination, currentSide, [epics], {
      'b-current': { epics: { '': { same: 'same-2' } } },
    }),
  ).toThrow('Opaque Epic at moved replay path');
  expect(opaqueDestination.files['plugins/epics/same-2.json']).toEqual(file({ ...futureEpic, id: 'same-2' }));

  const task = {
    number: 1,
    name: 'First duplicate Task',
    description: '',
    stage: 'backlog',
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
  };
  const comment = {
    id: 'duplicate-id',
    author: null,
    body: 'First current-format Comment',
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
  };
  for (const owner of [
    { definition: tasks, bag: { nextNumber: 2, tasks: [task, { ...task, name: 'Second duplicate Task' }] } },
    { definition: comments, bag: { comments: [comment, { ...comment, body: 'Second distinct Comment' }] } },
  ]) {
    const source = (id: string, bag: unknown) => ({
      id,
      files: { ...base.files, [path]: file({ ...story, plugins: { ...story.plugins, [owner.definition.id]: bag } }) },
    });
    // BASE and either side must reject known invalid identities, even beside an opaque future shape.
    for (let position = 0; position < 3; position++) {
      const inputs = ['base', 'left', 'right'].map((id, index) =>
        source(id, index === position ? owner.bag : { ...owner.bag, version: 999 }),
      );
      const [old, a, b] = inputs;
      if (!old || !a || !b) throw new Error('Expected three sources');
      expect(() => mergeData(old, a, b, [owner.definition])).toThrow(/duplicate/i);
    }
    const future = source('future', { ...owner.bag, version: 999 });
    const opaque = mergeData(future, future, future, [owner.definition]);
    expect(
      JSON.parse(Buffer.from(opaque.files[path]?.data ?? '', 'base64').toString()).plugins[owner.definition.id],
    ).toEqual({ ...owner.bag, version: 999 });
    expect(owner.definition.bags?.story?.safeParse(owner.bag).success).toBe(false);
    const isTasks = owner.definition.id === 'tasks';
    const bag = (name: string, extra = false) =>
      isTasks
        ? {
            nextNumber: extra ? 3 : 2,
            tasks: [{ ...task, name }, ...(extra ? [{ ...task, number: 2, name: 'new original' }] : [])],
          }
        : {
            comments: [
              { ...comment, body: name },
              ...(extra ? [{ ...comment, id: 'duplicate-id-2', body: 'new original' }] : []),
            ],
          };
    const collision = mergeData(base, source('a', bag('remote')), source('b', bag('local')), [owner.definition]);
    const scope = 'boards/web/stories/WEB-1';
    const prior = Object.fromEntries(
      (collision.identities ?? []).filter((m) => m.source === 'b').map((m) => [m.from, m.to]),
    );
    const maps = { [owner.definition.id]: { [scope]: prior } };
    const replayed = mergeData(
      source('b', bag('local')),
      { id: 'a-current', files: collision.files },
      source('c', bag('later', true)),
      [owner.definition],
      { b: maps, c: maps },
    );
    const value = JSON.parse(Buffer.from(replayed.files[path]?.data ?? '', 'base64').toString()).plugins[
      owner.definition.id
    ];
    expect(
      (isTasks
        ? value.tasks.map((v: { name: string }) => v.name)
        : value.comments.map((v: { body: string }) => v.body)
      ).sort(),
    ).toEqual(['later', 'new original', 'remote']);
    expect(replayed.identities?.filter((m) => m.source === 'c')).toHaveLength(2);
    expect(replayed.evidence).toHaveLength(1);
    if (!isTasks) {
      const original = source('identifiers', {
        comments: [
          { ...comment, id: '__proto__', body: 'first' },
          { ...comment, id: 'constructor', body: 'second' },
        ],
      });
      const projection = emptyReplayProjection();
      projection.owners.comments = { [scope]: JSON.parse('{"__proto__":"constructor","constructor":"__proto__"}') };
      const transported = transportReplayData(original, JSON.parse(JSON.stringify(projection)), [comments]);
      const retained = JSON.parse(Buffer.from(transported.source.files[path]?.data ?? '', 'base64').toString()).plugins
        .comments.comments;
      expect(retained).toEqual([
        { ...comment, id: '__proto__', body: 'second' },
        { ...comment, id: 'constructor', body: 'first' },
      ]);
      expect(Object.hasOwn(transported.projection.owners.comments?.[scope] ?? {}, '__proto__')).toBe(true);
      const reversed = JSON.parse(JSON.stringify(projection));
      reversed.owners.comments[scope] = Object.fromEntries(Object.entries(reversed.owners.comments[scope]).reverse());
      const same = transportReplayData(original, reversed, [comments]);
      expect(same.evidence).toEqual(transported.evidence);
      for (const path of transported.evidence) expect(same.source.files[path]).toEqual(transported.source.files[path]);
    }
  }
});
