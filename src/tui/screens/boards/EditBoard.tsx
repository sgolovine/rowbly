import { Text } from 'ink';
import type { Slug } from '../../../schemas';
import { Loading } from '../../components';
import { useAsync, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';
import { theme } from '../../theme';
import { BoardEditForm } from './BoardEditForm';

/** The Board `boardId` in the edit form; back when it is saved. */
export function EditBoard({ boardId }: { boardId: Slug }) {
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
