import { Box, type DOMElement, Text } from 'ink';
import { useRef } from 'react';
import type { Stage, Story } from '../../../schemas';
import { StageBadge } from '../../components';
import { type StoryBadges, useMouse } from '../../hooks';
import { theme } from '../../theme';
import { CARD_HEIGHT, CHROME_HEIGHT } from './layout';
import { StoryCard } from './StoryCard';
import { StoryShadow } from './StoryShadow';
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
  /** A card (its Story Key) dragged over this column, and dragged off it again. */
  onDragOver?(key: unknown): void;
  onDragLeave?(): void;
  /** Shows the drop shadow below the last card, where a dragged card will land. */
  shadow?: boolean;
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
  onDragOver,
  onDragLeave,
  shadow = false,
}: BoardColumnProps) {
  // The shadow takes a card's place below the last card, so the column scrolls to its end to show it.
  const top = shadow ? Math.max(0, cards.length - size + 1) : first;
  const shown = cards.slice(top, top + size - (shadow ? 1 : 0));
  const below = cards.length - top - shown.length;
  const inner = width - 2;
  const ref = useRef<DOMElement>(null);
  const badgesOf = useCardBadges();
  useMouse(ref, { onClick: () => onClick?.(-1), onDrop, onDragOver, onDragLeave }, active);
  return (
    // The column is as tall as `size` cards, so the space below its last card still takes clicks and drops.
    <Box
      ref={ref}
      flexDirection="column"
      width={width}
      minHeight={CHROME_HEIGHT + size * CARD_HEIGHT}
      paddingRight={2}
      flexShrink={0}
    >
      <Text wrap="truncate-end">
        <StageBadge stage={stage} /> <Text color={theme.inkFaint}>{cards.length}</Text>
      </Text>
      {selected === null ? (
        <Text color={theme.border}>{'─'.repeat(inner)}</Text>
      ) : (
        <Text color={active ? theme.accent : theme.border}>{'━'.repeat(inner)}</Text>
      )}
      <Text color={theme.inkFaint}>{top > 0 ? `↑ ${top} more` : ' '}</Text>
      {shown.map((story, i) => (
        <StoryCard
          key={story.key}
          story={story}
          badges={[...storyBadges(story), ...badgesOf(story, stages)]}
          width={inner}
          selected={selected === top + i}
          active={active}
          onClick={() => onClick?.(top + i)}
        />
      ))}
      {shadow && <StoryShadow width={inner} />}
      {cards.length === 0 && !shadow && <Text color={theme.inkFaint}>No Stories</Text>}
      {below > 0 && <Text color={theme.inkFaint}>↓ {below} more</Text>}
    </Box>
  );
}
