import { Box, type DOMElement, measureElement, Text } from 'ink';
import { useRef } from 'react';
import type { Slug, Stage, Story } from '../../../schemas';
import { PluginSlot, StageBadge } from '../../components';
import { type StoryBadges, useMouse, usePlugins } from '../../hooks';
import { theme } from '../../theme';
import { CARD_HEIGHT, CHROME_HEIGHT, dropSlot, follow } from './layout';
import { StoryCard } from './StoryCard';
import { StoryShadow } from './StoryShadow';
import { useCardBadges } from './useCardBadges';

export interface BoardColumnProps {
  boardId: Slug;
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
  /** A card right-clicked, by its index in `cards`, at cell `x`, `y`. */
  onContextMenu?(index: number, x: number, y: number): void;
  /**
   * A card (its Story Key) dropped on this column, at `slot`: its index among the column's cards without it.
   */
  onDrop?(key: unknown, slot: number): void;
  /** A card (its Story Key) dragged over this column, to `slot`, and dragged off it again. */
  onDragOver?(key: unknown, slot: number): void;
  onDragLeave?(): void;
  /**
   * A card dragged over this column: the drop shadow shows at `slot`, the cards from there on move down, and the
   * dragged card itself, when it is in this column, is left out.
   */
  drag?: { key: string; slot: number } | null;
}

/** The column's list while a card is dragged over it: its cards, with `null` for the drop shadow. */
type Item = Story | null;

/** One Stage: header with name, Stage Category colour and count, then its cards, scrolled to `first`. */
export function BoardColumn({
  boardId,
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
  onContextMenu,
  onDrop,
  onDragOver,
  onDragLeave,
  drag = null,
}: BoardColumnProps) {
  const others = drag ? cards.filter((s) => s.key !== drag.key) : cards;
  const items: readonly Item[] = drag ? [...others.slice(0, drag.slot), null, ...others.slice(drag.slot)] : cards;
  // While dragging, the column scrolls as little as it can from where it was to show the shadow.
  const shownTop = useRef(first);
  const top = drag ? follow(shownTop.current, drag.slot, size, items.length) : first;
  shownTop.current = top;
  const shown = items.slice(top, top + size);
  const below = items.length - top - shown.length;
  const inner = width - 2;
  const ref = useRef<DOMElement>(null);
  const badgesOf = useCardBadges();
  const { plugins } = usePlugins();
  // The pointer's line picks the slot, measured against what is on screen; the dragged card does not count.
  const slotAt = (key: unknown, y: number) => {
    const count = cards.filter((s) => s.key !== key).length;
    return ref.current ? dropSlot(y, measureElement(ref.current).y, shownTop.current, count) : count;
  };
  useMouse(
    ref,
    {
      onClick: () => onClick?.(-1),
      onDrop: (key, _x, y) => onDrop?.(key, slotAt(key, y)),
      onDragOver: (key, _x, y) => onDragOver?.(key, slotAt(key, y)),
      onDragLeave,
    },
    active,
  );
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
      <Box>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Text wrap="truncate-end">
            <StageBadge stage={stage} /> <Text color={theme.inkFaint}>{cards.length}</Text>
          </Text>
        </Box>
        {plugins.map(({ id, tui }) => {
          const Header = tui.stageHeader;
          return Header ? (
            <Box key={id} flexShrink={0}>
              <PluginSlot
                pluginId={id}
                render={(plugin, ui) => (
                  <Header boardId={boardId} stage={stage} active={active} plugin={plugin} ui={ui} />
                )}
              />
            </Box>
          ) : null;
        })}
      </Box>
      {selected === null ? (
        <Text color={theme.border}>{'─'.repeat(inner)}</Text>
      ) : (
        <Text color={active ? theme.accent : theme.border}>{'━'.repeat(inner)}</Text>
      )}
      <Text color={theme.inkFaint}>{top > 0 ? `↑ ${top} more` : ' '}</Text>
      {shown.map((story) => {
        if (!story) return <StoryShadow key="shadow" width={inner} />;
        const index = cards.indexOf(story);
        return (
          <StoryCard
            key={story.key}
            story={story}
            badges={[...storyBadges(story), ...badgesOf(story, stages)]}
            width={inner}
            selected={selected === index}
            active={active}
            onClick={() => onClick?.(index)}
            onContextMenu={onContextMenu && ((x, y) => onContextMenu(index, x, y))}
          />
        );
      })}
      {items.length === 0 && <Text color={theme.inkFaint}>No Stories</Text>}
      {below > 0 && <Text color={theme.inkFaint}>↓ {below} more</Text>}
    </Box>
  );
}
