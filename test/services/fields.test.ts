import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../src/core';
import type { CustomFieldDef } from '../../src/schemas';
import { createServices, type RowblyContext } from '../../src/services';
import { coerceFieldInput, validateFieldValues } from '../../src/services/_customFieldValues';
import { createRepositories } from '../../src/storage';
import { fixedClock, fixedIds, makeBoard, makeStory, type TempRoot, tempRoot } from '../helpers';

const board = { level: 'board' as const, boardId: 'web' };

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

async function setup() {
  const t = await tempRoot();
  await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB' });
  const warnings: string[] = [];
  return { t, warnings, services: createServices(contextFor(t, warnings)), repos: createRepositories(t.root) };
}

describe('fields.add', () => {
  it('adds an integer number field; coercing "3.5" is a ValidationError', async () => {
    const { services } = await setup();
    const list = await services.fields.add(board, {
      key: 'estimate',
      name: 'Estimate',
      type: 'number',
      integer: true,
      min: 0,
    });
    const estimate = list[0] as CustomFieldDef;
    expect(estimate).toEqual({
      key: 'estimate',
      name: 'Estimate',
      required: false,
      type: 'number',
      integer: true,
      min: 0,
    });
    expect(() => coerceFieldInput(estimate, '3.5')).toThrow(ValidationError);
    expect(() => coerceFieldInput(estimate, '-1')).toThrow(ValidationError);
    expect(coerceFieldInput(estimate, '3')).toBe(3);
  });

  it('rejects duplicates, settings that do not fit the type, and min > max', async () => {
    const { services } = await setup();
    await services.fields.add(board, { key: 'size', name: 'Size', type: 'select', options: ['s', 'm'] });
    await expect(services.fields.add(board, { key: 'size', name: 'Size', type: 'text' })).rejects.toThrow(
      ConflictError,
    );
    await expect(
      services.fields.add(board, { key: 'note', name: 'Note', type: 'text', options: ['a'] } as never),
    ).rejects.toThrow(ValidationError);
    await expect(
      services.fields.add(board, { key: 'flag', name: 'Flag', type: 'boolean', min: 1 } as never),
    ).rejects.toThrow(ValidationError);
    await expect(
      services.fields.add(board, { key: 'pick', name: 'Pick', type: 'select', options: [] }),
    ).rejects.toThrow(ValidationError);
    await expect(services.fields.add(board, { key: 'n', name: 'N', type: 'number', min: 5, max: 1 })).rejects.toThrow(
      ValidationError,
    );
  });
});

describe('fields.update', () => {
  it('removing a select option strips matching Story values and warns with the count', async () => {
    const { t, services, repos, warnings } = await setup();
    await services.fields.add(board, { key: 'size', name: 'Size', type: 'select', options: ['s', 'm', 'l'] });
    await services.fields.add(board, { key: 'tags', name: 'Tags', type: 'multiselect', options: ['a', 'b'] });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', customFields: { size: 'l', tags: ['a', 'b'] } });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-2', customFields: { size: 'l' } });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-3', customFields: { size: 's', tags: ['b'] } });

    await services.fields.update(board, 'size', { options: ['s', 'm'] });
    expect(warnings).toEqual(['stripped 2 values of "size" that no longer fit the Custom Field']);
    const stories = await repos.stories.allInBoard('web');
    expect(stories.map((s) => s.customFields)).toEqual([{ tags: ['a', 'b'] }, {}, { size: 's', tags: ['b'] }]);

    // A multiselect keeps the options that remain.
    await services.fields.update(board, 'tags', { options: ['a'] });
    expect((await repos.stories.allInBoard('web')).map((s) => s.customFields)).toEqual([
      { tags: ['a'] },
      {},
      { size: 's' },
    ]);
  });

  it('edits properties, clears optional ones with null, and never changes the type', async () => {
    const { services } = await setup();
    await services.fields.add(board, { key: 'est', name: 'Est', type: 'number', min: 0, description: 'points' });
    const [est] = await services.fields.update(board, 'est', {
      name: 'Estimate',
      min: null,
      description: null,
      required: true,
    });
    expect(est).toEqual({ key: 'est', name: 'Estimate', required: true, type: 'number' });
    await expect(services.fields.update(board, 'est', { options: ['a'] })).rejects.toThrow(ValidationError);
    await expect(services.fields.update(board, 'nope', { name: 'x' })).rejects.toThrow(NotFoundError);
  });
});

describe('fields.remove', () => {
  it('strips the values on affected Boards only and reports the count', async () => {
    const { t, services, repos, warnings } = await setup();
    await makeBoard(t.path, {
      id: 'api',
      keyPrefix: 'API',
      customFields: [{ key: 'size', name: 'Size', type: 'text', required: false }],
    });
    const global = { level: 'global' as const };
    await services.fields.add(global, { key: 'size', name: 'Size', type: 'text' });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1', customFields: { size: 'big' } });
    await makeStory(t.path, { boardId: 'api', key: 'API-1', customFields: { size: 'big' } });

    expect(await services.fields.remove(global, 'size')).toEqual({ valuesStripped: 1 });
    expect(warnings).toEqual(['stripped 1 value of removed Custom Field "size"']);
    expect((await repos.stories.findByKey('WEB-1')).customFields).toEqual({});
    expect((await repos.stories.findByKey('API-1')).customFields).toEqual({ size: 'big' });
    expect((await repos.rootConfig.get()).customFields).toEqual([]);
  });
});

describe('coerceFieldInput', () => {
  const def = <T extends CustomFieldDef['type']>(type: T, extra: object = {}) =>
    ({ key: 'f', name: 'F', required: false, type, ...extra }) as CustomFieldDef;

  it('coerces each type', () => {
    expect(coerceFieldInput(def('text'), ' hi ')).toBe(' hi ');
    expect(coerceFieldInput(def('number'), '2.5')).toBe(2.5);
    expect(coerceFieldInput(def('boolean'), 'TRUE')).toBe(true);
    expect(coerceFieldInput(def('boolean'), 'false')).toBe(false);
    expect(coerceFieldInput(def('date'), '2026-10-12')).toBe('2026-10-12');
    expect(coerceFieldInput(def('url'), 'https://example.com/x')).toBe('https://example.com/x');
    expect(coerceFieldInput(def('select', { options: ['a', 'b'] }), 'b')).toBe('b');
    expect(coerceFieldInput(def('multiselect', { options: ['a', 'b'] }), 'b, a,b')).toEqual(['b', 'a']);
  });

  it('rejects values that do not fit', () => {
    for (const [d, raw] of [
      [def('number'), 'abc'],
      [def('number'), ''],
      [def('number', { max: 3 }), '4'],
      [def('boolean'), 'yes'],
      [def('date'), '2026-02-30'],
      [def('url'), 'ftp://x'],
      [def('url'), 'example.com'],
      [def('select', { options: ['a'] }), 'z'],
      [def('multiselect', { options: ['a'] }), 'a,z'],
    ] as const) {
      expect(() => coerceFieldInput(d, raw), `${d.type} ${raw}`).toThrow(ValidationError);
    }
  });
});

describe('validateFieldValues', () => {
  const defs: CustomFieldDef[] = [
    { key: 'est', name: 'Estimate', required: true, type: 'number', integer: true },
    { key: 'size', name: 'Size', required: false, type: 'select', options: ['s', 'm'] },
  ];

  it('returns typed values, coercing strings', () => {
    expect(validateFieldValues(defs, { est: '3', size: 's' }, { requireRequired: true })).toEqual({
      est: 3,
      size: 's',
    });
    expect(validateFieldValues(defs, { size: 'm' }, { requireRequired: false })).toEqual({ size: 'm' });
  });

  it('lists every issue: unknown keys, bad values and missing required fields', () => {
    let err: unknown;
    try {
      validateFieldValues(defs, { size: 'x', nope: 1 }, { requireRequired: true });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect(((err as ValidationError).details.issues as { path: string[] }[]).map((i) => i.path)).toEqual([
      ['customFields', 'size'],
      ['customFields', 'nope'],
      ['customFields', 'est'],
    ]);
  });
});
