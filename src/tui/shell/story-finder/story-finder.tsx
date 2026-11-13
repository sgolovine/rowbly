import { Box, type DOMElement, type Key, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useMemo, useRef, useState } from "react";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import { fuzzySearch, Modal, modalSize, SelectListRow, TextInput } from "../../components/index.js";
import { useIsActive, useKeyCapture, useLayout, useMouse, WHEEL_LINES } from "../../hooks/index.js";
import { theme } from "../../theme.js";

const FINDER_HINTS = [
  { key: "↑/↓", description: "select" },
  { key: "enter", description: "open Story" },
  { key: "esc", description: "close" },
];

interface StoryFinderProps {
  readonly stories: readonly Story[];
  readonly stages: readonly Stage[];
  onSelect(story: Story): void;
  onClose(): void;
}

/** What the keys and the mouse of the finder read and change. */
interface FinderEnv {
  readonly results: readonly Story[];
  readonly selected: number;
  readonly setQuery: Dispatch<SetStateAction<string>>;
  readonly setCursor: Dispatch<SetStateAction<number>>;
  readonly onSelect: (story: Story) => void;
  readonly onClose: () => void;
}

function stageLabel(stages: readonly Stage[], key: string): string {
  return stages.find((stage) => stage.key === key)?.label ?? key;
}

function findStories(stories: readonly Story[], stages: readonly Stage[], query: string): Story[] {
  return fuzzySearch(
    stories,
    query,
    (story) => [story.id, story.title, stages.find((s) => s.key === story.stage)?.label ?? "", story.description],
    (a, b) => a.number - b.number,
  );
}

/** The first result row on screen, so that the selected row stays near the middle. */
function firstRow(selected: number, limit: number, count: number): number {
  return Math.max(0, Math.min(selected - Math.floor(limit / 2), count - limit));
}

function move(env: FinderEnv, delta: number): void {
  env.setCursor(Math.max(0, Math.min(env.results.length - 1, env.selected + delta)));
}

function changeQuery(env: FinderEnv, value: string): void {
  env.setQuery(value);
  env.setCursor(0);
}

function finderKey(env: FinderEnv, key: Key): void {
  const story = env.results[env.selected];

  if (key.escape) {
    env.onClose();
  } else if (key.downArrow) {
    move(env, 1);
  } else if (key.upArrow) {
    move(env, -1);
  } else if (key.return && story) {
    env.onSelect(story);
  }
}

function countText(results: readonly Story[], selected: number, limit: number): string {
  const position = results.length > limit ? ` · ${selected + 1}/${results.length}` : "";

  return `${results.length} ${results.length === 1 ? "Story" : "Stories"}${position}`;
}

/**
 * The fuzzy finder for Stories, in a generic Modal. It matches the query against the key, the title,
 * the Stage and the description of each Story. `↑/↓` select, `enter` picks, `esc` closes.
 */
export function StoryFinder({ stories, stages, onSelect, onClose }: StoryFinderProps) {
  const active = useIsActive();
  const { body } = modalSize(useLayout(), { footer: true });
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<DOMElement>(null);
  const results = useMemo(() => findStories(stories, stages, query), [stories, stages, query]);

  const selected = Math.min(cursor, Math.max(0, results.length - 1));
  // The input, the count and the gaps between them take the other rows of the body.
  const limit = Math.max(1, Math.min(10, (body.height ?? 16) - 6));
  const start = firstRow(selected, limit, results.length);
  const env: FinderEnv = { results, selected, setQuery, setCursor, onSelect, onClose };

  useMouse(list, { onWheel: (direction) => move(env, direction * WHEEL_LINES) }, active && results.length > limit);
  useKeyCapture(active, { escape: true });
  useInput((_input, key) => finderKey(env, key), { isActive: active });

  return (
    <Modal title="Find Stories" onClose={onClose} hints={FINDER_HINTS}>
      <Box flexDirection="column" gap={1} width={body.width}>
        <Box backgroundColor={theme.fieldFocus} paddingX={1}>
          <Text color={theme.accent}>🔎 </Text>
          <TextInput
            value={query}
            onChange={(value) => changeQuery(env, value)}
            focus={active}
            width={Math.max(8, body.width - 5)}
            placeholder="Find Stories…"
          />
        </Box>
        <Text color={theme.inkMuted}>{countText(results, selected, limit)}</Text>
        <Box ref={list} flexDirection="column">
          {results.length === 0 && (
            <Text color={theme.inkFaint}>{stories.length === 0 ? "No Stories yet." : "No matching Stories."}</Text>
          )}
          {results.slice(start, start + limit).map((story, i) => (
            <SelectListRow
              key={story.id}
              highlighted={start + i === selected}
              active={active}
              onClick={() => onSelect(story)}
            >
              <Text color={theme.accent}>{story.id}</Text> {story.title}
              <Text color={theme.inkMuted}> · {stageLabel(stages, story.stage)}</Text>
            </SelectListRow>
          ))}
        </Box>
      </Box>
    </Modal>
  );
}
