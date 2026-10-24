import { Box, Text } from 'ink';
import { keyPrefixFromName, slugFromName } from '../../../core';
import type { Slug } from '../../../schemas';
import { Form, Loading } from '../../components';
import { useAsync, useBoardSelection, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';
import { theme } from '../../theme';
import type { ScreenProps } from '../types';
import { BoardEditForm } from './BoardEditForm';

/**
 * Creates a Board, then switches to it. Opened from the sidebar's New Board button. The Board's id and
 * key prefix are inferred from its name, numbered when another Board already uses them. With
 * `params.boardId` it edits that Board instead, as the sidebar's `e` and its context menu do.
 */
export function BoardFormScreen({ params }: ScreenProps) {
  const boardId = typeof params.boardId === 'string' ? (params.boardId as Slug) : undefined;
  return boardId ? <EditBoard boardId={boardId} /> : <NewBoard />;
}

/** The Board `boardId` in the edit form; back when it is saved. */
function EditBoard({ boardId }: { boardId: Slug }) {
  const services = useServices();
  const toast = useToast();
  const router = useRouter();
  const board = useAsync(() => services.boards.get(boardId), [services, boardId]);
  if (!board.data)
    return board.loading ? <Loading label="Loading Board…" /> : <Text color={theme.danger}>Could not load Board.</Text>;
  return (
    <BoardEditForm
      board={board.data}
      onSaved={(saved) => {
        toast.push('info', `Updated ${saved.id}`);
        router.pop();
      }}
    />
  );
}

function NewBoard() {
  const services = useServices();
  const selection = useBoardSelection();
  const toast = useToast();
  const router = useRouter();

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={theme.inkFaint}>
        A Board holds Stories; its key prefix, taken from the name, starts every Story Key (e.g. WEB-42).
      </Text>
      <Form
        fields={[
          { name: 'name', label: 'Name', kind: 'text', required: true },
          { name: 'description', label: 'Description', kind: 'text' },
        ]}
        onSubmit={async (values) => {
          const name = String(values.name);
          const boards = await services.boards.list();
          const board = await services.boards.create({
            id: slugFromName(name, new Set(boards.map((b) => b.id))),
            name,
            keyPrefix: keyPrefixFromName(name, new Set(boards.map((b) => b.keyPrefix))),
            description: String(values.description ?? ''),
          });
          toast.push('info', `Created ${board.name} (${board.keyPrefix})`);
          router.pop();
          await selection.select(board.id);
        }}
      />
    </Box>
  );
}
