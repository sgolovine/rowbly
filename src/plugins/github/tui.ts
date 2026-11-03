import type { PluginTui } from '../../plugin-api';
import { GitHubPrTab } from './GitHubPrTab';
import { GitHubBag } from './model';

export const tui: PluginTui = {
  storyTabs: [{ label: 'GitHub PR', component: GitHubPrTab }],
  storyForm: {
    async fields({ story, plugin }) {
      const bag = story ? plugin.inspectBag(story, GitHubBag) : { kind: 'absent' as const };
      return [
        {
          name: 'githubPr',
          label: 'GitHub PR',
          kind: 'text',
          ...(bag.kind === 'invalid'
            ? { unavailable: 'stored value is invalid; repair by hand' }
            : { value: bag.kind === 'valid' ? bag.value.pr : '' }),
        },
      ];
    },
    input({ values, story }) {
      const pr = values.githubPr;
      if (typeof pr === 'string' && pr !== '') return { pr };
      return story ? { pr: null } : undefined;
    },
  },
};
