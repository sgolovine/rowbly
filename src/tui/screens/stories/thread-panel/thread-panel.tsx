import { Box, Text } from "ink";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { ConversationView, Panel } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { ThreadDetail } from "../thread-detail/index.js";
import { type StageNames, threadName } from "../thread-text.js";

export interface ThreadPanelProps {
  readonly ctx: ServiceContext;
  readonly storyId: string;
  /** The names of the Stages by key. */
  readonly stages?: StageNames;
  readonly current: ThreadRecord | undefined;
  /** The time for the run time of a running thread. */
  readonly now: number;
  /** The thread shows only its status and outcome rows. */
  readonly compact: boolean;
  /** The Threads tab is the tab on the screen. */
  readonly selected: boolean;
  /** The id of the thread whose conversation is open. */
  readonly shownId: string | undefined;
  /** The list takes the keys. */
  readonly listing: boolean;
  /** The thread region takes the keys. */
  readonly viewing: boolean;
  readonly width: number | undefined;
  readonly height: number | undefined;
  /** The width of the conversation, inside the frame. */
  readonly threadWidth: number;
  readonly conversationHeight: number | undefined;
  /** A click on the Panel while the list has the keys. */
  readonly onFocusThread: () => void;
}

/** The title of the Panel: the Story and the thread, or "Thread" without a thread. */
function panelTitle(storyId: string, current: ThreadRecord | undefined, stages: StageNames | undefined): string {
  return current ? `${storyId} › ${threadName(current, stages)}` : "Thread";
}

/** The thread region of the Threads tab: the metadata of the selected thread, then its conversation. */
export function ThreadPanel({
  ctx,
  storyId,
  stages,
  current,
  now,
  compact,
  selected,
  shownId,
  listing,
  viewing,
  width,
  height,
  threadWidth,
  conversationHeight,
  onFocusThread,
}: ThreadPanelProps) {
  return (
    <Panel
      title={panelTitle(storyId, current, stages)}
      focused={viewing}
      onClick={listing && current ? onFocusThread : undefined}
      flexGrow={1}
      flexShrink={1}
      width={width}
      height={height}
      overflow="hidden"
    >
      {current ? (
        <>
          <ThreadDetail thread={current} now={now} compact={compact} />
          {selected && shownId === current.id && (
            <Box marginTop={1}>
              <ConversationView
                key={current.id}
                ctx={ctx}
                threadId={current.id}
                live={current.status === "running"}
                active={viewing}
                width={threadWidth}
                height={conversationHeight}
              />
            </Box>
          )}
        </>
      ) : (
        <Text color={theme.inkFaint} wrap="wrap">
          The factory adds a thread when it starts a worker for this Story.
        </Text>
      )}
    </Panel>
  );
}
