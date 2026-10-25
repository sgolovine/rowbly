// The compiled examples of docs/plugins/api.md. `test/docs/tutorial.test.ts` checks that the
// reference shows each region.
import {
  DataIntegrityError,
  definePlugin,
  type PluginContext,
  type RequiredStage,
  type RequiredStory,
  z,
} from '../../../src/plugin-api';

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
      label: 'tally Story',
      target: 'story',
      // A `story` Action runs only where a Story is in focus.
      run: ({ focus, ui }) => ui.toast(`${focus.story.key} on Board ${focus.story.boardId}`),
    },
  ],
  // #endregion
});

export { readTally, saveSettings };

// #region reconciliation
export const mergeNotes = definePlugin({
  id: 'merge-notes',
  name: 'Merge Notes',
  description: 'Notes with a supported reconciliation format',
  reconcile({ base, left, right, helpers }) {
    const bags: Record<string, unknown> = {};
    const schema = z.strictObject({ version: z.literal(1), note: z.string() });
    for (const scope of new Set([...Object.keys(left.bags), ...Object.keys(right.bags)])) {
      const raw = [base.bags[scope], left.bags[scope], right.bags[scope]];
      if (raw.some((value) => value !== undefined && !schema.safeParse(value).success)) continue;
      bags[scope] = helpers.value(raw[0], raw[1], raw[2], `${scope}/merge-notes`);
    }
    return { bags, files: {}, requiredStories: [] as RequiredStory[], requiredStages: [] as RequiredStage[] };
  },
});
// #endregion

// #region binary-files
/** Saves PNG bytes and the Story's bag together in one recoverable operation. */
export async function saveImage(plugin: PluginContext, key: string, png: Uint8Array): Promise<void> {
  await plugin.operation('save-image', { key }, async (changes) => {
    const scope = { story: key };
    await changes.writeBinaryFile(scope, 'image.png', png);
    await changes.updateStory(key, (story) => plugin.writeBag(story, { image: 'image.png' }));
    const pending = await changes.readBinaryFile(scope, 'image.png');
    if (pending === null) throw new Error('Missing pending image');
  });
  const stored = await plugin.files.readBinary({ story: key }, 'image.png');
  if (stored === null) throw new Error('Missing saved image');
}
// #endregion
