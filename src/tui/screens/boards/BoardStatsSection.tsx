import { Box, Text } from 'ink';
import { boardStatText } from '../../../output';
import type { BoardStat } from '../../../services/boardStats';
import { DetailView } from '../../components';
import { theme } from '../../theme';

export function BoardStatsSection({ title, metrics }: { title: string; metrics: readonly BoardStat[] }) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold color={theme.ink}>
        {title}
      </Text>
      <DetailView rows={metrics.map((metric) => ({ label: metric.label, value: boardStatText(metric) }))} />
    </Box>
  );
}
