import { Text } from "ink";
import { useMemo } from "react";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import { FuzzyPicker, type FuzzyPickerView, Modal, modalSize } from "../../components/index.js";
import { useLayout } from "../../hooks/index.js";
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

function stageLabel(stages: readonly Stage[], key: string): string {
  return stages.find((stage) => stage.key === key)?.label ?? key;
}

/** The search of a Story: its key, its title, the label of its Stage and its description. */
function storySearch(stages: readonly Stage[]): (story: Story) => readonly string[] {
  return (story) => [story.id, story.title, stages.find((s) => s.key === story.stage)?.label ?? "", story.description];
}

function compareStories(a: Story, b: Story): number {
  return a.number - b.number;
}

function countText({ count, selected, limit }: FuzzyPickerView): string {
  const position = count > limit ? ` · ${selected + 1}/${count}` : "";

  return `${count} ${count === 1 ? "Story" : "Stories"}${position}`;
}

/**
 * The fuzzy finder for Stories, in a generic Modal. It matches the query against the key, the title,
 * the Stage and the description of each Story. `↑/↓` select, `enter` picks, `esc` closes.
 */
export function StoryFinder({ stories, stages, onSelect, onClose }: StoryFinderProps) {
  const { body } = modalSize(useLayout(), { footer: true });
  const search = useMemo(() => storySearch(stages), [stages]);

  return (
    <Modal title="Find Stories" onClose={onClose} hints={FINDER_HINTS}>
      <FuzzyPicker
        items={stories}
        search={search}
        compare={compareStories}
        itemKey={(story) => story.id}
        renderItem={(story) => (
          <>
            <Text color={theme.accent}>{story.id}</Text> {story.title}
            <Text color={theme.inkMuted}> · {stageLabel(stages, story.stage)}</Text>
          </>
        )}
        emptyText={stories.length === 0 ? "No Stories yet." : "No matching Stories."}
        // The input, the count and the gaps between them take the other rows of the body.
        limit={Math.max(1, Math.min(10, (body.height ?? 16) - 6))}
        placeholder="Find Stories…"
        inputWidth={body.width - 5}
        width={body.width}
        prefix={<Text color={theme.accent}>🔎 </Text>}
        header={(view) => <Text color={theme.inkMuted}>{countText(view)}</Text>}
        wheel={true}
        onSelect={onSelect}
        onCancel={onClose}
      />
    </Modal>
  );
}
