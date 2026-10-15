import type { PluginTui } from '../../plugin-api';
import { SpecDetailScreen } from './SpecDetailScreen';
import { SpecFormScreen } from './SpecFormScreen';
import { SpecsScreen } from './SpecsScreen';
import { SpecsSection } from './SpecsSection';
import { SpecTab } from './SpecTab';
import { linkedSpecs, listSpecs, SpecsBag } from './specs';

export const tui: PluginTui<Record<string, unknown>> = {
  screens: { list: SpecsScreen, detail: SpecDetailScreen, form: SpecFormScreen },
  home: [{ label: 'Specs', screen: 'list' }],
  storyTabs: [{ label: 'Spec', component: SpecTab }],
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
      return [
        {
          name: 'specs',
          label: 'Specs',
          kind: 'multiselect',
          options: (await listSpecs(plugin, boardId)).map((s) => s.slug as string),
          value: story ? linkedSpecs(plugin, story) : [],
        },
      ];
    },
    input: ({ values }) => ({ specs: Array.isArray(values.specs) ? values.specs : [] }),
  },
  storyFilter: {
    async fields({ boardId, plugin }) {
      return [
        {
          name: 'specs',
          label: 'Spec',
          kind: 'multiselect',
          options: (await listSpecs(plugin, boardId)).map((s) => s.slug as string),
        },
      ];
    },
    filter: (values) => (Array.isArray(values.specs) && values.specs.length ? values.specs : undefined),
    describe: (values) =>
      Array.isArray(values.specs) && values.specs.length ? `Spec: ${values.specs.join(', ')}` : '',
  },
};
