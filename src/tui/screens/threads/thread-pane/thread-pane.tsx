import { Box } from "ink";
import { Button, ConversationView, conversationKeys } from "../../../components/index.js";
import { useReportHints } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { THREAD_DETAIL_ROWS, ThreadDetail } from "../../stories/index.js";
import { ThreadChecks, threadCheckRows } from "../thread-checks/index.js";
import { type ThreadPaneProps, useThreadPane } from "./use-thread-pane.js";

/** Below this body height, the pane shows the compact detail, so that the conversation keeps its room. */
const FULL_DETAIL_MIN_HEIGHT = THREAD_DETAIL_ROWS + 10;

/** The keys of the pane: the keys of the conversation, `o` when the Story can open, then `tab` and `esc`. */
function threadPaneHints(live: boolean, story: boolean): readonly KeyHint[] {
  return [
    ...conversationKeys(live),
    ...(story ? [{ key: "o", description: "open Story" }] : []),
    { key: "tab", description: "next pane", secondary: true },
    { key: "esc", description: "Thread list" },
  ];
}

/** The rows above the conversation: the Button row, the detail and the checks. */
function headRows(compact: boolean, checks: number, button: boolean): number {
  return (button ? 1 : 0) + (compact ? 2 : THREAD_DETAIL_ROWS) + checks;
}

/** The rows of the conversation: the body less the rows above it and one blank row. */
function conversationHeight(body: number | undefined, head: number): number | undefined {
  return body === undefined ? undefined : Math.max(2, body - head - 1);
}

/**
 * The content of a Thread in the Story sidebar of the Factory view. It shows the metadata of the Thread, its last
 * checks, then its conversation, which follows the new entries while the Thread runs. It is read-only. Its size comes from the
 * layout of the sidebar body. When the board has the Story of the Thread, an `Open Story` Button (`o`) opens it. `esc`
 * gives the focus back to the Thread list.
 */
export function ThreadPane(props: ThreadPaneProps) {
  const { ctx, onHints, onOpenStory } = props;
  const { active, current, now, layout } = useThreadPane(props);
  const live = current.status === "running";
  const compact = layout.height !== undefined && layout.height < FULL_DETAIL_MIN_HEIGHT;

  const head = headRows(compact, threadCheckRows(current.checks), onOpenStory !== undefined);

  useReportHints(onHints, threadPaneHints(live, onOpenStory !== undefined));

  return (
    <Box flexDirection="column" width={layout.width}>
      {onOpenStory && (
        <Box>
          <Button label="Open Story" keyName="o" onClick={onOpenStory} clickable={props.clickable} compact />
        </Box>
      )}
      <ThreadDetail thread={current} now={now} compact={compact} />
      <ThreadChecks checks={current.checks} />
      <Box marginTop={1}>
        <ConversationView
          ctx={ctx}
          threadId={current.id}
          live={live}
          active={active}
          width={layout.width}
          height={conversationHeight(layout.height, head)}
        />
      </Box>
    </Box>
  );
}
