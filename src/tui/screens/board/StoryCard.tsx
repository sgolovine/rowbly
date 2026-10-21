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
  // The border takes one column on each side and a space of margin another. Each line is drawn as
  // a full-width string, and a selected Story paints its frame in the fill colour, so it reads as
  // one solid block with no gap between frame and fill.
  const room = width - 4;
  const line = (text: string) => ` ${text.padEnd(room)} `;
  const meta = badges.join(' · ');
  const priority = truncate(story.priority ? ` ${story.priority}` : '', room);
  const key = truncate(story.key, Math.max(1, room - priority.length));
  // Selecting a Story changes only its fill. Behind a Modal or the Story
  // screen the selected Story keeps that look, so the user can see which Story is open.
  return (
    <Box
      ref={ref}
      flexDirection="column"
      width={width}
      marginBottom={1}
      borderStyle="round"
      borderColor={selected ? theme.selection : theme.border}
      backgroundColor={selected ? theme.selection : undefined}
      borderBackgroundColor={selected ? theme.selection : undefined}
    >
      <Text>
        <Text color={theme.accent}>{` ${key}`}</Text>
        <Text color={theme.inkMuted}>{`${' '.repeat(room - key.length - priority.length)}${priority} `}</Text>
      </Text>
      <Text color={theme.ink} bold={selected}>
        {line(truncate(story.name, room))}
      </Text>
      <Text color={theme.inkMuted}>{line(truncate(meta, room))}</Text>
    </Box>
  );
}
