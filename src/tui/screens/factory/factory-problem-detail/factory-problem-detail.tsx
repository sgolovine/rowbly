import { Box, Text } from "ink";
import type { Story } from "../../../../services/story/story.js";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { Button, DetailView } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import type { FactoryProblem, FactoryProblemKind } from "../factory-status.js";

/** The words of a kind of warning for people. */
const KINDS: Readonly<Record<FactoryProblemKind, string>> = {
  heartbeat: "Heartbeat",
  attention: "Attention entry",
  issue: "Thread file issue",
  provider: "Provider pause",
};

/** The props of `FactoryProblemDetail`. */
export interface FactoryProblemDetailProps {
  readonly problem: FactoryProblem;
  /** The Story of the warning, if the board has it. */
  readonly story: Story | undefined;
  /** The related Thread of the warning. */
  readonly thread: ThreadRecord | undefined;
  readonly can: { readonly story: boolean; readonly thread: boolean; readonly dismiss: boolean };
  /** True while a dismiss waits for the factory. */
  readonly busy: boolean;
  /** False while a dialog has the keys; then the buttons do not take a click. */
  readonly clickable: boolean;
  readonly onStory: () => void;
  readonly onThread: () => void;
  readonly onDismiss: () => void;
}

interface DetailRow {
  readonly label: string;
  readonly value: string;
}

/** The Story ID, with the title when the board has the Story. */
function storyText(storyId: string, story: Story | undefined): string {
  return story ? `${storyId} · ${story.title}` : storyId;
}

/** The label–value rows of a warning: its kind and the records that it relates to. */
function detailRows(problem: FactoryProblem, story: Story | undefined, thread: ThreadRecord | undefined): DetailRow[] {
  return [
    { label: "Kind", value: KINDS[problem.kind] },
    ...(problem.attentionKey === undefined ? [] : [{ label: "Key", value: problem.attentionKey }]),
    ...(problem.storyId === undefined ? [] : [{ label: "Story", value: storyText(problem.storyId, story) }]),
    ...(thread ? [{ label: "Thread", value: `${thread.id} · ${thread.status}` }] : []),
    ...(problem.file === undefined ? [] : [{ label: "File", value: problem.file }]),
  ];
}

/** One warning of the factory: its full text with wrap, its kind, its Story and its Thread, and its actions. */
export function FactoryProblemDetail(props: FactoryProblemDetailProps) {
  const { problem, story, thread, can, busy, clickable } = props;

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={theme.ink} wrap="wrap">
        {problem.message}
      </Text>
      <DetailView rows={detailRows(problem, story, thread)} />
      {(can.story || can.thread || problem.dismissible) && (
        <Box flexWrap="wrap" gap={1}>
          {can.story && <Button label="Story" keyName="o" compact clickable={clickable} onClick={props.onStory} />}
          {can.thread && <Button label="Thread" keyName="t" compact clickable={clickable} onClick={props.onThread} />}
          {problem.dismissible && (
            <Button
              label={busy ? "Dismiss…" : "Dismiss"}
              keyName="d"
              busy={busy}
              compact
              clickable={clickable && can.dismiss}
              onClick={props.onDismiss}
            />
          )}
        </Box>
      )}
    </Box>
  );
}
