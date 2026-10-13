import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { ConfirmDialog, Loading } from '../../components';
import { useAsync, useIsActive, useRowblyContext, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';
import { CursorRows, useCursor } from '../stages/shared';
import { useReloadOnReturn } from '../stories/shared';

export interface CommentsPanelProps {
  /** A Story Key or a Task id. */
  target: string;
}

/** The Comments on a Story or Task, oldest first: `c` add and `e` edit (in the Comment form), `d` delete. */
export function CommentsPanel({ target }: CommentsPanelProps) {
  const services = useServices();
  const ctx = useRowblyContext();
  const toast = useToast();
  const router = useRouter();
  const active = useIsActive();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = useAsync(() => services.comments.list(target), [services, target]);
  useReloadOnReturn(data.reload);
  const comments = data.data ?? [];
  const viewing = active && !confirming && !busy;
  const [cursor] = useCursor(comments.length, viewing);
  const comment = comments[cursor];

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      toast.push('info', message);
      data.reload();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  useInput(
    (input) => {
      if (input === 'c') router.push('comment-form', { target, title: 'New Comment' });
      else if (!comment) return;
      else if (input === 'e') router.push('comment-form', { target, id: comment.id, title: 'Edit Comment' });
      else if (input === 'd') setConfirming(true);
    },
    { isActive: viewing && data.data !== undefined },
  );

  if (!data.data) return data.loading ? <Loading label="Loading Comments…" /> : <Text color="red">No Comments.</Text>;
  const now = ctx?.now() ?? new Date();

  return (
    <Box flexDirection="column" gap={1}>
      {comments.length === 0 ? (
        <Text dimColor>No Comments yet. Press c to add one.</Text>
      ) : (
        <CursorRows
          cursor={cursor}
          active={viewing}
          rows={comments.map((c) => (
            <Box key={c.id} flexDirection="column">
              <Text>
                <Text bold>{c.author ?? 'unknown'}</Text>
                <Text dimColor>
                  {' '}
                  · {relativeTime(c.createdAt, now)}
                  {c.updatedAt !== c.createdAt ? ' (edited)' : ''}
                </Text>
              </Text>
              <Text>{c.body}</Text>
            </Box>
          ))}
        />
      )}
      <Text dimColor>c add · e edit · d delete</Text>
      {confirming && comment && (
        <ConfirmDialog
          message={`Delete the Comment by ${comment.author ?? 'unknown'}?`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => void run(() => services.comments.remove(target, comment.id), 'Deleted Comment')}
          onCancel={() => setConfirming(false)}
        />
      )}
    </Box>
  );
}

const UNITS: readonly [string, number][] = [
  ['y', 365 * 24 * 3600],
  ['mo', 30 * 24 * 3600],
  ['d', 24 * 3600],
  ['h', 3600],
  ['m', 60],
];

/** `just now`, `5m ago`, `3h ago`, `2d ago`, `4mo ago`, `1y ago`. */
export function relativeTime(timestamp: string, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(timestamp).getTime()) / 1000));
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${unit} ago`;
  }
  return 'just now';
}
