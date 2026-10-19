import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import type { Stage, Story } from '../../../schemas';
import { StageBadge } from '../../components';
import { useMouse } from '../../hooks';
import { truncate } from './layout';
import { useCardBadges } from './useCardBadges';

export interface BoardColumnProps {
  stage: Stage;
  /** Every Story in the Stage, in Rank order. */
  cards: readonly Story[];
  /** All Stages of the Board, for the Plugins' card badges. */
  stages: readonly Stage[];
  width: number;
  /** Index of the first card shown and how many are shown. */
  first: number;
  size: number;
  /** The highlighted card (the column is current even when empty), or `null` when the cursor is in another column. */
  selected: number | null;
  active: boolean;
  /** A card clicked, by its index in `cards`, or `-1` for an empty spot in the column. */
  onClick?(index: number): void;
  /** A card (its Story Key) dragged onto this column. */
  onDrop?(key: unknown): void;
}

/** One Stage: header with name, Stage Category colour and count, then its cards, scrolled to `first`. */
export function BoardColumn({
  stage,
  cards,
  stages,
  width,
  first,
  size,
  selected,
  active,
  onClick,
  onDrop,
}: BoardColumnProps) {
  const shown = cards.slice(first, first + size);
  const below = cards.length - first - shown.length;
  const inner = width - 1;
  const ref = useRef<DOMElement>(null);
  const badgesOf = useCardBadges();
  useMouse(ref, { onClick: () => onClick?.(-1), onDrop }, active);
  return (
    <Box ref={ref} flexDirection="column" width={width} paddingRight={1} flexShrink={0}>
      <Text wrap="truncate-end">
        <StageBadge stage={stage} /> <Text dimColor>({cards.length})</Text>
      </Text>
      {selected === null ? (
        <Text dimColor>{'─'.repeat(inner)}</Text>
      ) : (
        <Text color={active ? 'cyan' : undefined}>{'━'.repeat(inner)}</Text>
      )}
      <Text dimColor>{first > 0 ? `↑ ${first} more` : ' '}</Text>
      {shown.map((story, i) => (
        <Card
          key={story.key}
          story={story}
          badges={badgesOf(story, stages)}
          width={inner}
          selected={selected === first + i}
          active={active}
          onClick={() => onClick?.(first + i)}
        />
      ))}
      {cards.length === 0 && <Text dimColor>(empty)</Text>}
      {below > 0 && <Text dimColor>↓ {below} more</Text>}
    </Box>
  );
}

/** Three lines in a box: key and Priority, name, Assignees and the Plugins' badges. Never wraps. */
function Card({
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
  const meta = [story.assignees.map((h) => `@${h}`).join(' '), ...badges].filter(Boolean).join(' · ');
  const priority = story.priority ? ` ${story.priority}` : '';
  // Both border styles are one cell thick, so selecting a card changes only the border's weight and colour.
  return (
    <Box
      ref={ref}
      flexDirection="column"
      width={width}
      marginBottom={1}
      paddingX={1}
      borderStyle={selected ? 'bold' : 'single'}
      borderColor={selected && active ? 'cyan' : undefined}
      borderDimColor={!selected}
    >
      <Text>
        <Text bold color="cyan">
          {truncate(story.key, room)}
        </Text>
        <Text color="magenta">{truncate(priority, room - story.key.length)}</Text>
      </Text>
      <Text bold={selected}>{truncate(story.name, room)}</Text>
      <Text dimColor>{truncate(meta, room) || ' '}</Text>
    </Box>
  );
}
