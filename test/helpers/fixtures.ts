// Builders that write valid files straight into a Data Root, bypassing services and storage.
// Later packages may add builders here; do not change existing ones.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ZodType } from 'zod';
import {
  type BoardConfig,
  BoardConfigSchema,
  type Epic,
  EpicSchema,
  type Story,
  StorySchema,
  type WorkspaceConfig,
  WorkspaceConfigSchema,
} from '../../src/schemas';
import { FIXED_NOW } from './clock';

/** Writes `value` the way storage does: schema-parsed (schema key order), 2-space indent, trailing newline. */
export async function writeFixture<T>(path: string, schema: ZodType<T>, value: T): Promise<T> {
  const parsed = schema.parse(value);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

export async function makeWorkspace(
  root: string,
  overrides: Partial<WorkspaceConfig> & { id: string },
): Promise<WorkspaceConfig> {
  const workspace: WorkspaceConfig = {
    version: 1,
    name: overrides.id,
    description: '',
    assignees: [],
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
  return writeFixture(
    join(root, 'workspaces', workspace.id, 'workspace.config.json'),
    WorkspaceConfigSchema,
    workspace,
  );
}

export async function makeBoard(
  root: string,
  overrides: Partial<BoardConfig> & { id: string; workspaceId: string; keyPrefix: string },
): Promise<BoardConfig> {
  const board: BoardConfig = {
    version: 1,
    name: overrides.id,
    description: '',
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
  return writeFixture(
    join(root, 'workspaces', board.workspaceId, 'boards', board.id, 'board.config.json'),
    BoardConfigSchema,
    board,
  );
}

export async function makeStory(
  root: string,
  overrides: Partial<Story> & { key: string; workspaceId: string; boardId: string },
): Promise<Story> {
  const story: Story = {
    version: 1,
    name: `Story ${overrides.key}`,
    description: '',
    stage: 'backlog',
    rank: 'a0',
    assignees: [],
    epicId: null,
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
  return writeFixture(
    join(root, 'workspaces', story.workspaceId, 'boards', story.boardId, 'stories', `${story.key}.json`),
    StorySchema,
    story,
  );
}

export async function makeEpic(
  root: string,
  overrides: Partial<Epic> & { id: string; workspaceId: string },
): Promise<Epic> {
  const epic: Epic = {
    version: 1,
    name: overrides.id,
    description: '',
    closed: false,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
  return writeFixture(join(root, 'workspaces', epic.workspaceId, 'epics', `${epic.id}.json`), EpicSchema, epic);
}
