import { Box, Text } from 'ink';
import { keyPrefixFromName, slugFromName } from '../../../core';
import { Form } from '../../components';
import { useBoardSelection, useServices, useToast } from '../../hooks';
import { useRouter } from '../../router';
import { theme } from '../../theme';

/**
 * Creates a Board, then switches to it. Opened from the sidebar's New Board button. The Board's id and
 * key prefix are inferred from its name, numbered when another Board already uses them.
 */
export function BoardFormScreen() {
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
