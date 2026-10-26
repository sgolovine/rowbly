import {
  DataIntegrityError,
  type FileScope,
  isSlug,
  NotFoundError,
  type PluginChangeSet,
  type PluginContext,
  type PluginReadContext,
  SlugSchema,
  type Stage,
  type StageCategory,
  UsageError,
  ValidationError,
  z,
} from '../../plugin-api';

export const PLUGIN_ID = 'software-factory';

/** One Stage's Stage Prompt setting at one level: whether it is on, and its file relative to the Data Root. */
export const StagePromptEntry = z.object({
  enabled: z.boolean().default(false),
  path: z.string().min(1).optional(),
});
export type StagePromptEntry = z.infer<typeof StagePromptEntry>;

/** The settings, in `rowbly.config.json` (global) and in a Board's `board.config.json` bag. */
export const Settings = z.object({ stagePrompts: z.record(SlugSchema, StagePromptEntry).default({}) });
export type Settings = z.infer<typeof Settings>;
type Entries = Record<string, StagePromptEntry>;

export type Level = 'board' | 'global';

/** A Stage Prompt as an agent reads it: `enabled` is on only when the setting is on and its file is there. */
export interface StagePrompt {
  enabled: boolean;
  /** The Stage's own on/off setting, at the level it came from. */
  configured: boolean;
  source: Level | null;
  path: string | null;
  exists: boolean;
  text: string | null;
}

export interface StagePromptRow {
  key: string;
  name: string;
  category: StageCategory;
  prompt: StagePrompt;
}

export interface StagePromptsOverview {
  /** The Board, or `null` for the global level alone. */
  board: string | null;
  stagesSource: string;
  stages: StagePromptRow[];
}

/** Where a level keeps its files: the Data Root's or the Board's Plugin folder. */
function scopeOf(level: Level, board: string | undefined): FileScope {
  return level === 'board' && board ? { board } : 'dataRoot';
}

/** The folder of this Plugin at a level, relative to the Data Root, ending in `/`. */
function folderOf(level: Level, board: string | undefined): string {
  return `${level === 'board' ? `boards/${board}/` : ''}plugins/${PLUGIN_ID}/`;
}

/** The file a new Stage Prompt gets, inside the Plugin folder. */
function defaultName(stage: string): string {
  return `stage-prompts/${stage}.md`;
}

/**
 * The name inside the level's Plugin folder that `path` points to, or `null` when it does not resolve:
 * a path outside that folder, or with an empty, `.` or `..` part, is never read.
 */
export function resolvePath(level: Level, board: string | undefined, path: string | undefined): string | null {
  if (!path) return null;
  const folder = folderOf(level, board);
  if (!path.startsWith(folder)) return null;
  const name = path.slice(folder.length);
  const parts = name.split('/');
  if (!name || parts.some((part) => part === '' || part === '.' || part === '..' || !/^[\w.-]+$/.test(part)))
    return null;
  return name;
}

/** The Stage Prompt entries stored in a raw settings value; an unreadable one reads as none (doctor reports it). */
function entriesOf(raw: unknown): Entries {
  const parsed = Settings.safeParse(raw ?? {});
  return parsed.success ? parsed.data.stagePrompts : {};
}

/** The entries for a change: an unreadable value throws instead of being replaced. */
function storedEntries(raw: unknown, where: string): Entries {
  const parsed = Settings.safeParse(raw ?? {});
  if (parsed.success) return parsed.data.stagePrompts;
  throw new DataIntegrityError(`Stage Prompt settings in ${where} are not valid`, {
    details: { plugin: PLUGIN_ID, path: where, issues: parsed.error.issues },
    hint: 'run `rowbly doctor`',
  });
}

/** The raw settings of this Plugin in a Board's `board.config.json`, without `enabled`. */
function boardBag(plugins: Record<string, unknown> | undefined): Record<string, unknown> {
  const { enabled: _enabled, ...bag } = (plugins?.[PLUGIN_ID] ?? {}) as Record<string, unknown>;
  return bag;
}

/**
 * The text of a Stage Prompt file, or `null` when it is missing or cannot be read: a symbolic link,
 * which Rowbly does not follow (ADR-0019 §10), reads as no file.
 */
export async function readPrompt(read: () => Promise<string | null>): Promise<string | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

async function promptOf(
  plugin: PluginReadContext,
  level: Level,
  board: string | undefined,
  entry: StagePromptEntry | undefined,
): Promise<StagePrompt> {
  if (!entry) return { enabled: false, configured: false, source: null, path: null, exists: false, text: null };
  const name = resolvePath(level, board, entry.path);
  const text = name === null ? null : await readPrompt(() => plugin.files.read(scopeOf(level, board), name));
  return {
    enabled: entry.enabled && text !== null,
    configured: entry.enabled,
    source: level,
    path: entry.path ?? null,
    exists: text !== null,
    text,
  };
}

async function rows(
  plugin: PluginReadContext,
  stages: readonly Stage[],
  pick: (key: string) => { level: Level; entry: StagePromptEntry } | undefined,
  board: string | undefined,
): Promise<StagePromptRow[]> {
  return Promise.all(
    stages.map(async (stage) => {
      const found = pick(stage.key);
      return {
        key: stage.key,
        name: stage.name,
        category: stage.category,
        prompt: await promptOf(plugin, found?.level ?? 'global', board, found?.entry),
      };
    }),
  );
}

/**
 * Every Stage of the Board with its Stage Prompt: the Board's entry for a Stage replaces the global
 * one (ADR-0039 §2); global entries for Stages the Board does not have are left out.
 */
export async function boardOverview(plugin: PluginContext, board: string): Promise<StagePromptsOverview> {
  const [effective, global] = await Promise.all([
    plugin.services.config.effective(board),
    plugin.services.config.global(),
  ]);
  const own = entriesOf(boardBag(effective.board.plugins));
  const inherited = entriesOf(global.config.plugins?.[PLUGIN_ID]);
  const pick = (key: string) => {
    const mine = own[key];
    if (mine) return { level: 'board' as const, entry: mine };
    const theirs = inherited[key];
    return theirs ? { level: 'global' as const, entry: theirs } : undefined;
  };
  return { board, stagesSource: effective.stagesSource, stages: await rows(plugin, effective.stages, pick, board) };
}

/** One level alone: the global Stages with the global entries, or the Board's Stages with the Board's own. */
export async function levelOverview(
  plugin: PluginContext,
  level: Level,
  board: string | undefined,
): Promise<StagePromptsOverview> {
  if (level === 'global') {
    const global = await plugin.services.config.global();
    const entries = entriesOf(global.config.plugins?.[PLUGIN_ID]);
    const pick = (key: string) => (entries[key] ? { level, entry: entries[key] } : undefined);
    return { board: null, stagesSource: global.stagesSource, stages: await rows(plugin, global.stages, pick, board) };
  }
  if (!board) throw new UsageError('The board level needs a Board');
  const effective = await plugin.services.config.effective(board);
  const entries = entriesOf(boardBag(effective.board.plugins));
  const pick = (key: string) => (entries[key] ? { level, entry: entries[key] } : undefined);
  return { board, stagesSource: effective.stagesSource, stages: await rows(plugin, effective.stages, pick, board) };
}

/** The Stage `stage` of a level's Stages, or `NOT_FOUND`. */
async function stageAt(plugin: PluginContext, target: Target): Promise<Stage> {
  const stages =
    target.level === 'global'
      ? (await plugin.services.config.global()).stages
      : (await plugin.services.config.effective(target.board as string)).stages;
  const stage = stages.find((s) => s.key === target.stage);
  if (!stage)
    throw new NotFoundError(
      `Stage "${target.stage}" not found ${target.level === 'global' ? 'in the global Stages' : `on Board "${target.board}"`}`,
    );
  return stage;
}

/** The text a Stage Prompt starts with when it is turned on without a file. */
export function templateText(stage: Pick<Stage, 'name'>): string {
  return `# ${stage.name}\n\nWhat an agent does with a Story in the ${stage.name} Stage: what to read first, what to change, and when the Story is ready to leave it.\n`;
}

/** The text of the global Stage Prompt `entry`, which a new Board file starts from, or `null`. */
async function globalText(plugin: PluginReadContext, entry: StagePromptEntry | undefined): Promise<string | null> {
  const name = resolvePath('global', undefined, entry?.path);
  return name === null ? null : readPrompt(() => plugin.files.read('dataRoot', name));
}

export interface Target {
  level: Level;
  board?: string;
  stage: string;
}

export function checkTarget(target: Target): Target {
  if (target.level !== 'board' && target.level !== 'global') throw new UsageError('--level must be board or global');
  if (!isSlug(target.stage)) throw new UsageError('A Stage Prompt needs a Stage key');
  if (target.level === 'board' && !target.board) throw new UsageError('The board level needs a Board');
  return target.level === 'global' ? { level: 'global', stage: target.stage } : target;
}

/** Reads a level's entries from the Change Set and writes them back with `update` applied. */
async function updateEntries(
  changes: PluginChangeSet,
  plugin: PluginReadContext,
  target: Target,
  update: (entries: Entries) => Entries,
): Promise<void> {
  if (target.level === 'global') {
    await changes.updateRootConfig((config) => {
      const { enabled, ...rest } = (config.plugins?.[PLUGIN_ID] ?? {}) as Record<string, unknown>;
      const next = update({ ...storedEntries(rest, 'rowbly.config.json') });
      const { stagePrompts: _old, ...others } = rest;
      const entry = { ...others, ...(Object.keys(next).length ? { stagePrompts: next } : {}) };
      return { ...config, plugins: { ...config.plugins, [PLUGIN_ID]: { ...entry, enabled: enabled as boolean } } };
    });
    return;
  }
  const board = target.board as string;
  await changes.updateBoard(board, (config) => {
    const bag = boardBag(config.plugins);
    const next = update({ ...storedEntries(bag, `boards/${board}/board.config.json`) });
    const { stagePrompts: _old, ...others } = bag;
    const kept = { ...others, ...(Object.keys(next).length ? { stagePrompts: next } : {}) };
    return plugin.writeBag(config, Object.keys(kept).length ? kept : undefined);
  });
}

async function readEntries(changes: PluginChangeSet, plugin: PluginContext, target: Target): Promise<Entries> {
  if (target.level === 'global')
    return storedEntries((await plugin.services.config.global()).config.plugins?.[PLUGIN_ID], 'rowbly.config.json');
  const board = target.board as string;
  const pending = changes.board(board)?.after?.plugins;
  const stored = pending ?? (await plugin.services.boards.get(board)).plugins;
  return storedEntries(boardBag(stored as Record<string, unknown> | undefined), `boards/${board}/board.config.json`);
}

/**
 * Turns a Stage Prompt on or off, or saves its text (`software-factory.set`). Turning one on, or
 * saving text, gives it a file when its path does not resolve; turning one on without a file writes
 * a copy of the global Stage Prompt's file at the Board level when there is one, else a template.
 * Turning one off keeps the file.
 */
export async function setStagePrompt(
  plugin: PluginContext,
  target: Target,
  change: { enabled?: boolean; text?: string },
): Promise<StagePrompt> {
  const checked = checkTarget(target);
  if (change.enabled === undefined && change.text === undefined)
    throw new UsageError('Give a Stage Prompt an on/off setting or text');
  if (checked.level === 'board') await plugin.services.boards.get(checked.board as string);
  const stage = await stageAt(plugin, checked);
  const scope = scopeOf(checked.level, checked.board);
  return plugin.operation(
    'set',
    {
      level: checked.level,
      ...(checked.board ? { board: checked.board } : {}),
      stage: checked.stage,
      ...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
      ...(change.text !== undefined ? { text: change.text } : {}),
    },
    async (changes) => {
      const current = (await readEntries(changes, plugin, checked))[checked.stage];
      let path = current?.path;
      let name = resolvePath(checked.level, checked.board, path);
      const needsFile = change.enabled === true || change.text !== undefined;
      if (needsFile && name === null) {
        name = defaultName(checked.stage);
        path = `${folderOf(checked.level, checked.board)}${name}`;
      }
      let text = name === null ? null : await readPrompt(() => changes.readFile(scope, name as string));
      const global =
        checked.level === 'global'
          ? undefined
          : entriesOf((await plugin.services.config.global()).config.plugins?.[PLUGIN_ID])[checked.stage];
      if (name !== null && change.text !== undefined) text = change.text;
      else if (name !== null && needsFile && text === null)
        text = (await globalText(plugin, global)) ?? templateText(stage);
      if (name !== null && text !== null && needsFile) await changes.writeFile(scope, name, text);
      // A new Board entry starts with the setting it replaces, so saving text alone changes no on/off setting.
      const inherited = current ? undefined : global;
      const entry: StagePromptEntry = {
        enabled: change.enabled ?? current?.enabled ?? inherited?.enabled ?? false,
        ...(path ? { path } : {}),
      };
      await updateEntries(changes, plugin, checked, (entries) => ({ ...entries, [checked.stage]: entry }));
      return {
        enabled: entry.enabled && text !== null,
        configured: entry.enabled,
        source: checked.level,
        path: path ?? null,
        exists: text !== null,
        text,
      };
    },
  );
}

/** Removes a Stage Prompt's entry at one level and its file (`software-factory.remove`). */
export async function removeStagePrompt(plugin: PluginContext, target: Target): Promise<{ removed: string }> {
  const checked = checkTarget(target);
  if (checked.level === 'board') await plugin.services.boards.get(checked.board as string);
  const scope = scopeOf(checked.level, checked.board);
  return plugin.operation(
    'remove',
    { level: checked.level, ...(checked.board ? { board: checked.board } : {}), stage: checked.stage },
    async (changes) => {
      const current = (await readEntries(changes, plugin, checked))[checked.stage];
      if (!current)
        throw new NotFoundError(
          `No Stage Prompt for Stage "${checked.stage}" at the ${checked.level} level${checked.board ? ` of Board "${checked.board}"` : ''}`,
        );
      const name = resolvePath(checked.level, checked.board, current.path);
      // A file that cannot be read, such as a symbolic link, is left where it is; only the entry goes.
      if (name !== null && (await readPrompt(() => changes.readFile(scope, name))) !== null)
        await changes.deleteFile(scope, name);
      await updateEntries(changes, plugin, checked, (entries) => {
        const { [checked.stage]: _removed, ...rest } = entries;
        return rest;
      });
      return { removed: checked.stage };
    },
  );
}

/** The Stage Prompt of one Stage: effective on a Board, or at one level when `level` is given. */
export async function showStagePrompt(
  plugin: PluginContext,
  board: string | undefined,
  stage: string,
  level?: Level,
): Promise<StagePromptRow> {
  if (level !== undefined && level !== 'board' && level !== 'global')
    throw new UsageError('--level must be board or global');
  const overview =
    level === undefined && board
      ? await boardOverview(plugin, board)
      : await levelOverview(plugin, level ?? 'global', board);
  const row = overview.stages.find((s) => s.key === stage);
  if (!row) throw new NotFoundError(`Stage "${stage}" not found`);
  return row;
}

/** Checks `--level`; writes default to the Board level. */
export function parseLevel(value: string | undefined): Level | undefined {
  if (value === undefined) return undefined;
  if (value === 'board' || value === 'global') return value;
  throw new ValidationError('--level must be board or global');
}

/** One Stage as a line of the human table. */
export function rowLine(row: StagePromptRow): string[] {
  const { prompt } = row;
  return [
    row.key,
    row.name,
    prompt.enabled ? 'on' : prompt.configured ? 'on (no file)' : 'off',
    prompt.source ?? '—',
    prompt.path ?? '—',
  ];
}
