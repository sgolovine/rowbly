import type { PluginTui } from '../../plugin-api';
import { SpecFormScreen } from './SpecFormScreen';
import { SpecsCreateTab, type StorySpecDraft } from './SpecsCreateTab';
import { SpecsScreen } from './SpecsScreen';
import { SpecsSection } from './SpecsSection';
import { SpecTab } from './SpecTab';
import { linkedSpecs, listSpecSlugs, SpecsBag } from './specs';

export const tui: PluginTui<Record<string, unknown>> = {
  screens: { list: SpecsScreen, form: SpecFormScreen },
  home: [{ label: 'Specs', screen: 'list' }],
  storyCreateTabs: [
    {
      label: 'Specs',
      component: SpecsCreateTab,
      input: (draft) => ({
        storySpecs: (draft as StorySpecDraft[]).map((s) => ({ ...s, title: s.title || undefined })),
      }),
    },
  ],
  storyTabs: [{ label: 'Specs', component: SpecTab }],
  boardSections: [SpecsSection],
  storyForm: {
    async fields({ boardId, story, plugin }) {
      if (story && plugin.inspectBag(story, SpecsBag).kind === 'invalid') {
        return [
          {
            name: 'specs',
            label: 'Specs',
            kind: 'multiselect',
            unavailable: 'stored value is invalid; kept unchanged',
          },
        ];
      }
      const linked = story ? linkedSpecs(plugin, story) : [];
      // A link to a Board Spec that is gone stays a choice, so the person can see and remove it.
      const options = [...new Set([...(await listSpecSlugs(plugin, boardId)), ...linked])];
      return [{ name: 'specs', label: 'Specs', kind: 'multiselect', options, value: linked }];
    },
    input: ({ values, story }) => {
      // `null` is the reset of an invalid stored value: replace it with no links.
      if (values.specs === null) return { specs: [], reset: true };
      const specs = Array.isArray(values.specs) ? values.specs : [];
      return !story && !specs.length ? undefined : { specs };
    },
  },
  storyFilter: {
    async fields({ boardId, plugin }) {
      return [{ name: 'specs', label: 'Spec', kind: 'multiselect', options: await listSpecSlugs(plugin, boardId) }];
    },
    filter: (values) => (Array.isArray(values.specs) && values.specs.length ? values.specs : undefined),
    describe: (values) =>
      Array.isArray(values.specs) && values.specs.length ? `Spec: ${values.specs.join(', ')}` : '',
  },
};
