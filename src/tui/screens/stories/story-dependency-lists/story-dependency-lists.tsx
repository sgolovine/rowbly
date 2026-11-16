import { Box, type DOMElement, Text } from "ink";
import { useRef, useState } from "react";
import { StageBadge } from "../../../components/index.js";
import { useMouse } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import type { DependencyItem, DependencyLists } from "../story-dependency-view.js";

/** The width of the labels `Depends on` and `Blocks`, with two columns after them. */
const LABEL_WIDTH = 12;

/** Opens the Story `id`, or `undefined` when the lists do not open Stories. */
type OpenStory = ((id: string) => void) | undefined;

/** A click opens the Story of the item. */
function openItem(onOpen: OpenStory, item: DependencyItem): void {
  onOpen?.(item.id);
}

/**
 * One upstream or downstream Story: its ID, its title and its Stage. A click opens the Story, and the row fills with
 * `selection` under the mouse. An item of an ID that the Project does not have has no title, and a click does nothing.
 */
function DependencyRow({ item, onOpen, clickable }: { item: DependencyItem; onOpen: OpenStory; clickable: boolean }) {
  const ref = useRef<DOMElement>(null);
  const [hovered, setHovered] = useState(false);

  const mouse = clickable && onOpen !== undefined && item.title !== "";

  useMouse(
    ref,
    { onClick: () => openItem(onOpen, item), onEnter: () => setHovered(true), onLeave: () => setHovered(false) },
    mouse,
  );

  return (
    <Box ref={ref} backgroundColor={hovered && mouse ? theme.selection : undefined}>
      <Box flexGrow={1} flexShrink={1}>
        <Text wrap="truncate-end" color={theme.ink}>
          <Text color={theme.accent}>{item.id}</Text> {item.title}
        </Text>
      </Box>
      {item.stage && (
        <Box flexShrink={0} paddingLeft={2}>
          <StageBadge stage={item.stage} />
        </Box>
      )}
    </Box>
  );
}

/** A label, then one row for each Story of the list, or `none`. */
function DependencyList({
  label,
  items,
  onOpen,
  clickable,
}: {
  label: string;
  items: readonly DependencyItem[];
  onOpen: OpenStory;
  clickable: boolean;
}) {
  return (
    <Box>
      <Box width={LABEL_WIDTH} flexShrink={0}>
        <Text color={theme.inkMuted}>{label}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {items.length === 0 && <Text color={theme.inkFaint}>none</Text>}
        {items.map((item) => (
          <DependencyRow key={item.id} item={item} onOpen={onOpen} clickable={clickable} />
        ))}
      </Box>
    </Box>
  );
}

/**
 * The saved dependencies of a Story in the General tab: the upstream Stories (`Depends on`) and the downstream
 * Stories (`Blocks`). A click on an item opens that Story while `clickable`. The `Depends on` field of the form
 * changes the upstream Stories.
 */
export function StoryDependencyLists({
  lists,
  onOpen,
  clickable,
}: {
  lists: DependencyLists;
  /** Opens the Story `id` in the Story sidebar. */
  onOpen?: (id: string) => void;
  /** The items take the clicks. */
  clickable: boolean;
}) {
  return (
    <Box flexDirection="column" marginTop={1} flexShrink={0}>
      <DependencyList label="Depends on" items={lists.dependsOn} onOpen={onOpen} clickable={clickable} />
      <DependencyList label="Blocks" items={lists.blocks} onOpen={onOpen} clickable={clickable} />
    </Box>
  );
}
