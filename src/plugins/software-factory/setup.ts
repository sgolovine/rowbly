import { ConflictError, type PluginContext, type StageConfig, toTimestamp } from '../../plugin-api';
import { DEFAULT_PROMPTS, FACTORY_STAGES } from './defaultPrompts';
import {
  boardBag,
  defaultName,
  entriesOf,
  folderOf,
  type Level,
  PLUGIN_ID,
  type StagePromptEntry,
  scopeOf,
  templateText,
  updateEntries,
} from './stagePrompts';

/** A factory Stage after setup: `custom` when the Board has its key under another name, which is kept. */
export interface SetupStage {
  key: string;
  name: string;
  outcome: 'added' | 'present' | 'custom';
}

/** A default Stage Prompt after setup: written, kept because a level has an entry, or skipped. */
export interface SetupPrompt {
  key: string;
  outcome: 'added' | 'kept' | 'skipped';
  source: Level | null;
  enabled: boolean;
  path: string | null;
  reason?: string;
}

export interface SetupResult {
  board: string;
  stages: SetupStage[];
  prompts: SetupPrompt[];
}

/** Where a missing factory Stage goes among the configured Stages, which keep their order. */
function insertAt(stages: StageConfig[], key: string): number {
  const after = (k: string) => stages.findIndex((s) => s.key === k) + 1;
  if (key === 'todo') return 0;
  if (key === 'in-progress') return after('todo');
  return stages.some((s) => s.key === 'in-progress') ? after('in-progress') : stages.length;
}

/**
 * Gives a Board the factory Stages and default Stage Prompts it lacks (`software-factory.setup`,
 * ADR-0053 §2). It never renames, moves or removes a Stage, and never writes over an entry at either
 * level or over a file: what the Board or the global level already has is kept.
 */
export async function setupFactory(
  plugin: PluginContext,
  board: string,
  promptKind: 'default' | 'minimal' = 'default',
): Promise<SetupResult> {
  await plugin.services.boards.get(board);
  return plugin.operation('setup', { board, prompts: promptKind }, async (changes) => {
    const [stored, effective, global] = await Promise.all([
      plugin.services.boards.get(board),
      plugin.services.config.effective(board),
      plugin.services.config.global(),
    ]);
    const configured = effective.stages
      .filter((s) => s.category === 'board')
      .map((s): StageConfig => ({ key: s.key, name: s.name }));

    const stages: SetupStage[] = [];
    const next = [...configured];
    for (const factory of FACTORY_STAGES) {
      const own = configured.find((s) => s.key === factory.key);
      if (own) {
        const same = own.name.toLowerCase() === factory.name.toLowerCase();
        stages.push({ key: own.key, name: own.name, outcome: same ? 'present' : 'custom' });
        continue;
      }
      // Another Stage with this name would leave two Stages a person cannot tell apart.
      const named = effective.stages.find((s) => s.name.toLowerCase() === factory.name.toLowerCase());
      if (named)
        throw new ConflictError(
          `Stage "${named.key}" is named "${named.name}"; the factory Stage "${factory.key}" needs that name`,
          {
            details: { board, stage: named.key, factoryStage: factory.key },
            hint: `rename Stage "${named.key}" or give it the key "${factory.key}", then run setup again`,
          },
        );
      next.splice(insertAt(next, factory.key), 0, { ...factory });
      stages.push({ key: factory.key, name: factory.name, outcome: 'added' });
    }
    // Only a missing Stage gives the Board its own list, so an inherited one stays inherited.
    if (stages.some((s) => s.outcome === 'added')) {
      const now = toTimestamp(plugin.now());
      await changes.updateBoard(board, (config) => ({ ...config, stages: next, updatedAt: now }));
    }

    const own = entriesOf(boardBag(stored.plugins));
    const inherited = entriesOf(global.config.plugins?.[PLUGIN_ID]);
    const scope = scopeOf('board', board);
    const prompts: SetupPrompt[] = [];
    const added: Record<string, StagePromptEntry> = {};
    for (const stage of FACTORY_STAGES) {
      const key = stage.key;
      const prompt = promptKind === 'minimal' ? { text: templateText(stage), enabled: false } : DEFAULT_PROMPTS[key];
      if (!prompt) continue;
      const entry = own[key]
        ? { level: 'board' as const, entry: own[key] }
        : inherited[key] && { level: 'global' as const, entry: inherited[key] };
      if (entry) {
        prompts.push({
          key,
          outcome: 'kept',
          source: entry.level,
          enabled: entry.entry.enabled,
          path: entry.entry.path ?? null,
        });
        continue;
      }
      const name = defaultName(key);
      const path = `${folderOf('board', board)}${name}`;
      const existing = await changes.readFile(scope, name).then(
        (text) => (text === null ? null : 'a file is already there'),
        () => 'a file is already there that cannot be read',
      );
      if (existing) {
        prompts.push({ key, outcome: 'skipped', source: null, enabled: false, path, reason: existing });
        continue;
      }
      await changes.writeFile(scope, name, prompt.text);
      added[key] = { enabled: prompt.enabled, path };
      prompts.push({ key, outcome: 'added', source: 'board', enabled: prompt.enabled, path });
    }
    if (Object.keys(added).length)
      await updateEntries(changes, plugin, { level: 'board', board, stage: 'todo' }, (entries) => ({
        ...entries,
        ...added,
      }));
    return { board, stages, prompts };
  });
}
