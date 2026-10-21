import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { ConflictError } from '../../../core';
import type { BoardConfig } from '../../../schemas';
import { ConfirmDialog, CursorRows, Form, Loading } from '../../components';
import {
  useAsync,
  useCursor,
  useEscape,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useRowblyContext,
  useServices,
  useToast,
} from '../../hooks';
import { useRouter } from '../../router';
import { theme } from '../../theme';
import type { ScreenRegistry } from '../types';
import { BoardDetailScreen } from './BoardDetailScreen';
import { BoardFormScreen } from './BoardForm';

type Mode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; board: BoardConfig }
  | { kind: 'confirm-delete'; board: BoardConfig }
  | { kind: 'confirm-force'; board: BoardConfig; reason: string };

/**
 * Why `--force` would delete `board` after `err`, or `undefined` when it would not: the Board still
 * has Stories, or a Plugin guard that `--force` gets past (`details.canForce`, UI-01) refused it.
 * Any other refusal is final, so it never offers force.
 */
function forceReason(err: unknown, board: BoardConfig): string | undefined {
  if (!(err instanceof ConflictError)) return undefined;
  if (typeof err.details.stories === 'number') return `${board.name} has ${err.details.stories} Stories.`;
  if (err.details.canForce === true) return `${err.message}.`;
  return undefined;
}

/**
 * Every Board: create, edit, delete, open a Board's detail, Stages or Fields, and view its board
 * without changing the context.
 */
function BoardsScreen() {
  const services = useServices();
  const ctx = useRowblyContext();
  const toast = useToast();
  const router = useRouter();
  const active = useIsActive();
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const list = useAsync(() => services.boards.list(), [services]);
  const boards = list.data ?? [];
  const listing = mode.kind === 'list';
  const [cursor] = useCursor(boards.length, active && listing);
  const current = boards[cursor];

  const done = (message: string) => {
    toast.push('info', message);
    setMode({ kind: 'list' });
    list.reload();
  };

  const remove = async (board: BoardConfig, force: boolean) => {
    try {
      await services.boards.remove(board.id, { force });
      done(`Deleted ${board.name}`);
    } catch (err) {
      const reason = force ? undefined : forceReason(err, board);
      if (reason) {
        setMode({ kind: 'confirm-force', board, reason });
      } else {
        toast.error(err);
        setMode({ kind: 'list' });
      }
    }
  };

  useKeyCapture(active && !listing, { escape: true });
  useEscape(active && (mode.kind === 'create' || mode.kind === 'edit'), () => setMode({ kind: 'list' }));
  useKeyHints(
    listing
      ? [
          { key: 'enter', description: 'open' },
          { key: 'v', description: 'view board' },
          { key: 'n', description: 'new Board' },
          { key: 'e', description: 'edit' },
          { key: 'd', description: 'delete' },
          { key: 's', description: 'stages' },
          { key: 'f', description: 'fields' },
        ]
      : [{ key: 'esc', description: 'cancel' }],
  );

  useInput(
    (input, key) => {
      if (input === 'n') return setMode({ kind: 'create' });
      if (!current) return;
      const boardId = current.id;
      if (input === 'e') setMode({ kind: 'edit', board: current });
      else if (input === 'd') setMode({ kind: 'confirm-delete', board: current });
      else if (key.return) router.push('board-detail', { boardId, title: current.name });
      else if (input === 'v') router.push('board', { boardId });
      else if (input === 's') router.push('stages', { boardId, title: `${current.name} Stages` });
      else if (input === 'f') router.push('fields', { boardId, title: `${current.name} Fields` });
    },
    { isActive: active && listing && !list.loading },
  );

  if (list.loading && !list.data) return <Loading label="Loading Boards…" />;
  const currentBoard = ctx?.local.board;

  return (
    <Box flexDirection="column" gap={1}>
      {boards.length === 0 ? (
        <Text color={theme.inkFaint}>No Boards yet. Press n to create one.</Text>
      ) : (
        <CursorRows
          cursor={cursor}
          active={active && listing}
          rows={boards.map((b) => (
            <Text key={b.id}>
              {b.name} <Text color={theme.inkFaint}>{`${b.id} · ${b.keyPrefix}`}</Text>
              {b.id === currentBoard ? <Text color={theme.stageDone}> (current)</Text> : null}
            </Text>
          ))}
        />
      )}
      {mode.kind === 'create' && (
        <Box flexDirection="column">
          <Text bold>New Board</Text>
          <Form
            fields={[
              { name: 'id', label: 'Id', kind: 'text', required: true },
              { name: 'name', label: 'Name', kind: 'text', required: true },
              { name: 'keyPrefix', label: 'Key prefix', kind: 'text', required: true },
              { name: 'description', label: 'Description', kind: 'text' },
            ]}
            onSubmit={async (values) => {
              const board = await services.boards.create({
                id: String(values.id),
                name: String(values.name),
                keyPrefix: String(values.keyPrefix),
                description: String(values.description ?? ''),
              });
              done(`Created ${board.name} (${board.keyPrefix})`);
            }}
          />
        </Box>
      )}
      {mode.kind === 'edit' && (
        <Box flexDirection="column">
          <Text bold>Edit {mode.board.id}</Text>
          <Form
            fields={[
              { name: 'name', label: 'Name', kind: 'text', required: true },
              { name: 'description', label: 'Description', kind: 'text' },
            ]}
            initialValues={{ name: mode.board.name, description: mode.board.description }}
            onSubmit={async (values) => {
              await services.boards.update(mode.board.id, {
                name: String(values.name),
                description: String(values.description ?? ''),
              });
              done(`Updated ${mode.board.id}`);
            }}
          />
        </Box>
      )}
      {mode.kind === 'confirm-delete' && (
        <ConfirmDialog
          message={`Delete Board ${mode.board.name}?`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => void remove(mode.board, false)}
          onCancel={() => setMode({ kind: 'list' })}
        />
      )}
      {mode.kind === 'confirm-force' && (
        <ConfirmDialog
          message={`${mode.reason} Delete the Board with all its Stories and Plugin files?`}
          confirmLabel="Delete all"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => void remove(mode.board, true)}
          onCancel={() => setMode({ kind: 'list' })}
        />
      )}
    </Box>
  );
}

export const boardsScreens: ScreenRegistry = {
  boards: BoardsScreen,
  'board-detail': BoardDetailScreen,
  'board-form': BoardFormScreen,
};
