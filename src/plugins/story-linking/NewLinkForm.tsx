import { type PluginScreenProps, UsageError } from '../../plugin-api';
import { Box, Form, Loading, Text, theme, useAsync } from '../../plugin-api/tui';
import { addLink } from './links';

/** The choices come only from the current Story's Board; the operation rechecks them under its lock. */
export function NewLinkForm({ params, plugin, ui }: PluginScreenProps) {
  const data = useAsync(async () => {
    if (typeof params.target !== 'string') throw new UsageError('a new Story link needs a Story Key');
    const story = await plugin.services.stories.get(params.target);
    const choices = (await plugin.services.stories.list(story.boardId, {})).filter(
      (candidate) => candidate.key !== story.key,
    );
    return { story, choices };
  }, [plugin, params.target]);
  if (!data.data)
    return data.loading ? (
      <Loading label="Loading Stories…" />
    ) : (
      <Text color={theme.danger}>Could not load Stories.</Text>
    );
  const { story, choices } = data.data;
  if (choices.length === 0)
    return <Text color={theme.inkFaint}>Create another Story on this Board to add a link.</Text>;
  return (
    <Box flexDirection="column" gap={1}>
      <Text>Link {story.key} to another Story on this Board.</Text>
      <Form
        fields={[
          {
            name: 'direction',
            label: 'Relationship',
            kind: 'select',
            required: true,
            options: ['blocks', 'blocked-by'],
            optionLabels: { blocks: 'Blocks', 'blocked-by': 'Blocked by' },
          },
          {
            name: 'story',
            label: 'Story',
            kind: 'select',
            required: true,
            options: choices.map((candidate) => candidate.key),
            optionLabels: Object.fromEntries(
              choices.map((candidate) => [candidate.key, `${candidate.key} · ${candidate.name}`]),
            ),
          },
        ]}
        initialValues={{ direction: 'blocks', story: null }}
        submitLabel="add link"
        onSubmit={async (values) => {
          const key = String(values.story);
          const pair =
            values.direction === 'blocked-by'
              ? await addLink(plugin, key, story.key)
              : await addLink(plugin, story.key, key);
          ui.toast(`${pair.blocker} blocks ${pair.blocked}`);
          ui.back();
        }}
      />
    </Box>
  );
}
