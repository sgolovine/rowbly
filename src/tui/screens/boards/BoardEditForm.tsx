import { Box, Text } from 'ink';
import type { BoardConfig } from '../../../schemas';
import { Form } from '../../components';
import { useServices } from '../../hooks';
import { theme } from '../../theme';

/**
 * Edits a Board's name and description, starting from its current values. Its id and key prefix
 * cannot change, so they show above the form as text. A refused save keeps the form and its input;
 * `onSaved` runs only after the Board is saved.
 */
export function BoardEditForm({ board, onSaved }: { board: BoardConfig; onSaved(board: BoardConfig): void }) {
  const services = useServices();
  return (
    <Box flexDirection="column">
      <Text color={theme.inkFaint}>{`Id ${board.id} · Key prefix ${board.keyPrefix} (cannot be changed)`}</Text>
      <Form
        fields={[
          { name: 'name', label: 'Name', kind: 'text', required: true },
          { name: 'description', label: 'Description', kind: 'text' },
        ]}
        initialValues={{ name: board.name, description: board.description }}
        onSubmit={async (values) => {
          const saved = await services.boards.update(board.id, {
            name: String(values.name),
            description: String(values.description ?? ''),
          });
          onSaved(saved);
        }}
      />
    </Box>
  );
}
