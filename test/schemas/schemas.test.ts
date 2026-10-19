import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import {
  BoardConfigSchema,
  CustomFieldDefSchema,
  CustomFieldListSchema,
  CustomFieldValueSchema,
  DEFAULT_STAGES,
  IsoDateSchema,
  KeyPrefixSchema,
  LabelSchema,
  LocalStateSchema,
  PrioritySchema,
  RowblyConfigSchema,
  SlugSchema,
  StageListSchema,
  StageSchema,
  StoryKeySchema,
  StorySchema,
  TimestampSchema,
} from '../../src/schemas';

const T = '2026-10-12T17:21:07.000Z';

const story = {
  version: 1,
  key: 'WEB-42',
  boardId: 'web',
  name: 'Login page',
  description: '# Notes',
  stage: 'todo',
  rank: 'a0',
  priority: 'P1',
  labels: ['frontend'],
  dueDate: '2026-11-01',
  customFields: { points: 3, env: ['prod'] },
  createdBy: 'sam',
  createdAt: T,
  updatedAt: T,
};
const board = {
  version: 1,
  id: 'web',
  name: 'Web',
  description: '',
  keyPrefix: 'WEB',
  stages: [...DEFAULT_STAGES],
  createdAt: T,
  updatedAt: T,
};

/** Each schema with values it must accept and values it must reject. */
const cases: { name: string; schema: ZodType; valid: unknown[]; invalid: unknown[] }[] = [
  {
    name: 'Slug',
    schema: SlugSchema,
    valid: ['acme', 'in-progress', 'a1'],
    invalid: ['Acme', 'a_b', '', 'a'.repeat(41), 'a-'],
  },
  { name: 'KeyPrefix', schema: KeyPrefixSchema, valid: ['WEB', 'A1'], invalid: ['W', 'web', '1WEB', 'ABCDEFGHIJK'] },
  { name: 'StoryKey', schema: StoryKeySchema, valid: ['WEB-1', 'WEB-42'], invalid: ['web-1', 'WEB-0', 'WEB42'] },
  { name: 'Label', schema: LabelSchema, valid: ['frontend', 'tech-debt'], invalid: ['Frontend', 'tech debt'] },
  { name: 'Timestamp', schema: TimestampSchema, valid: [T], invalid: ['2026-10-12T17:21:07Z', '2026-10-12'] },
  { name: 'IsoDate', schema: IsoDateSchema, valid: ['2026-10-12'], invalid: ['2026-02-30', '12/10/2026', T] },
  { name: 'Priority', schema: PrioritySchema, valid: ['P0', 'P4'], invalid: ['P5', 'p1', 1] },
  {
    name: 'Stage',
    schema: StageSchema,
    valid: [{ key: 'review', name: 'Review', category: 'in_progress' }],
    invalid: [
      { key: 'review', name: 'Review', category: 'doing' },
      { key: 'review', name: '', category: 'todo' },
      { key: 'Review', name: 'Review', category: 'todo' },
    ],
  },
  {
    name: 'Stage list',
    schema: StageListSchema,
    valid: [[...DEFAULT_STAGES]],
    invalid: [[], [DEFAULT_STAGES[0], DEFAULT_STAGES[0]]],
  },
  {
    name: 'CustomFieldDef',
    schema: CustomFieldDefSchema,
    valid: [
      { key: 'notes', name: 'Notes', type: 'text' },
      { key: 'points', name: 'Points', required: true, type: 'number', min: 0, max: 13, integer: true },
      { key: 'blocked', name: 'Blocked', type: 'boolean' },
      { key: 'release', name: 'Release', type: 'date' },
      { key: 'spec', name: 'Spec', type: 'url' },
      { key: 'size', name: 'Size', type: 'select', options: ['S', 'M', 'L'] },
      { key: 'env', name: 'Env', description: 'Targets', type: 'multiselect', options: ['dev', 'prod'] },
    ],
    invalid: [
      { key: 'size', name: 'Size', type: 'select', options: [] },
      { key: 'size', name: 'Size', type: 'select', options: ['S', 'S'] },
      { key: 'size', name: 'Size', type: 'select' },
      { key: 'x', name: 'X', type: 'color' },
      { key: 'x', name: 'x'.repeat(61), type: 'text' },
    ],
  },
  {
    name: 'Custom Field list',
    schema: CustomFieldListSchema,
    valid: [[], [{ key: 'a', name: 'A', type: 'text' }]],
    invalid: [
      [
        { key: 'a', name: 'A', type: 'text' },
        { key: 'a', name: 'B', type: 'boolean' },
      ],
    ],
  },
  {
    name: 'CustomFieldValue',
    schema: CustomFieldValueSchema,
    valid: ['x', 3, true, ['a']],
    invalid: [null, { a: 1 }, [1]],
  },
  {
    name: 'RowblyConfig',
    schema: RowblyConfigSchema,
    valid: [{ version: 1 }, { version: 1, stages: [...DEFAULT_STAGES], customFields: [] }],
    invalid: [{}, { version: 2 }, { version: 1, stages: [] }],
  },
  {
    name: 'BoardConfig',
    schema: BoardConfigSchema,
    valid: [board, { ...board, stages: undefined }],
    invalid: [
      { ...board, keyPrefix: 'web' },
      { ...board, id: 'Web' },
      { ...board, stages: [] },
    ],
  },
  {
    name: 'Story',
    schema: StorySchema,
    valid: [story, { ...story, priority: null, dueDate: null, createdBy: null, customFields: {} }],
    invalid: [
      { ...story, key: 'web-42' },
      { ...story, priority: 'P9' },
      { ...story, labels: ['Not Kebab'] },
      { ...story, dueDate: '2026-13-01' },
      { ...story, customFields: { Points: 3 } },
      { ...story, name: '' },
    ],
  },
  {
    name: 'LocalState',
    schema: LocalStateSchema,
    valid: [{ version: 1 }, { version: 1, board: 'web', me: 'sam' }],
    invalid: [{}, { version: 1, me: 'Sam' }, { version: 1, board: 'Web' }],
  },
];

describe.each(cases)('$name schema', ({ schema, valid, invalid }) => {
  it.each(valid.map((value) => [value]))('accepts %j', (value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });

  it.each(invalid.map((value) => [value]))('rejects %j', (value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});

describe('schema defaults', () => {
  it('defaults Custom Field `required` to false and descriptions to empty', () => {
    expect(CustomFieldDefSchema.parse({ key: 'a', name: 'A', type: 'text' })).toEqual({
      key: 'a',
      name: 'A',
      required: false,
      type: 'text',
    });
    const { description: _s, ...st } = story;
    expect(StorySchema.parse(st).description).toBe('');
  });

  it('drops the roster and Story Assignees of an older Rowbly (the Assignees Plugin keeps its own)', () => {
    const roster = [{ handle: 'sam', name: 'Sam' }];
    expect(RowblyConfigSchema.parse({ version: 1, assignees: roster })).toEqual({ version: 1 });
    expect(StorySchema.parse({ ...story, assignees: ['sam'] })).not.toHaveProperty('assignees');
  });

  it('defines the built-in default stages', () => {
    expect(DEFAULT_STAGES.map((s) => `${s.key}:${s.category}`)).toEqual([
      'backlog:todo',
      'todo:todo',
      'in-progress:in_progress',
      'done:done',
    ]);
  });
});

describe('serialization', () => {
  it('writes keys in schema order, whatever order the input had', () => {
    const bagged = { ...story, plugins: { epics: { epic: 'auth' } } };
    const shuffled = Object.fromEntries(Object.entries(bagged).reverse());
    const parsed = StorySchema.parse(shuffled);
    expect(Object.keys(parsed)).toEqual(Object.keys(StorySchema.shape));
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(StorySchema.parse(bagged)));
    // Optional keys that are absent stay absent.
    expect(Object.keys(StorySchema.parse(story))).toEqual(
      Object.keys(StorySchema.shape).filter((k) => k !== 'plugins'),
    );
  });

  it('keeps every Plugin bag as stored, whatever the Plugin (ADR-0011)', () => {
    const bags = { epics: { epic: 'auth', nested: { list: [1, 2] } }, 'from-the-future': { x: null } };
    const parsed = StorySchema.parse({
      ...story,
      plugins: bags,
    });
    expect(parsed.plugins).toEqual(bags);
  });

  it('drops unknown keys, including the Tasks of a Rowbly from before the Tasks Plugin', () => {
    const parsed = StorySchema.parse({ ...story, extra: true, nextTaskNumber: 2, tasks: [{ id: 'WEB-42.1' }] });
    expect(parsed).not.toHaveProperty('extra');
    expect(parsed).not.toHaveProperty('tasks');
    expect(parsed).not.toHaveProperty('nextTaskNumber');
  });
});
