import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { reservedNames } from '/home/sgolovine/Projects/rowbly/src/main';
import { createServices, loadPlugins } from '/home/sgolovine/Projects/rowbly/src/services';
import type { AnyPluginDefinition, RowblyContext } from '/home/sgolovine/Projects/rowbly/src/services';
import { BoardConfigSchema, RowblyConfigSchema, StorySchema } from '/home/sgolovine/Projects/rowbly/src/schemas';

export const NOW = '2026-10-12T17:21:07.000Z';
let counter = 0;

export async function tempRoot() {
  const dir = await mkdtemp(join(tmpdir(), 'rowbly-review-'));
  const path = join(dir, '.rowbly');
  await mkdir(path);
  return { dir, path, root: { path, kind: 'local' as const }, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export async function writeJsonFixture(path: string, schema: any, value: any) {
  const parsed = schema.parse(value);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

export async function makeRoot(on: Record<string, true | Record<string, unknown>> = {}, extra: Record<string, unknown> = {}) {
  const t = await tempRoot();
  const plugins = Object.fromEntries(
    Object.entries(on).map(([id, v]) => [id, v === true ? { enabled: true } : { enabled: true, ...v }]),
  );
  await writeJsonFixture(join(t.path, 'rowbly.config.json'), RowblyConfigSchema, {
    version: 1,
    assignees: [{ handle: 'alice', name: 'Alice' }],
    plugins,
    ...extra,
  });
  await makeBoard(t.path, { id: 'web', name: 'Website', keyPrefix: 'WEB' });
  return t;
}

export function makeBoard(root: string, o: any) {
  return writeJsonFixture(join(root, 'boards', o.id, 'board.config.json'), BoardConfigSchema, {
    version: 1,
    name: o.id,
    description: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...o,
  });
}

export function makeStory(root: string, o: any) {
  const story = {
    version: 1,
    name: `Story ${o.key}`,
    description: '',
    stage: 'backlog',
    rank: 'a0',
    assignees: [],
    priority: null,
    labels: [],
    dueDate: null,
    customFields: {},
    createdBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    nextTaskNumber: 1,
    tasks: [],
    ...o,
  };
  return writeJsonFixture(join(root, 'boards', story.boardId, 'stories', story.key, 'story.json'), StorySchema, story);
}

export async function withPlugins(t: { root: any }, registry: readonly AnyPluginDefinition[], over: Partial<RowblyContext> = {}) {
  const host = await loadPlugins({ root: t.root, registry, reserved: reservedNames() });
  const warnings: string[] = [];
  const ctx: RowblyContext = {
    root: t.root,
    local: { version: 1 },
    me: null,
    now: () => new Date(NOW),
    newId: () => `id${++counter}`,
    warn: (m) => warnings.push(m),
    plugins: host,
    ...over,
  };
  return { host, ctx, services: createServices(ctx), warnings };
}

export async function readJson(root: string, rel: string) {
  return JSON.parse(await readFile(join(root, rel), 'utf8'));
}

export async function readText(root: string, rel: string) {
  return readFile(join(root, rel), 'utf8');
}

export function show(label: string, value: unknown) {
  console.log(`\n## ${label}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`);
}
