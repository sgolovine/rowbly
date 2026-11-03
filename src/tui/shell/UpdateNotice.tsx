import { Box, Text, useWindowSize } from 'ink';
import { theme } from '../theme';

const COMMAND = 'npm i -g rowbly';

/**
 * The footer row that offers a newer Rowbly release (ADR-0049 §3). The command is styled like a
 * key; on a narrow terminal the sentence shortens so that the command stays readable.
 */
export function UpdateNotice({ version }: { version: string }) {
  const { columns } = useWindowSize();
  const long = `Rowbly ${version} is available, update with `;
  const lead = long.length + COMMAND.length <= columns - 2 ? long : `Rowbly ${version}: `;
  return (
    <Box paddingX={1} flexShrink={0} justifyContent="flex-end">
      <Text wrap="truncate-start">
        <Text color={theme.inkFaint}>{lead}</Text>
        <Text bold color={theme.ink}>
          {COMMAND}
        </Text>
      </Text>
    </Box>
  );
}
