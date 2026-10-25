import type { PluginStoryTabProps } from '../../plugin-api';
import {
  Box,
  ConfirmDialog,
  formatDate,
  Loading,
  Modal,
  moveDelta,
  SelectionRow,
  Text,
  theme,
  useAsync,
  useInput,
  useIsActive,
  useKeyHints,
  useReloadOnReturn,
  useState,
} from '../../plugin-api/tui';
import { listAttachments, openAttachment, removeAttachment } from './attachments';
import { formatSize } from './formatSize';

export function AttachmentsTab({ story, active, plugin, ui }: PluginStoryTabProps<unknown>) {
  const isActive = useIsActive() && active;
  const [selected, setSelected] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = useAsync(() => listAttachments(plugin, story.key), [plugin, story]);
  useReloadOnReturn(data.reload, isActive);
  const entries = data.data ?? [];
  const cursor = Math.max(0, Math.min(selected, entries.length - 1));
  const entry = entries[cursor];
  const viewing = isActive && !confirming && !busy && data.data !== undefined;
  useKeyHints(
    viewing
      ? [
          { key: 'n', description: 'new Attachment' },
          ...(entry
            ? [
                { key: 'o', description: 'open Attachment' },
                { key: 'd', description: 'remove Attachment' },
              ]
            : []),
        ]
      : [],
  );
  const open = async () => {
    if (!entry) return;
    setBusy(true);
    try {
      await openAttachment(plugin, story.key, entry.id);
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!entry) return;
    setBusy(true);
    try {
      await removeAttachment(plugin, story.key, entry.id);
      ui.toast(`Removed ${entry.name}`);
      data.reload();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  useInput(
    (input, key) => {
      const delta = moveDelta(input, key);
      if (delta) setSelected(Math.max(0, Math.min(entries.length - 1, cursor + delta)));
      else if (input === 'n') ui.open('form', { target: story.key, title: 'New Attachment' });
      else if (entry && input === 'o') void open();
      else if (entry && input === 'd') setConfirming(true);
    },
    { isActive: viewing },
  );
  if (!data.data)
    return data.loading ? (
      <Loading label="Loading Attachments…" />
    ) : (
      <Text color={theme.danger}>Could not load Attachments.</Text>
    );
  return (
    <Box flexDirection="column" gap={1}>
      {entries.length === 0 ? (
        <Text color={theme.inkFaint}>No Attachments yet. Paste an image or press n to add a PNG.</Text>
      ) : (
        entries.map((image, i) => (
          <SelectionRow key={image.id} selected={i === cursor} active={viewing} onClick={() => setSelected(i)}>
            <Text>
              <Text bold>{image.name}</Text>
              <Text color={theme.inkMuted}>
                {' '}
                · {formatSize(image.size)} · {formatDate(image.createdAt)}
              </Text>
            </Text>
          </SelectionRow>
        ))
      )}
      {confirming && entry && (
        <Modal title={`${story.key} › Remove Attachment`} onClose={() => setConfirming(false)}>
          <ConfirmDialog
            message={`Remove ${entry.name}?`}
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
