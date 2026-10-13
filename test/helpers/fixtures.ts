// Builders that write valid files straight into a Data Root, bypassing services and storage.
// Later packages may add builders here; do not change existing ones.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ZodType } from 'zod';
import {
  type BoardConfig,
  BoardConfigSchema,
  type RowblyConfig,
  RowblyConfigSchema,
  type Story,
  StorySchema,
} from '../../src/schemas';
import { FIXED_NOW } from './clock';

/** Writes `value` the way storage does: schema-parsed (schema key order), 2-space indent, trailing newline. */
export async function writeFixture<T>(path: string, schema: ZodType<T>, value: T): Promise<T> {
  const parsed = schema.parse(value);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

/** Replaces `rowbly.config.json`, e.g. to set the Assignee roster or global Stages. */
export async function makeRootConfig(root: string, overrides: Partial<RowblyConfig> = {}): Promise<RowblyConfig> {
  const config: RowblyConfig = { version: 1, assignees: [], ...overrides };
  return writeFixture(join(root, 'rowbly.config.json'), RowblyConfigSchema, config);
}

export async function makeBoard(
  root: string,
  overrides: Partial<BoardConfig> & { id: string; keyPrefix: string },
): Promise<BoardConfig> {
  const board: BoardConfig = {
    version: 1,
    name: overrides.id,
    description: '',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
  return writeFixture(join(root, 'boards', board.id, 'board.config.json'), BoardConfigSchema, board);
}

export async function makeStory(
  root: string,
  overrides: Partial<Story> & { key: string; boardId: string },
): Promise<Story> {
  const story: Story = {
    version: 1,
    name: `Story ${overrides.key}`,
    description: '',
    stage: 'backlog',
    rank: 'a0',
    assignees: [],
    priority: null,
    labels: [],
    dueDate: null,
    customFields: {},
    createdBy: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    nextTaskNumber: 1,
    tasks: [],
    comments: [],
    ...overrides,
  };
  return writeFixture(join(root, 'boards', story.boardId, 'stories', story.key, 'story.json'), StorySchema, story);
}
