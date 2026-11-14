import { Box } from "ink";
import { ConversationView, conversationKeys } from "../../../components/index.js";
import { useReportHints } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { THREAD_DETAIL_ROWS, ThreadDetail } from "../../stories/index.js";
import { ThreadChecks, threadCheckRows } from "../thread-checks/index.js";
import { type ThreadPaneProps, useThreadPane } from "./use-thread-pane.js";

/** Below this body height, the pane shows the compact detail, so that the conversation keeps its room. */
const FULL_DETAIL_MIN_HEIGHT = THREAD_DETAIL_ROWS + 10;

/** The keys of the pane: the keys of the conversation, then `tab` and `esc`. */
export function threadPaneHints(live: boolean): readonly KeyHint[] {
  return [
    ...conversationKeys(live),
    { key: "tab", description: "next pane", secondary: true },
    { key: "esc", description: "Thread list" },
  ];
}

/** The rows of the conversation: the body less the detail, the checks and one blank row. */
function conversationHeight(body: number | undefined, compact: boolean, checks: number): number | undefined {
  return body === undefined ? undefined : Math.max(2, body - (compact ? 2 : THREAD_DETAIL_ROWS) - checks - 1);
}

/**
 * The content of a Thread in the Story sidebar of the Factory view. It shows the metadata of the Thread, its last
 * checks, then its conversation, which follows the new entries while the Thread runs. It is read-only. Its size comes from the
 * layout of the sidebar body. `esc` gives the focus back to the Thread list.
 */
export function ThreadPane(props: ThreadPaneProps) {
  const { ctx, onHints } = props;
  const { active, current, now, layout } = useThreadPane(props);
  const live = current.status === "running";
  const compact = layout.height !== undefined && layout.height < FULL_DETAIL_MIN_HEIGHT;

  useReportHints(onHints, threadPaneHints(live));

  return (
    <Box flexDirection="column" width={layout.width}>
      <ThreadDetail thread={current} now={now} compact={compact} />
      <ThreadChecks checks={current.checks} />
      <Box marginTop={1}>
        <ConversationView
          ctx={ctx}
          threadId={current.id}
          live={live}
          active={active}
          width={layout.width}
          height={conversationHeight(layout.height, compact, threadCheckRows(current.checks))}
        />
      </Box>
    </Box>
  );
}
