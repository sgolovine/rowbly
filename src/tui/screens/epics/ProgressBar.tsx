import { Text } from 'ink';
import type { EpicView } from '../../../services';

const WIDTH = 10;

function filled({ done, total }: EpicView['progress']): number {
  return total === 0 ? 0 : Math.round((done / total) * WIDTH);
}

/** `███░░░░░░░ 3/8` as plain text, for list rows. */
export function progressText(progress: EpicView['progress']): string {
  const n = filled(progress);
  return `${'█'.repeat(n)}${'░'.repeat(WIDTH - n)} ${progress.done}/${progress.total}`;
}

/** Epic Progress as a coloured bar with its `done/total` count. */
export function ProgressBar({ progress }: { progress: EpicView['progress'] }) {
  const n = filled(progress);
  return (
    <Text>
      <Text color="green">{'█'.repeat(n)}</Text>
      <Text dimColor>{'░'.repeat(WIDTH - n)}</Text> {progress.done}/{progress.total}
    </Text>
  );
}
