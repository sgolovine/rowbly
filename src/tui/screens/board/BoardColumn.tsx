import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import type { Stage, Story } from '../../../schemas';
import { StageBadge } from '../../components';
import { type StoryBadges, useMouse } from '../../hooks';
import { theme } from '../../theme';
import { StoryCard } from './StoryCard';
import { useCardBadges } from './useCardBadges';

export interface BoardColumnProps {
  stage: Stage;
  /** Every Story in the Stage, in Rank order. */
  cards: readonly Story[];
  /** All Stages of the Board, for the Plugins' card badges. */
  stages: readonly Stage[];
  /** The Plugins' badges for a Story, loaded with the Stories. */
  storyBadges: StoryBadges;
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
  storyBadges,
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
  const inner = width - 2;
  const ref = useRef<DOMElement>(null);
  const badgesOf = useCardBadges();
  useMouse(ref, { onClick: () => onClick?.(-1), onDrop }, active);
  return (
    <Box ref={ref} flexDirection="column" width={width} paddingRight={2} flexShrink={0}>
      <Text wrap="truncate-end">
        <StageBadge stage={stage} /> <Text color={theme.inkFaint}>{cards.length}</Text>
      </Text>
      {selected === null ? (
        <Text color={theme.border}>{'─'.repeat(inner)}</Text>
      ) : (
        <Text color={active ? theme.accent : theme.border}>{'━'.repeat(inner)}</Text>
      )}
      <Text color={theme.inkFaint}>{first > 0 ? `↑ ${first} more` : ' '}</Text>
      {shown.map((story, i) => (
        <StoryCard
          key={story.key}
          story={story}
          badges={[...storyBadges(story), ...badgesOf(story, stages)]}
          width={inner}
          selected={selected === first + i}
          active={active}
          onClick={() => onClick?.(first + i)}
        />
      ))}
      {cards.length === 0 && <Text color={theme.inkFaint}>No Stories</Text>}
      {below > 0 && <Text color={theme.inkFaint}>↓ {below} more</Text>}
    </Box>
  );
}
