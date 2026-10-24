import type { PluginStoryTabProps } from '../../plugin-api';
import {
  Box,
  ConfirmDialog,
  Loading,
  Modal,
  SelectList,
  Text,
  theme,
  useAsync,
  useInput,
  useIsActive,
  useKeyHints,
  useReloadOnReturn,
  useState,
} from '../../plugin-api/tui';
import { readLinks, removeLink } from './links';
import { directionLabel } from './model';

/** Incoming and outgoing relationships share one navigable list; either end can remove a link. */
export function LinksTab({ story, active, plugin, ui }: PluginStoryTabProps) {
  const isActive = useIsActive() && active;
  const data = useAsync(() => readLinks(plugin, story.key), [plugin, story]);
  useReloadOnReturn(data.reload, isActive);
  const [selected, setSelected] = useState<string>();
  const [filtering, setFiltering] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const links = data.data?.links ?? [];
  const linkId = (relation: string, key: string) => `${relation}:${key}`;
  const highlighted = links.find((link) => linkId(link.relation, link.key) === selected);
  const viewing = isActive && data.data !== undefined && !confirming && !busy;
  const keys = viewing && !filtering;
  useKeyHints(
    keys
      ? [
          { key: 'tab/←/→', description: 'switch tab' },
          { key: '↑/↓', description: 'select link' },
          ...(highlighted?.available ? [{ key: 'enter', description: 'open Story' }] : []),
          { key: '/', description: 'filter' },
          { key: 'n', description: 'new link' },
          ...(highlighted ? [{ key: 'd', description: 'remove link' }] : []),
        ]
      : [],
  );
  useInput(
    (input) => {
      if (input === 'n') ui.open('new', { target: story.key, title: 'New Story link' });
      else if (input === 'd' && highlighted) setConfirming(true);
    },
    { isActive: keys },
  );

  const remove = async () => {
    if (!highlighted) return;
    setBusy(true);
    try {
      const blocker = highlighted.relation === 'blocks' ? story.key : highlighted.key;
      const blocked = highlighted.relation === 'blocks' ? highlighted.key : story.key;
      await removeLink(plugin, blocker, blocked);
      ui.toast('Removed Story link');
      data.reload();
    } catch (error) {
      ui.error(error);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (!data.data)
    return data.loading ? (
      <Loading label="Loading Story links…" />
    ) : (
      <Text color={theme.danger}>Could not load Story links.</Text>
    );
  return (
    <Box flexDirection="column" gap={1}>
      {data.data.unavailable.length > 0 && (
        <Text color={theme.danger}>
          Story links unavailable on {data.data.unavailable.join(', ')}: invalid Plugin Data; run `rowbly doctor`. Other
          links below may be incomplete.
        </Text>
      )}
      <SelectList
        items={links.map((link) => ({
          value: linkId(link.relation, link.key),
          label: `${directionLabel(link.relation)} ${link.key}`,
          description: link.name ?? 'unavailable (run rowbly doctor)',
        }))}
        emptyText={data.data.unavailable.length ? 'No readable Story links.' : 'No Story links. Press n to add one.'}
        isActive={viewing}
        limit={8}
        onHighlight={(item) => setSelected(item?.value)}
        onFilteringChange={setFiltering}
        onSelect={(item) => {
          const link = links.find((link) => linkId(link.relation, link.key) === item.value);
          if (link?.available) ui.openStory(link.key);
          else ui.toast('Linked Story unavailable; run rowbly doctor', 'warning');
        }}
      />
      {confirming && highlighted && (
        <Modal title={`${story.key} › Remove link`} onClose={() => setConfirming(false)}>
          <ConfirmDialog
            message={`Remove the link: ${story.key} ${highlighted.relation === 'blocks' ? 'blocks' : 'is blocked by'} ${highlighted.key}?`}
            confirmLabel="Remove"
            cancelLabel="Cancel"
            destructive
            isActive={isActive && !busy}
            onConfirm={() => void remove()}
            onCancel={() => setConfirming(false)}
          />
        </Modal>
      )}
    </Box>
  );
}
