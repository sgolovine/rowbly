import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import type { Story } from '../../../schemas';
import { useMouse } from '../../hooks';
import { theme } from '../../theme';
import { truncate } from './layout';

/** Three lines in a box: key and Priority, name, Plugin badges. Never wraps. */
export function StoryCard({
  story,
  badges,
  width,
  selected,
  active,
  onClick,
}: {
  story: Story;
  badges: readonly string[];
  width: number;
  selected: boolean;
  active: boolean;
  onClick(): void;
}) {
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onClick, drag: story.key }, active);
  // Border and padding take two columns on each side.
  const room = width - 4;
  const meta = badges.join(' · ');
  const priority = story.priority ? ` ${story.priority}` : '';
  // Both border styles are one cell thick, so selecting a card changes only the border's weight and colour.
  return (
    <Box
      ref={ref}
      flexDirection="column"
      width={width}
      marginBottom={1}
      paddingX={1}
      borderStyle="round"
      borderColor={selected ? theme.accent : theme.border}
      backgroundColor={selected ? theme.selection : undefined}
    >
      <Box justifyContent="space-between">
        <Text color={theme.accent}>{truncate(story.key, Math.max(1, room - priority.length))}</Text>
        <Text color={theme.inkMuted}>{truncate(priority, room)}</Text>
      </Box>
      <Text color={theme.ink} bold={selected}>
        {truncate(story.name, room)}
      </Text>
      <Text color={theme.inkMuted}>{truncate(meta, room) || ' '}</Text>
    </Box>
  );
}
