import { Box, Text } from 'ink';
import { Form } from '../../components';
import { useBoardSelection, useKeyHints, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';

/** Creates a Board, then switches to it. Opened from the sidebar's New Board button. */
export function BoardFormScreen() {
  const services = useServices();
  const selection = useBoardSelection();
  const toast = useToast();
  const router = useRouter();
  useKeyHints([{ key: 'enter', description: 'create' }]);

  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>A Board holds Stories; its key prefix starts every Story Key (e.g. WEB-42).</Text>
      <Form
        fields={[
          { name: 'name', label: 'Name', kind: 'text', required: true },
          { name: 'id', label: 'Id (slug)', kind: 'text', required: true },
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
          toast.push('info', `Created ${board.name} (${board.keyPrefix})`);
          router.pop();
          await selection.select(board.id);
        }}
      />
    </Box>
  );
}
