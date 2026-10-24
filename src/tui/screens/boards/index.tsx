import { Box, Text, useInput } from 'ink';
import { useRef, useState } from 'react';
import { keyPrefixFromName, slugFromName } from '../../../core';
import type { BoardConfig } from '../../../schemas';
import { Form, Loading } from '../../components';
import {
  type ContextMenuItem,
  useAsync,
  useContextMenu,
  useCursor,
  useEscape,
  useIsActive,
  useKeyCapture,
  useKeyHints,
  useReloadOnReturn,
  useRowblyContext,
  useServices,
  useToast,
} from '../../hooks';
import { useRouter } from '../../router';
import { theme } from '../../theme';
import type { ScreenRegistry } from '../types';
import { BoardDeleteDialog } from './BoardDeleteDialog';
import { BoardDeleteScreen } from './BoardDeleteScreen';
import { BoardDetailScreen } from './BoardDetailScreen';
import { BoardEditForm } from './BoardEditForm';
import { BoardFormScreen } from './BoardFormScreen';
import { BoardRow } from './BoardRow';

type Mode =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; board: BoardConfig }
  | { kind: 'confirm-delete'; board: BoardConfig };

/**
 * Every Board: create, edit, delete, open a Board's detail, Stages or Fields, and view its board
 * without changing the context. A right click on a Board selects it and opens a menu of what its
 * keys do.
 */
function BoardsScreen() {
  const services = useServices();
  const ctx = useRowblyContext();
  const toast = useToast();
  const router = useRouter();
  const active = useIsActive();
  const contextMenu = useContextMenu();
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const list = useAsync(() => services.boards.list(), [services]);
  useReloadOnReturn(list.reload);
  const boards = list.data ?? [];
  const listing = mode.kind === 'list';
  const [cursor, setCursor] = useCursor(boards.length, active && listing);
  const current = boards[cursor];

  const done = (message: string) => {
    toast.push('info', message);
    setMode({ kind: 'list' });
    list.reload();
  };

  const open = (board: BoardConfig) => router.push('board-detail', { boardId: board.id, title: board.name });

  // What the screen shows as last rendered, for a context menu's items: an item runs after the
  // renders that opening the menu caused, such as the one that moved the cursor to the Board.
  const latest = useRef({ current, listing });
  latest.current = { current, listing };

  /** A right click on a Board selects it and opens a menu of what its keys do. */
  const boardMenu = (at: number, x: number, y: number) => {
    const board = boards[at];
    if (!board || !listing) return;
    setCursor(at);
    // Runs only if the cursor is still on the Board and the list still takes keys.
    const act = (run: () => void) => () => {
      if (latest.current.listing && latest.current.current?.id === board.id) run();
    };
    const items: ContextMenuItem[] = [
      { label: 'Open', key: 'enter', onSelect: act(() => open(board)) },
      { label: 'Edit', key: 'e', onSelect: act(() => setMode({ kind: 'edit', board })) },
      { label: 'Delete', key: 'd', onSelect: act(() => setMode({ kind: 'confirm-delete', board })) },
    ];
    contextMenu.open(x, y, items);
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
      else if (key.return) open(current);
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
        <Box flexDirection="column">
          {boards.map((b, i) => (
            <BoardRow
              key={b.id}
              board={b}
              inContext={b.id === currentBoard}
              selected={i === cursor}
              active={active && listing}
              onClick={() => setCursor(i)}
              onContextMenu={(x, y) => boardMenu(i, x, y)}
            />
          ))}
        </Box>
      )}
      {mode.kind === 'create' && (
        <Box flexDirection="column">
          <Text bold>New Board</Text>
          <Form
            fields={[
              { name: 'name', label: 'Name', kind: 'text', required: true },
              {
                name: 'id',
                label: 'Id',
                kind: 'text',
                required: true,
                fillFrom: { field: 'name', format: (name) => slugFromName(name, new Set(boards.map((b) => b.id))) },
              },
              {
                name: 'keyPrefix',
                label: 'Key prefix',
                kind: 'text',
                required: true,
                fillFrom: {
                  field: 'name',
                  format: (name) => keyPrefixFromName(name, new Set(boards.map((b) => b.keyPrefix))),
                },
              },
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
          <BoardEditForm board={mode.board} onSaved={(board) => done(`Updated ${board.id}`)} />
        </Box>
      )}
      {mode.kind === 'confirm-delete' && (
        <BoardDeleteDialog
          board={mode.board}
          onClose={(deleted) => {
            setMode({ kind: 'list' });
            if (deleted) list.reload();
          }}
        />
      )}
    </Box>
  );
}

export const boardsScreens: ScreenRegistry = {
  boards: BoardsScreen,
  'board-detail': BoardDetailScreen,
  'board-form': BoardFormScreen,
  'board-delete': BoardDeleteScreen,
};
