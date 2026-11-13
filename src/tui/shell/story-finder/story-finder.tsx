import { Box, type DOMElement, Text, useInput } from "ink";
import { useMemo, useRef, useState } from "react";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import { fuzzySearch, Modal, modalSize, SelectListRow, TextInput } from "../../components/index.js";
import { useIsActive, useKeyCapture, useLayout, useMouse, WHEEL_LINES } from "../../hooks/index.js";
import { theme } from "../../theme.js";

/**
 * The fuzzy finder for Stories, in a generic Modal. It matches the query against the key, the title,
 * the Stage and the description of each Story. `↑/↓` select, `enter` picks, `esc` closes.
 */
export function StoryFinder({
  stories,
  stages,
  onSelect,
  onClose,
}: {
  stories: readonly Story[];
  stages: readonly Stage[];
  onSelect(story: Story): void;
  onClose(): void;
}) {
  const active = useIsActive();
  const { body } = modalSize(useLayout(), { footer: true });
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<DOMElement>(null);
  const stageLabel = (key: string) => stages.find((stage) => stage.key === key)?.label ?? key;
  const results = useMemo(
    () =>
      fuzzySearch(
        stories,
        query,
        (story) => [story.id, story.title, stages.find((s) => s.key === story.stage)?.label ?? "", story.description],
        (a, b) => a.number - b.number,
      ),
    [stories, stages, query],
  );
  const selected = Math.min(cursor, Math.max(0, results.length - 1));
  // The input, the count and the gaps between them take the other rows of the body.
  const limit = Math.max(1, Math.min(10, (body.height ?? 16) - 6));
  const start = Math.max(0, Math.min(selected - Math.floor(limit / 2), results.length - limit));
  const move = (delta: number) => setCursor(Math.max(0, Math.min(results.length - 1, selected + delta)));
  useMouse(list, { onWheel: (direction) => move(direction * WHEEL_LINES) }, active && results.length > limit);
  useKeyCapture(active, { escape: true });
  useInput(
    (_input, key) => {
      if (key.escape) {
        onClose();
      } else if (key.downArrow) {
        move(1);
      } else if (key.upArrow) {
        move(-1);
      } else if (key.return && results[selected]) {
        onSelect(results[selected]);
      }
    },
    { isActive: active },
  );
  return (
    <Modal
      title="Find Stories"
      onClose={onClose}
      hints={[
        { key: "↑/↓", description: "select" },
        { key: "enter", description: "open Story" },
        { key: "esc", description: "close" },
      ]}
    >
      <Box flexDirection="column" gap={1} width={body.width}>
        <Box backgroundColor={theme.fieldFocus} paddingX={1}>
          <Text color={theme.accent}>🔎 </Text>
          <TextInput
            value={query}
            onChange={(value) => {
              setQuery(value);
              setCursor(0);
            }}
            focus={active}
            width={Math.max(8, body.width - 5)}
            placeholder="Find Stories…"
          />
        </Box>
        <Text color={theme.inkMuted}>
          {results.length} {results.length === 1 ? "Story" : "Stories"}
          {results.length > limit ? ` · ${selected + 1}/${results.length}` : ""}
        </Text>
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
              <Text color={theme.inkMuted}> · {stageLabel(story.stage)}</Text>
            </SelectListRow>
          ))}
        </Box>
      </Box>
    </Modal>
  );
}
