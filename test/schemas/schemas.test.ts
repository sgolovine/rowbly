import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import {
  AssigneeSchema,
  BoardConfigSchema,
  CommentSchema,
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
  TaskIdSchema,
  TaskSchema,
  TimestampSchema,
} from '../../src/schemas';

const T = '2026-10-12T17:21:07.000Z';

const comment = { id: 'c0000001', author: 'sam', body: 'Looks good', createdAt: T, updatedAt: T };
const task = {
  id: 'WEB-42.1',
  name: 'Write tests',
  description: '',
  stage: 'todo',
  comments: [comment],
  createdAt: T,
  updatedAt: T,
};
const story = {
  version: 1,
  key: 'WEB-42',
  boardId: 'web',
  name: 'Login page',
  description: '# Notes',
  stage: 'todo',
  rank: 'a0',
  assignees: ['sam'],
  priority: 'P1',
  labels: ['frontend'],
  dueDate: '2026-11-01',
  customFields: { points: 3, env: ['prod'] },
  createdBy: 'sam',
  createdAt: T,
  updatedAt: T,
  nextTaskNumber: 2,
  tasks: [task],
  comments: [],
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
  { name: 'TaskId', schema: TaskIdSchema, valid: ['WEB-42.1'], invalid: ['WEB-42', 'WEB-42.0', 'web-42.1'] },
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
    valid: [
      { version: 1 },
      { version: 1, stages: [...DEFAULT_STAGES], customFields: [] },
      { version: 1, assignees: [{ handle: 'sam', name: 'Sam', email: 'sam@example.com' }] },
    ],
    invalid: [
      {},
      { version: 2 },
      { version: 1, stages: [] },
      {
        version: 1,
        assignees: [
          { handle: 'sam', name: 'Sam' },
          { handle: 'sam', name: 'Sam 2' },
        ],
      },
    ],
  },
  {
    name: 'Assignee',
    schema: AssigneeSchema,
    valid: [
      { handle: 'sam', name: 'Sam' },
      { handle: 'sam', name: 'Sam', email: 'sam@example.com' },
    ],
    invalid: [
      { handle: 'Sam', name: 'Sam' },
      { handle: 'sam', name: 'Sam', email: 'not-an-email' },
    ],
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
    name: 'Comment',
    schema: CommentSchema,
    valid: [comment, { ...comment, author: null }],
    invalid: [
      { ...comment, body: '' },
      { ...comment, author: undefined },
    ],
  },
  {
    name: 'Task',
    schema: TaskSchema,
    valid: [task],
    invalid: [
      { ...task, id: 'WEB-42' },
      { ...task, name: 'x'.repeat(201) },
      { ...task, comments: undefined },
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
      { ...story, nextTaskNumber: 0 },
      { ...story, nextTaskNumber: 1.5 },
      { ...story, customFields: { Points: 3 } },
      { ...story, name: '' },
      { ...story, tasks: undefined },
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

  it('defaults the Assignee roster to empty', () => {
    expect(RowblyConfigSchema.parse({ version: 1 })).toEqual({ version: 1, assignees: [] });
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
    const shuffled = Object.fromEntries(Object.entries(story).reverse());
    const parsed = StorySchema.parse(shuffled);
    expect(Object.keys(parsed)).toEqual(Object.keys(StorySchema.shape));
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(StorySchema.parse(story)));
    expect(Object.keys(parsed.tasks[0] ?? {})).toEqual(Object.keys(TaskSchema.shape));
  });

  it('drops unknown keys', () => {
    const parsed = StorySchema.parse({ ...story, extra: true });
    expect(parsed).not.toHaveProperty('extra');
  });
});
