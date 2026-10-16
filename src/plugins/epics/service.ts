import {
  type Bagged,
  ConflictError,
  type EffectiveBoardConfig,
  type PluginContext,
  type PluginReadContext,
  type PluginReadServices,
  type Story,
  toTimestamp,
} from '../../plugin-api';
import { epicFileName, isUnavailable, readEpic, readEpicFiles, type UnavailableEpic, writeEpic } from './epicFile';
import {
  type Epic,
  EpicBag,
  type EpicBoardStories,
  EpicCreate,
  type EpicDetails,
  type EpicMode,
  EpicPatch,
  type EpicProgress,
  type EpicSummary,
  validate,
} from './model';

/** Epic `id` as stored: `NOT_FOUND` when missing, `DATA_INTEGRITY` when its file cannot be read. */
export async function getEpic(plugin: PluginReadContext, id: string): Promise<Epic> {
  return readEpic((name) => plugin.files.read('dataRoot', name), id);
}

function inMode(epic: Epic, mode: EpicMode): boolean {
  return mode === 'all' || epic.closed === (mode === 'closed');
}

/** Every Epic file: the Epics that can be read, and the ones that cannot, each read on its own. */
export async function readEpics(plugin: PluginReadContext): Promise<{ epics: Epic[]; unavailable: UnavailableEpic[] }> {
  const files = await readEpicFiles(plugin.files);
  return {
    epics: files.flatMap((file) => (isUnavailable(file) ? [] : [file.epic])),
    unavailable: files.filter(isUnavailable),
  };
}

/** The Epics that can be read, in `mode`; Epic files that cannot be read are left out. */
export async function listEpics(plugin: PluginReadContext, mode: EpicMode = 'open'): Promise<Epic[]> {
  return (await readEpics(plugin)).epics.filter((epic) => inMode(epic, mode));
}

export async function createEpic(plugin: PluginContext, input: { id: string; name: string; description?: string }) {
  const values = validate(EpicCreate, input, 'Epic');
  return plugin.operation('create', values, async (changes) => {
    if ((await changes.readFile('dataRoot', epicFileName(values.id))) !== null) {
      throw new ConflictError(`Epic "${values.id}" already exists`);
    }
    const now = toTimestamp(plugin.now());
    const epic: Epic = { version: 1, ...values, closed: false, createdAt: now, updatedAt: now };
    await writeEpic(changes, epic);
    return epic;
  });
}

export async function editEpic(plugin: PluginContext, id: string, input: { name?: string; description?: string }) {
  const patch = validate(
    EpicPatch,
    Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    'Epic patch',
  );
  return plugin.operation('edit', { id, ...patch }, async (changes) => {
    const stored = await readEpic((name) => changes.readFile('dataRoot', name), id);
    const epic = { ...stored, ...patch, updatedAt: toTimestamp(plugin.now()) };
    await writeEpic(changes, epic);
    return epic;
  });
}

export async function setEpicClosed(plugin: PluginContext, id: string, closed: boolean) {
  return plugin.operation(closed ? 'close' : 'reopen', { id }, async (changes) => {
    const stored = await readEpic((name) => changes.readFile('dataRoot', name), id);
    const epic = { ...stored, closed, updatedAt: toTimestamp(plugin.now()) };
    await writeEpic(changes, epic);
    return epic;
  });
}

export function storyEpic(plugin: PluginReadContext, story: Bagged): string | undefined {
  return plugin.readBag(story, EpicBag)?.epic;
}

async function epicStories(plugin: PluginContext, id: string): Promise<Story[]> {
  return (await plugin.services.stories.list(null, {})).filter((story) => storyEpic(plugin, story) === id);
}

export async function deleteEpic(plugin: PluginContext, id: string) {
  const result = await plugin.operation('delete', { id }, async (changes) => {
    await readEpic((name) => changes.readFile('dataRoot', name), id);
    const linked = await epicStories(plugin, id);
    for (const story of linked) {
      await changes.updateStory(story.key, (s) =>
        plugin.writeBag({ ...s, updatedAt: toTimestamp(plugin.now()) }, undefined),
      );
    }
    await changes.deleteFile('dataRoot', epicFileName(id));
    return { id, storiesUnlinked: linked.length };
  });
  if (result.storiesUnlinked > 0) plugin.warn(`Unlinked ${result.storiesUnlinked} Stories from Epic "${id}"`);
  return result;
}

/** The effective configuration of each Board, loaded once per Board. */
async function boardConfigs(
  services: Pick<PluginReadServices, 'config'>,
  stories: readonly Story[],
): Promise<Map<string, EffectiveBoardConfig>> {
  const boardIds = [...new Set(stories.map((story) => story.boardId))].sort();
  return new Map(await Promise.all(boardIds.map(async (id) => [id, await services.config.effective(id)] as const)));
}

/** Epic Progress of `stories`: those whose Stage is in their Board's `done` Stage Category. */
function progressOf(stories: readonly Story[], configs: Map<string, EffectiveBoardConfig>): EpicProgress {
  const done = stories.filter((story) =>
    configs.get(story.boardId)?.stages.some((stage) => stage.key === story.stage && stage.category === 'done'),
  ).length;
  return { done, total: stories.length, percent: stories.length ? Math.round((done / stories.length) * 100) : 0 };
}

export async function showEpic(plugin: PluginContext, id: string): Promise<EpicDetails> {
  const epic = await getEpic(plugin, id);
  const stories = await epicStories(plugin, id);
  const configs = await boardConfigs(plugin.services, stories);
  const boards: EpicBoardStories[] = [...configs].map(([boardId, config]) => ({
    board: config.board,
    stories: stories.filter((story) => story.boardId === boardId),
  }));
  return { ...epic, boards, progress: progressOf(stories, configs) };
}

/**
 * The Epics in `mode` with their Epic Progress, for the Epic list (PERF-01): Epics, Stories and each
 * relevant Board's configuration are read once, whatever the number of Epics. Epic files that cannot
 * be read are in `unavailable`, in every mode.
 */
export async function listEpicSummaries(
  plugin: PluginContext,
  mode: EpicMode,
): Promise<{ summaries: EpicSummary[]; unavailable: UnavailableEpic[] }> {
  const { epics, unavailable } = await readEpics(plugin);
  const shown = epics.filter((epic) => inMode(epic, mode));
  const byEpic = new Map<string, Story[]>(shown.map((epic) => [epic.id, []]));
  for (const story of await plugin.services.stories.list(null, {})) {
    const id = storyEpic(plugin, story);
    if (id !== undefined) byEpic.get(id)?.push(story);
  }
  const configs = await boardConfigs(plugin.services, [...byEpic.values()].flat());
  return {
    summaries: shown.map((epic) => ({ ...epic, progress: progressOf(byEpic.get(epic.id) ?? [], configs) })),
    unavailable,
  };
}

export function progressText(progress: EpicProgress) {
  return `${progress.done}/${progress.total} Stories done (${progress.percent}%)`;
}
