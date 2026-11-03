import {
  definePlugin,
  type PluginChangeSet,
  type PluginOptionValues,
  type PluginReadContext,
  z,
} from '../../plugin-api';
import { commands } from './commands';
import { GitHubBag, GitHubInput } from './model';
import { boardStats } from './stats';

async function applyInput(
  plugin: PluginReadContext,
  changes: PluginChangeSet,
  key: string,
  input: z.output<typeof GitHubInput> | undefined,
): Promise<void> {
  if (input === undefined) return;
  await changes.updateStory(key, (story) => {
    plugin.requireBag(story, GitHubBag);
    return plugin.writeBag(story, input.pr === null ? undefined : { pr: input.pr });
  });
}

const option = { flags: '--github-pr <url>', description: 'GitHub PR URL; an empty value clears a supported link' };
const input = ({ githubPr }: PluginOptionValues) =>
  typeof githubPr !== 'string' ? undefined : { pr: githubPr === '' ? null : githubPr };

export const github = definePlugin({
  id: 'github',
  name: 'GitHub',
  description: 'Link a GitHub PR to a Story and inspect it with gh',
  settings: z.object({}),
  bags: { story: GitHubBag },
  inputs: { 'stories.create': GitHubInput, 'stories.update': GitHubInput },
  externalReads: ['gh-pr-view', 'gh-pr-commits'],
  boardStats,
  commands,
  options: {
    'stories create': { options: [option], input },
    'stories edit': { options: [option], input },
  },
  hooks: {
    'stories.create': {
      transform: ({ plugin, changes, result, pluginInput }) => applyInput(plugin, changes, result.key, pluginInput),
    },
    'stories.update': {
      transform: ({ plugin, changes, input, pluginInput }) => applyInput(plugin, changes, input.key, pluginInput),
    },
  },
  async storyRows(story, plugin) {
    const bag = plugin.inspectBag(story, GitHubBag);
    return [
      {
        label: 'GitHub PR',
        value:
          bag.kind === 'invalid'
            ? 'unavailable (stored value is invalid; kept unchanged)'
            : bag.kind === 'valid'
              ? bag.value.pr
              : 'none',
      },
    ];
  },
  async storyContext(story, plugin) {
    const pr = plugin.requireBag(story, GitHubBag)?.pr ?? null;
    return { title: 'GitHub PR', text: pr ?? 'None.', data: { pr } };
  },
  tui: () => import('./tui').then((m) => m.tui),
});
