import type { PluginStoryCreateTabProps } from '../../plugin-api';
import { Box, Form, Loading, SelectList, Text, useAsync, useInput, useKeyHints, useState } from '../../plugin-api/tui';
import type { LinkDirection } from './model';

export interface LinkDraft {
  direction: LinkDirection;
  key: string;
}

export function LinksCreateTab({ draft, onChange, boardId, active, plugin }: PluginStoryCreateTabProps) {
  const links = (draft ?? []) as LinkDraft[];
  const [editing, setEditing] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  const data = useAsync(() => plugin.services.stories.list(boardId, {}), [plugin, boardId]);
  useKeyHints(
    active && editing === null
      ? [
          { key: 'n', description: 'new link' },
          { key: 'enter', description: 'edit link' },
          { key: 'd', description: 'remove draft' },
        ]
      : [],
  );
  useInput(
    (input) => {
      if (input === 'n') {
        onChange([...links, { direction: 'blocks', key: '' }]);
        setEditing(links.length);
      } else if (input === 'd') onChange(links.filter((_, i) => i !== selected));
    },
    { isActive: active && editing === null },
  );
  if (data.error) throw data.error;
  if (!data.data) return <Loading />;
  const link = editing === null ? undefined : links[editing];
  return (
    <Box flexDirection="column" gap={1}>
      <Text>{links.length} link drafts</Text>
      {link ? (
        <Form
          key={editing}
          fields={[
            {
              name: 'direction',
              label: 'Relationship',
              kind: 'select',
              options: ['blocks', 'blocked-by'],
              optionLabels: { blocks: 'Blocks', 'blocked-by': 'Blocked by' },
              required: true,
            },
            {
              name: 'key',
              label: 'Story',
              kind: 'select',
              options: data.data.map((s) => s.key),
              optionLabels: Object.fromEntries(data.data.map((s) => [s.key, `${s.key} · ${s.name}`])),
              required: true,
            },
          ]}
          initialValues={{ ...link }}
          values={{ ...link }}
          onChange={(values) =>
            onChange(
              links.map((l, i) =>
                i === editing ? { direction: values.direction as LinkDirection, key: String(values.key) } : l,
              ),
            )
          }
          isActive={active}
          onSubmit={() => setEditing(null)}
          submitLabel="keep draft"
        />
      ) : (
        <SelectList
          items={links.map((l, i) => ({ value: i, label: `${l.direction} ${l.key || '(choose Story)'}` }))}
          onHighlight={(item) => setSelected(item?.value ?? 0)}
          onSelect={(item) => setEditing(item.value)}
          isActive={active}
          emptyText="No link drafts. Press n for a new link."
        />
      )}
    </Box>
  );
}
