// The compiled examples of docs/plugins/api.md. `test/docs/tutorial.test.ts` checks that the
// reference shows each region.
import { DataIntegrityError, definePlugin, type PluginContext, z } from '../../../src/plugin-api';

// #region safe-parse
const Tally = z.object({ version: z.literal(1), count: z.number().int().min(0) });

/** Reads `plugins/tally/tally.json`; a file that does not parse is an error, never an empty tally. */
async function readTally(plugin: PluginContext): Promise<z.output<typeof Tally> | undefined> {
  const text = await plugin.files.read('dataRoot', 'tally.json');
  if (text === null) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const parsed = Tally.safeParse(json);
  if (!parsed.success) {
    throw new DataIntegrityError('plugins/tally/tally.json is not valid', {
      details: { path: 'plugins/tally/tally.json', issues: parsed.error.issues },
      hint: 'run `rowbly doctor`',
    });
  }
  return parsed.data;
}
// #endregion

// #region root-settings
/** Saves new Data Root settings, keeping `enabled` and every other Plugin's entry. */
async function saveSettings(plugin: PluginContext, settings: { count: number }): Promise<void> {
  await plugin.operation('configure', {}, (changes) =>
    changes.updateRootConfig((config) => ({
      ...config,
      plugins: { ...config.plugins, tally: { ...settings, enabled: config.plugins?.tally?.enabled } },
    })),
  );
}
// #endregion

export const tally = definePlugin({
  id: 'tally',
  name: 'Tally',
  description: 'Counts things',
  // #region action
  actions: [
    {
      key: 'x',
      label: 'tally Task',
      target: 'task',
      // A `task` Action runs only where a Task is in focus, and always gets its Story too.
      run: ({ focus, ui }) => ui.toast(`${focus.task.id} of Story ${focus.story.key}`),
    },
  ],
  // #endregion
});

export { readTally, saveSettings };
