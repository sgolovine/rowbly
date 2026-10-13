import { Box, Text, useInput } from 'ink';
import { useState } from 'react';
import { ConflictError } from '../../../core';
import type { BoardConfig } from '../../../schemas';
import { ConfirmDialog, Form, Loading } from '../../components';
import {
  useAsync,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useRowblyContext,
  useServices,
  useToast,
} from '../../hooks';
import { useRouter } from '../../router';
import { CursorRows, useCursor, useEscape } from '../stages/shared';
import type { ScreenProps, ScreenRegistry } from '../types';

type Mode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; board: BoardConfig }
  | { kind: 'confirm-delete'; board: BoardConfig }
  | { kind: 'confirm-force'; board: BoardConfig; stories: number };

/** The Boards of the current Workspace (or `params.workspaceId`): create, edit, delete, and open Stages/Fields. */
function BoardsScreen({ params }: ScreenProps) {
  const services = useServices();
  const ctx = useRowblyContext();
  const toast = useToast();
  const router = useRouter();
  const active = useIsActive();
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const list = useAsync(async () => {
    const workspaceId = (params.workspaceId as string | undefined) ?? (await services.context.resolveWorkspace());
    return { workspaceId, boards: await services.boards.list(workspaceId) };
  }, [services, params.workspaceId]);
  const boards = list.data?.boards ?? [];
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
      await services.boards.remove({ workspaceId: board.workspaceId, boardId: board.id }, { force });
      done(`Deleted ${board.name}`);
    } catch (err) {
      if (err instanceof ConflictError && typeof err.details.stories === 'number') {
        setMode({ kind: 'confirm-force', board, stories: err.details.stories });
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
          { key: 'n', description: 'new' },
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
      const ref = { workspaceId: current.workspaceId, boardId: current.id };
      if (input === 'e') setMode({ kind: 'edit', board: current });
      else if (input === 'd') setMode({ kind: 'confirm-delete', board: current });
      else if (input === 's' || key.return) router.push('stages', { ref, title: `${current.name} Stages` });
      else if (input === 'f') router.push('fields', { ref, title: `${current.name} Fields` });
    },
    { isActive: active && listing && !list.loading },
  );

  if (list.loading && !list.data) return <Loading label="Loading Boards…" />;
  const currentBoard = ctx?.local.workspace === list.data?.workspaceId ? ctx?.local.board : undefined;

  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>Workspace {list.data?.workspaceId}</Text>
      {boards.length === 0 ? (
        <Text dimColor>No Boards yet. Press n to create one.</Text>
      ) : (
        <CursorRows
          cursor={cursor}
          active={active && listing}
          rows={boards.map((b) => (
            <Text key={b.id}>
              {b.name} <Text dimColor>{`${b.id} · ${b.keyPrefix}`}</Text>
              {b.id === currentBoard ? <Text color="green"> (current)</Text> : null}
            </Text>
          ))}
        />
      )}
      {mode.kind === 'create' && list.data && (
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
              const board = await services.boards.create(list.data?.workspaceId ?? '', {
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
              await services.boards.update(
                { workspaceId: mode.board.workspaceId, boardId: mode.board.id },
                { name: String(values.name), description: String(values.description ?? '') },
              );
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
          message={`${mode.board.name} has ${mode.stories} Stories. Delete the Board and all of them?`}
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
};
