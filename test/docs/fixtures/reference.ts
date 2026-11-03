// The compiled examples of docs/plugins/api.md. `test/docs/tutorial.test.ts` checks that the
// reference shows each region.
import {
  type ClipboardImageResult,
  clipboard,
  DataIntegrityError,
  definePlugin,
  type PluginContext,
  type PluginFileList,
  type PluginFileRead,
  type PluginFileRequest,
  type PluginReadContext,
  type PluginTui,
  type RequiredStage,
  type RequiredStory,
  readBinaryInput,
  type Story,
  UsageError,
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

// #region clipboard
/** Read before starting the operation that saves the image. */
export async function readPastedImage(): Promise<ClipboardImageResult> {
  const image = await clipboard.readImage();
  if ('reason' in image) return image;
  return { bytes: image.bytes, type: image.type };
}
// #endregion

// #region binary-input
/** Read external bytes before saving; opening is limited to the caller's own Plugin files. */
export async function importImage(plugin: PluginContext, key: string, path: string): Promise<void> {
  const input = await readBinaryInput(path, 10 * 1024 * 1024);
  await saveImage(plugin, key, input.bytes);
  await plugin.openFile({ story: key }, 'image.png');
}
// #endregion

// #region batched-reads
/** Each Story's note, read in batches; a note that cannot be read shows as unavailable. */
export async function storyNotes(plugin: PluginReadContext, stories: readonly Story[]): Promise<Map<string, string>> {
  const requests: PluginFileRequest[] = stories.map((story) => ({ scope: { story: story.key }, name: 'note.md' }));
  const read: PluginFileRead[] = await plugin.files.readMany(requests);
  const notes = new Map<string, string>();
  stories.forEach((story, at) => {
    const file = read[at];
    if (file?.status === 'found') notes.set(story.key, file.text);
    else if (file?.status === 'failed') notes.set(story.key, `unavailable (${file.code})`);
  });
  return notes;
}

/** How many files each Story has, listed in batches. */
export async function fileCounts(plugin: PluginReadContext, stories: readonly Story[]): Promise<number[]> {
  const lists: PluginFileList[] = await plugin.files.listMany(stories.map((story) => ({ story: story.key })));
  return lists.map((list) => (list.status === 'found' ? list.names.length : 0));
}

/** Search inputs are detached deep copies: key the loaded text by Story Key, not object identity. */
export const searchableNotes: PluginTui = {
  async loadStorySearchText({ stories, plugin }) {
    const notes = await storyNotes(plugin, stories);
    return (story) => {
      const note = notes.get(story.key);
      return note === undefined ? [] : [note];
    };
  },
};
// #endregion

// #region external-reads
export const externalReader = definePlugin({
  id: 'external-reader',
  name: 'External reader',
  description: 'Inspect a pull request through a fixed host template',
  externalReads: ['gh-pr-view'],
  commands(group, cli) {
    group.command('read <url>').action((url: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        const result = await plugin.externalRead('gh-pr-view', { url });
        if (result.exitCode !== 0) throw new UsageError('External read failed', { hint: result.stderr });
        print(result, (value) => value.stdout);
      }),
    );
  },
});
// #endregion

// #region board-stats
export const statistics = definePlugin({
  id: 'statistics',
  name: 'Statistics',
  description: 'Contribute one read-only Board statistic',
  boardStats: {
    metrics: [{ key: 'count', label: 'Existing Stories' }],
    async collect({ stories }) {
      return { count: { status: 'complete', value: stories.length } };
    },
  },
});
// #endregion
