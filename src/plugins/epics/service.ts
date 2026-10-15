import {
  type Bagged,
  ConflictError,
  NotFoundError,
  type PluginContext,
  type PluginReadContext,
  toTimestamp,
  ValidationError,
} from '../../plugin-api';
import { EpicBag, EpicCreate, EpicPatch, EpicSchema, validate } from './model';

export async function getEpic(plugin: PluginContext, id: string) {
  const { id: checked } = validate(EpicCreate.pick({ id: true }), { id });
  const text = await plugin.files.read('dataRoot', `${checked}.json`);
  if (text === null) throw new NotFoundError(`Epic "${id}" not found`);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ValidationError(`Epic "${id}" has invalid JSON`);
  }
  const epic = validate(EpicSchema, data);
  if (epic.id !== id) throw new ValidationError(`Epic "${id}" does not match its file name`);
  return epic;
}

export async function listEpics(plugin: PluginContext, mode: 'open' | 'closed' | 'all' = 'open') {
  const names = (await plugin.files.list('dataRoot')).filter((name) => /^[^/]+\.json$/.test(name));
  const epics = await Promise.all(names.map((name) => getEpic(plugin, name.slice(0, -5))));
  return epics.filter((epic) => mode === 'all' || epic.closed === (mode === 'closed'));
}

export async function createEpic(plugin: PluginContext, input: { id: string; name: string; description?: string }) {
  const values = validate(EpicCreate, input);
  return plugin.operation('create', values, async (changes) => {
    if ((await changes.readFile('dataRoot', `${values.id}.json`)) !== null) {
      throw new ConflictError(`Epic "${values.id}" already exists`);
    }
    const now = toTimestamp(plugin.now());
    const epic = { version: 1 as const, ...values, closed: false, createdAt: now, updatedAt: now };
    await changes.writeFile('dataRoot', `${epic.id}.json`, `${JSON.stringify(epic, null, 2)}\n`);
    return epic;
  });
}

export async function editEpic(plugin: PluginContext, id: string, input: { name?: string; description?: string }) {
  const patch = validate(
    EpicPatch,
    Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
  );
  return plugin.operation('edit', { id, ...patch }, async (changes) => {
    const epic = { ...(await getEpic(plugin, id)), ...patch, updatedAt: toTimestamp(plugin.now()) };
    await changes.writeFile('dataRoot', `${id}.json`, `${JSON.stringify(epic, null, 2)}\n`);
    return epic;
  });
}

export async function setEpicClosed(plugin: PluginContext, id: string, closed: boolean) {
  return plugin.operation(closed ? 'close' : 'reopen', { id }, async (changes) => {
    const epic = { ...(await getEpic(plugin, id)), closed, updatedAt: toTimestamp(plugin.now()) };
    await changes.writeFile('dataRoot', `${id}.json`, `${JSON.stringify(epic, null, 2)}\n`);
    return epic;
  });
}

export function storyEpic(plugin: PluginReadContext, story: Bagged): string | undefined {
  return plugin.readBag(story, EpicBag)?.epic;
}

export async function epicStories(plugin: PluginContext, id: string) {
  return (await plugin.services.stories.list(null, {})).filter((story) => storyEpic(plugin, story) === id);
}

export async function deleteEpic(plugin: PluginContext, id: string) {
  const result = await plugin.operation('delete', { id }, async (changes) => {
    await getEpic(plugin, id);
    const linked = await epicStories(plugin, id);
    for (const story of linked) {
      await changes.updateStory(story.key, (s) =>
        plugin.writeBag({ ...s, updatedAt: toTimestamp(plugin.now()) }, undefined),
      );
    }
    await changes.deleteFile('dataRoot', `${id}.json`);
    return { id, storiesUnlinked: linked.length };
  });
  if (result.storiesUnlinked > 0) plugin.warn(`Unlinked ${result.storiesUnlinked} Stories from Epic "${id}"`);
  return result;
}

export async function showEpic(plugin: PluginContext, id: string) {
  const epic = await getEpic(plugin, id);
  const stories = await epicStories(plugin, id);
  const boardIds = [...new Set(stories.map((story) => story.boardId))].sort();
  let done = 0;
  const boards = await Promise.all(
    boardIds.map(async (boardId) => {
      const config = await plugin.services.config.effective(boardId);
      const grouped = stories.filter((story) => story.boardId === boardId);
      done += grouped.filter((story) =>
        config.stages.some((stage) => stage.key === story.stage && stage.category === 'done'),
      ).length;
      return { board: config.board, stories: grouped };
    }),
  );
  return {
    ...epic,
    boards,
    progress: { done, total: stories.length, percent: stories.length ? Math.round((done / stories.length) * 100) : 0 },
  };
}

export function progressText(progress: { done: number; total: number; percent: number }) {
  return `${progress.done}/${progress.total} Stories done (${progress.percent}%)`;
}
