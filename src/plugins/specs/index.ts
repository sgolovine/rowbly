import {
  definePlugin,
  isSlug,
  type PluginFinding,
  type PluginInputOptions,
  type PluginOptionValues,
  parseRepeatable,
  UsageError,
} from '../../plugin-api';
import { commands } from './commands';
import {
  applySpecs,
  linkedSpecs,
  listSpecSlugs,
  parseSpecsInput,
  SpecsBag,
  SpecsInput,
  specFile,
  withoutSpecs,
} from './specs';

/**
 * Board Spec slugs from a repeatable `--spec`-like option, which also takes `a,b` (opting in to
 * `parseRepeatable`: trimmed, empty entries and duplicates dropped); `undefined` when it was not given.
 */
function slugs(value: PluginOptionValues[string]): string[] | undefined {
  if (value === undefined || typeof value === 'boolean') return undefined;
  const values = parseRepeatable(value);
  if (values.some((slug) => !isSlug(slug))) throw new UsageError('Board Spec links need lower-kebab-case slugs');
  return values;
}

const specOption = { flags: '--spec <slug>', description: 'link to a Board Spec (repeatable)', repeatable: true };
const setOptions: PluginInputOptions<SpecsInput> = {
  options: [specOption],
  input: ({ spec }) => (spec === undefined ? undefined : { specs: slugs(spec) }),
};

export const specs = definePlugin({
  id: 'specs',
  name: 'Specs',
  description: 'Spec documents for Stories and Boards',
  bags: { story: SpecsBag },
  // Checked before the operation runs: a malformed payload is VALIDATION and nothing is saved (DX-07).
  inputs: { 'stories.create': SpecsInput, 'stories.update': SpecsInput },
  commands,
  hooks: {
    'stories.create': {
      async transform({ changes, result, pluginInput, plugin }) {
        await applySpecs(changes, result.key, pluginInput, plugin);
      },
      async guard({ changes, pluginInput, plugin }) {
        if (pluginInput === undefined) return undefined;
        for (const change of changes.changes) {
          if (change.type !== 'story' || !change.after) continue;
          for (const slug of linkedSpecs(plugin, change.after)) {
            if ((await changes.readFile({ board: change.after.boardId }, specFile(slug))) === null)
              return { reject: `Board Spec "${slug}" not found on Board "${change.after.boardId}"` };
          }
        }
        return undefined;
      },
    },
    'stories.update': {
      async transform({ changes, input, pluginInput, plugin }) {
        await applySpecs(changes, input.key, pluginInput, plugin);
      },
      // Only links this edit adds are checked. A stale link the Story already had is doctor's job,
      // so it neither blocks an unrelated edit nor keeps the person from removing it.
      async guard({ changes, input, pluginInput, plugin }) {
        if (pluginInput === undefined) return undefined;
        const change = changes.story(input.key);
        if (!change?.after) return undefined;
        const before = change.before ? linkedSpecs(plugin, change.before) : [];
        for (const slug of linkedSpecs(plugin, change.after)) {
          if (before.includes(slug)) continue;
          if ((await changes.readFile({ board: change.after.boardId }, specFile(slug))) === null)
            return { reject: `Board Spec "${slug}" not found on Board "${change.after.boardId}"` };
        }
        return undefined;
      },
    },
    'boards.remove': {
      async guard({ input, plugin }) {
        if (!input.force && (await listSpecSlugs(plugin, input.id)).length)
          return {
            reject: `Board "${input.id}" has Board Specs`,
            hint: 'pass --force to delete it with its Board Specs',
            canForce: true,
          };
        return undefined;
      },
    },
  },
  options: {
    'stories create': setOptions,
    'stories edit': {
      options: [
        specOption,
        { flags: '--add-spec <slug>', description: 'add a Board Spec link (repeatable)', repeatable: true },
        { flags: '--remove-spec <slug>', description: 'remove a Board Spec link (repeatable)', repeatable: true },
        {
          flags: '--reset-specs',
          description: 'replace the stored Board Spec links, even invalid ones, with --spec (or none)',
        },
      ],
      input: ({ spec, addSpec, removeSpec, resetSpecs }) => {
        if (spec === undefined && addSpec === undefined && removeSpec === undefined && !resetSpecs) return undefined;
        return parseSpecsInput({
          specs: slugs(spec) ?? (resetSpecs ? [] : undefined),
          addSpecs: slugs(addSpec),
          removeSpecs: slugs(removeSpec),
          ...(resetSpecs ? { reset: true } : {}),
        });
      },
    },
    'stories list': {
      options: [{ ...specOption, description: 'only Stories linked to any of these Board Specs (repeatable)' }],
      filter: ({ spec }) => slugs(spec),
    },
  },
  // An invalid bag is unknown rather than "no links", so it matches no Spec filter; doctor reports it.
  filterStories(story, filter, plugin) {
    if (!Array.isArray(filter)) return false;
    const linked = linkedSpecs(plugin, story);
    return filter.some((slug) => linked.includes(slug));
  },
  doctor: {
    async check({ data, plugin }) {
      // Whether each `(Board, slug)` document exists, for this check only: Stories that link to the
      // same document share one read. Board ids and slugs cannot hold `/`, so keys cannot collide.
      const exists = new Map<string, Promise<boolean>>();
      const found = (board: string, slug: string) => {
        const key = `${board}/${slug}`;
        let read = exists.get(key);
        if (!read) {
          read = plugin.files.read({ board }, specFile(slug)).then((text) => text !== null);
          exists.set(key, read);
        }
        return read;
      };
      const findings: PluginFinding[] = [];
      for (const story of data.stories) {
        const missing: string[] = [];
        for (const slug of linkedSpecs(plugin, story)) {
          if (!(await found(story.boardId, slug))) missing.push(slug);
        }
        if (!missing.length) continue;
        findings.push({
          code: 'MISSING_SPEC',
          severity: 'warning',
          path: `boards/${story.boardId}/stories/${story.key}/story.json`,
          message: `${story.key} links to missing Board Specs: ${missing.join(', ')}`,
          async fix(changes) {
            await changes.updateStory(story.key, (s) => withoutSpecs(plugin, s, missing));
            return `unlinked missing Board Specs from ${story.key}`;
          },
        });
      }
      return findings;
    },
  },
  tui: () => import('./tui').then((m) => m.tui),
});
