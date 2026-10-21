import type { PluginStoryTabProps } from '../../plugin-api';
import {
  Box,
  ConfirmDialog,
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
import { deleteComment, readThread } from './comments';
import { relativeTime } from './relativeTime';

/** The Thread of a Story, oldest first: `n` new and `e` edit (in the Comment form), `d` delete. */
export function CommentsTab({ story, active, plugin, ui }: PluginStoryTabProps<Record<string, unknown>>) {
  const target = story.key;
  const isActive = useIsActive() && active;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(0);
  // `null` is a stored Thread that is invalid: it is shown as unavailable, never as empty (ARCH-36).
  const data = useAsync(() => readThread(plugin, target), [plugin, target]);
  // Reloads the Thread when the Comment form closes.
  useReloadOnReturn(data.reload, isActive);
  const comments = data.data ?? [];
  const viewing = isActive && !confirming && !busy && Boolean(data.data);
  const cursor = Math.max(0, Math.min(selected, comments.length - 1));
  const comment = comments[cursor];
  useKeyHints(
    viewing
      ? [
          { key: 'tab/←/→', description: 'switch tab' },
          { key: 'n', description: 'new Comment' },
          ...(comment
            ? [
                { key: 'e', description: 'edit Comment' },
                { key: 'd', description: 'delete Comment' },
              ]
            : []),
        ]
      : [],
  );

  useInput(
    (input, key) => {
      const delta = moveDelta(input, key);
      if (delta) setSelected(Math.max(0, Math.min(comments.length - 1, cursor + delta)));
      else if (input === 'n') ui.open('form', { target, title: 'New Comment' });
      else if (!comment) return;
      else if (input === 'e') ui.open('form', { target, id: comment.id, title: 'Edit Comment' });
      else if (input === 'd') setConfirming(true);
    },
    { isActive: viewing },
  );

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await deleteComment(plugin, target, id);
      ui.toast('Deleted Comment');
      data.reload();
    } catch (err) {
      ui.error(err);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (data.data === null) {
    return <Text color={theme.danger}>Comments unavailable: stored Thread is invalid; run `rowbly doctor`.</Text>;
  }
  if (!data.data) {
    return data.loading ? (
      <Loading label="Loading Comments…" />
    ) : (
      <Text color={theme.danger}>Could not load Comments.</Text>
    );
  }
  const now = plugin.now();

  return (
    <Box flexDirection="column" gap={1}>
      {comments.length === 0 ? (
        <Text color={theme.inkFaint}>No Comments yet. Press n to add one.</Text>
      ) : (
        <Box flexDirection="column">
          {comments.map((c, i) => (
            <SelectionRow key={c.id} selected={i === cursor} active={viewing} onClick={() => setSelected(i)}>
              <Box flexDirection="column">
                <Text>
                  <Text bold>{c.author ?? 'unknown'}</Text>
                  <Text color={theme.inkFaint}>
                    {' '}
                    · {relativeTime(c.createdAt, now)}
                    {c.updatedAt !== c.createdAt ? ' (edited)' : ''}
                  </Text>
                </Text>
                <Text>{c.body}</Text>
              </Box>
            </SelectionRow>
          ))}
        </Box>
      )}
      {confirming && comment && (
        <Modal title="Delete" onClose={() => setConfirming(false)}>
          <ConfirmDialog
            message={`Delete the Comment by ${comment.author ?? 'unknown'}?`}
            confirmLabel="Delete"
            cancelLabel="Cancel"
            destructive
            isActive={isActive && !busy}
            onConfirm={() => void remove(comment.id)}
            onCancel={() => setConfirming(false)}
          />
        </Modal>
      )}
    </Box>
  );
}
