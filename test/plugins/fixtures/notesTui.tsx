// The TUI part of the Notes fixture Plugin, loaded only when the TUI starts.
import type {
  PluginBoardSectionProps,
  PluginScreenProps,
  PluginStoryTabProps,
  PluginTui,
} from '../../../src/plugin-api';
import { Box, Text, useAsync, useKeyHints } from '../../../src/plugin-api/tui';
import { NoteBag, type NotesSettings } from './notes';

function NoteScreen({ params, plugin }: PluginScreenProps<NotesSettings>) {
  const key = typeof params.key === 'string' ? params.key : undefined;
  const story = useAsync(async () => (key ? plugin.services.stories.get(key) : null), [plugin, key]);
  const files = useAsync(() => plugin.files.list('dataRoot'), [plugin]);
  useKeyHints([{ key: 'esc', description: 'back' }]);
  const note = story.data ? plugin.readBag(story.data, NoteBag)?.note : undefined;
  return (
    <Box flexDirection="column">
      <Text>{key ? `Note of ${key}: ${note ?? 'none'}` : 'All notes'}</Text>
      <Text>{`Files: ${(files.data ?? []).join(', ') || 'none'}`}</Text>
    </Box>
  );
}

function NoteTab({ story, plugin }: PluginStoryTabProps<NotesSettings>) {
  return <Text>{`Tab note: ${plugin.readBag(story, NoteBag)?.note ?? 'none'}`}</Text>;
}

function NoteSection({ board, plugin }: PluginBoardSectionProps<NotesSettings>) {
  return <Text>{`Notes marker on ${board.id}: ${plugin.settings.marker}`}</Text>;
}

export const notesTui: PluginTui<NotesSettings> = {
  screens: { note: NoteScreen },
  home: [{ label: 'Notes', screen: 'note' }],
  settings: [{ label: 'Notes', screen: 'note' }],
  storyForm: {
    async fields({ story, plugin }) {
      const note = story ? plugin.readBag(story, NoteBag)?.note : undefined;
      return [{ name: 'note', label: 'Note', kind: 'text', value: note ?? '' }];
    },
    input: ({ values, story }) => {
      const note = typeof values.note === 'string' ? values.note : '';
      if (note !== '') return { note };
      return story ? { note: null } : undefined;
    },
  },
  storyFilter: {
    async fields() {
      return [{ name: 'noted', label: 'With a note', kind: 'boolean' }];
    },
    filter: (values) => (values.noted === true ? true : undefined),
    describe: (values) => (values.noted === true ? 'noted' : ''),
  },
  storyTabs: [{ label: 'Note', component: NoteTab }],
  boardSections: [NoteSection],
};
