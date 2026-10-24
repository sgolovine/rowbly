import { Text } from 'ink';
import type { Slug } from '../../../schemas';
import { Loading } from '../../components';
import { useAsync, useRowblyContext, useServices } from '../../hooks';
import { useRouter } from '../../router';
import { theme } from '../../theme';
import type { ScreenProps } from '../types';
import { BoardDeleteDialog } from './BoardDeleteDialog';

/**
 * Asks before deleting the Board `params.boardId`, as the Board sidebar's `d` and its context menu
 * do, then goes back. When the board behind it showed that Board, Rowbly starts again from the home
 * screen, which opens the Board in context if one is left.
 */
export function BoardDeleteScreen({ params }: ScreenProps) {
  const services = useServices();
  const ctx = useRowblyContext();
  const router = useRouter();
  const boardId = String(params.boardId) as Slug;
  const board = useAsync(() => services.boards.get(boardId), [services, boardId]);
  if (!board.data)
    return board.loading ? <Loading label="Loading Board…" /> : <Text color={theme.danger}>Could not load Board.</Text>;
  // Read before deleting: deleting the Board in context takes it out of the context.
  const root = router.stack[0];
  const shown = root?.screen === 'board' ? ((root.params.boardId as string | undefined) ?? ctx?.local.board) : null;
  return (
    <BoardDeleteDialog
      board={board.data}
      onClose={(deleted) => {
        if (deleted && (shown === boardId || shown === undefined)) router.reset('home');
        else router.pop();
      }}
    />
  );
}
