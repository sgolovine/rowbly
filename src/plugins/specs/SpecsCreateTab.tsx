import type { PluginStoryCreateTabProps } from '../../plugin-api';
import { Box, Form, SelectList, Text, useInput, useKeyHints, useState } from '../../plugin-api/tui';

export interface StorySpecDraft {
  slug: string;
  title: string;
  text: string;
}

/** Multiple unsaved Story Specs; linked Board Specs use this tab's relocated storyForm fields. */
export function SpecsCreateTab({ draft, onChange, active }: PluginStoryCreateTabProps) {
  const specs = (draft ?? []) as StorySpecDraft[];
  const [editing, setEditing] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  useKeyHints(
    active && editing === null
      ? [
          { key: 'n', description: 'new Story Spec' },
          { key: 'enter', description: 'edit Story Spec' },
          { key: 'd', description: 'remove draft' },
        ]
      : [],
  );
  useInput(
    (input) => {
      if (input === 'n') {
        onChange([...specs, { slug: 'spec', title: '', text: '' }]);
        setEditing(specs.length);
      } else if (input === 'd') onChange(specs.filter((_, i) => i !== selected));
    },
    { isActive: active && editing === null },
  );
  const spec = editing === null ? undefined : specs[editing];
  return (
    <Box flexDirection="column" gap={1}>
      <Text>{specs.length} Story Spec drafts</Text>
      {spec ? (
        <Form
          key={editing}
          fields={[
            { name: 'slug', label: 'Slug', kind: 'text', required: true },
            { name: 'title', label: 'Title', kind: 'text' },
            { name: 'text', label: 'Markdown', kind: 'multiline' },
          ]}
          initialValues={{ ...spec }}
          values={{ ...spec }}
          onChange={(values) =>
            onChange(
              specs.map((s, i) =>
                i === editing
                  ? { slug: String(values.slug), title: String(values.title), text: String(values.text) }
                  : s,
              ),
            )
          }
          isActive={active}
          onSubmit={() => setEditing(null)}
          submitLabel="keep draft"
        />
      ) : (
        <SelectList
          items={specs.map((s, i) => ({ value: i, label: `${s.slug} · ${s.title || '(title from Markdown)'}` }))}
          onHighlight={(item) => setSelected(item?.value ?? 0)}
          onSelect={(item) => setEditing(item.value)}
          isActive={active}
          emptyText="No Story Spec drafts. Press n for a new Story Spec."
        />
      )}
    </Box>
  );
}
