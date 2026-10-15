import { definePlugin, isSlug, type PluginCommandOptions, type PluginFinding, UsageError } from '../../plugin-api';
import { commands } from './commands';
import { applySpecs, linkedSpecs, listSpecs, SpecsBag, SpecsInput, setSpecs } from './specs';

function slugs(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  const values = (Array.isArray(value) ? value : [value]).flatMap((v) => String(v).split(',')).filter(Boolean);
  if (values.some((slug) => !isSlug(slug))) throw new UsageError('Board Spec links need lower-kebab-case slugs');
  return values;
}

const specOption = { flags: '--spec <slug>', description: 'link to a Board Spec (repeatable)', repeatable: true };
const setOptions: PluginCommandOptions = {
  options: [specOption],
  input: ({ spec }) => (spec === undefined ? undefined : { specs: slugs(spec) }),
};

export const specs = definePlugin({
  id: 'specs',
  name: 'Specs',
  description: 'Spec documents for Stories and Boards',
  bags: { story: SpecsBag },
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
            if ((await changes.readFile({ board: change.after.boardId }, `${slug}.md`)) === null)
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
      async guard({ changes, input, pluginInput, plugin }) {
        if (pluginInput === undefined) return undefined;
        const change = changes.story(input.key);
        if (!change?.after) return undefined;
        const requested = SpecsInput.parse(pluginInput);
        const selected = [...(requested.specs ?? []), ...(requested.addSpecs ?? [])];
        for (const slug of linkedSpecs(plugin, change.after)) {
          if (
            selected.includes(slug) &&
            (await changes.readFile({ board: change.after.boardId }, `${slug}.md`)) === null
          )
            return { reject: `Board Spec "${slug}" not found on Board "${change.after.boardId}"` };
        }
        return undefined;
      },
    },
    'boards.remove': {
      async guard({ input, plugin }) {
        if (!input.force && (await listSpecs(plugin, input.id)).length)
          return { reject: `Board "${input.id}" has Board Specs`, hint: 'pass --force to delete it' };
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
      ],
      input: ({ spec, addSpec, removeSpec }) => {
        if (spec !== undefined && (addSpec !== undefined || removeSpec !== undefined))
          throw new UsageError('Use --spec alone, or --add-spec and --remove-spec');
        return spec === undefined && addSpec === undefined && removeSpec === undefined
          ? undefined
          : { specs: slugs(spec), addSpecs: slugs(addSpec), removeSpecs: slugs(removeSpec) };
      },
    },
    'stories list': {
      options: [{ ...specOption, description: 'only Stories linked to any of these Board Specs (repeatable)' }],
      input: ({ spec }) => slugs(spec),
    },
  },
  filterStories: (story, filter, plugin) =>
    Array.isArray(filter) && filter.some((slug) => linkedSpecs(plugin, story).includes(slug)),
  doctor: {
    async check({ data, plugin }) {
      const findings: PluginFinding[] = [];
      for (const story of data.stories) {
        const missing: string[] = [];
        for (const slug of linkedSpecs(plugin, story)) {
          if ((await plugin.files.read({ board: story.boardId }, `${slug}.md`)) === null) missing.push(slug);
        }
        if (!missing.length) continue;
        findings.push({
          code: 'MISSING_SPEC',
          severity: 'warning',
          path: `boards/${story.boardId}/stories/${story.key}/story.json`,
          message: `${story.key} links to missing Board Specs: ${missing.join(', ')}`,
          async fix(changes) {
            await changes.updateStory(story.key, (s) =>
              setSpecs(
                plugin,
                s,
                linkedSpecs(plugin, s).filter((slug) => !missing.includes(slug)),
              ),
            );
            return `unlinked missing Board Specs from ${story.key}`;
          },
        });
      }
      return findings;
    },
  },
  tui: () => import('./tui').then((m) => m.tui),
});
